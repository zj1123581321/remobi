# 任务卡：弱网 T2 修复 1 — 删掉永远不会发出的 `pty-write-failed`，把写失败诚实收口

## 目标

第 2 轮独立审查用真实 `node-pty@1.1.0` 实测证明：`pty.write()` 的**真实**写失败**不会同步抛异常**，
因此 `try/catch` → `input-rejected(pty-write-failed)` 这条分支在真实运行中**永远不会触发**。
协议里于是留了一个发不出去的错误码，而 `input-accepted` 承诺的东西比它能证明的多。

本卡不发明检测机制（node-pty 的 API 在架构上就不给），而是**做减法 + 说实话**。

## 非目标

- **不要**去拦截 `console.error`、不要 monkey-patch node-pty、不要直接用 `pty.fd` 自己
  `fs.write` 绕过它的写队列——后者会和 node-pty 的 `_writeQueue` 争同一个 fd，破坏流控
  （`handleFlowControl` / XOFF-XON），风险远大于收益。**这三条都已否决，不要重开。**
- 不改去重 Map 的语义。**保留去重**：对 coding agent 场景，"一条命令被执行两次"
  （重复删文件、重复提交）比"一条命令没执行"更危险，所以去重的价值高于检测写失败的价值。
- 不改 `sessionId` / `outputWatermark` / `seq` / snapshot 稳定循环 / heartbeat——它们本轮审查全过。
- 不改客户端（T3/T4 的范围）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：280
- **阶段**：repairing
- **锁定决策**（方案已由主脑拍板，不要重新发散）：

  1. **删掉 `'pty-write-failed'`**：
     ```ts
     export type InputRejectedReason = 'id-conflict' | 'session-unavailable'
     ```
     协议、实现、测试三处同步删干净。理由：它永远发不出去，留着就是假承诺，
     还会误导 T4 去实现一条永远走不到的"用原 ID 手动重试"UI 路径。
  2. **同步异常仍然要 catch，但改成 fail-loud**（不是 per-action rejected）：
     `this.pty.write(data)` 万一真的同步抛了，说明 PTY 层出了严重问题，
     应当走**与 mirror 失败同一条**粘性 fail-loud 路径：置粘性错误 → 广播不含终端正文的
     error → 关闭所有 client → 后续 attach 拒绝 → 后续 action 回 `session-unavailable`。
     给触发这次异常的 client 回一次 `input-rejected(id, 'session-unavailable')` 再关闭。
     **不写去重 Map。**
  3. **把 `mirrorFailed` 泛化成 `terminalFailed`**（改名，不是新增机制）：
     现在有两个来源（mirror 写失败、PTY 同步写异常）共用同一条 fail-loud 路径，
     字段名和文案都不该再只说 mirror。文案改为
     `Terminal failed; restart remobi.`（仍然**不含任何终端正文或用户输入**）。
     `failMirror()` 相应改名 `failTerminal()`。**这是重命名 + 复用，不是加第二套机制**——
     报告里要写明只有一条 fail-loud 路径。
  4. **在协议类型上把 accepted 的语义写实**（注释，不是新字段）：
     ```ts
     /**
      * remobi 已把 data 交给当前 PTY 的写入队列，并已记入 session 内去重账本。
      *
      * 不保证操作系统层面写入成功：node-pty@1.1.0 的写入走 fs.write 异步回调，
      * 失败时只 console.error 并清空整个写队列（lib/unixTerminal.js:314-327），
      * 不 emit、不回调，调用方无法观察。更不代表 Herdr 已执行完成。
      */
     export interface InputAcceptedMessage { … }
     ```
  5. **设计文档补一节「已知限制」**，把这条边界和实测证据落进
     `docs/designs/weak-network-experience.md`（放在 `## NOT in Scope` 之后新增
     `## Known Limitations` 一节即可，不要改动既有章节）：
     - node-pty 写失败不可观察，`accepted` 只能证明"已交给写入队列"；
     - 触发窗口：PTY 已进入失败态（fd 关闭 / EBADF / 子进程已退出但 `onExit` 尚未到达）
       而客户端恰好在此刻提交；
     - 已知后果：该 action 会被记入去重账本，**重送同一 id 只会再次 accepted，不会重写**——
       原始丢失不可自动恢复，用户只能从终端画面自行判断并用新 id 重发；
     - 已否决的三条修法（拦 console.error / patch node-pty / 绕开写队列直写 fd）及理由。

- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：`d48425790d692235a16aa12e77b8e64f4f75123a`（`card/wnet-t2` 当前 HEAD，
  已含 `origin/main` 的合并）
- **Branch**：继续用 `card/wnet-t2`（本卡走 `delegate resume`，同一 worktree 续修）
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-t2`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`，同一执行器第 1 轮修复）
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`，
  本次仍属 infra/状态机类，收敛条件连续 2 轮无新增 P1。

## 修复卡必填

- **root_cause_group**：用同步异常代表异步 I/O 的成败——把"调用返回了"当成"写入成功了"。
- **introduced_by_commit**：`f822d94 feat(protocol): add fresh-session and input-action fields`
  （引入 `pty-write-failed` reason）与 `f65638d`/`29f6c6a` 一线的 `handleInputAction` 实现。
  更准确地说这是**卡面契约的缺陷**：主脑在 T2 卡里写了「只在这一次调用边界 catch 同步异常
  并转换为 rejected(`pty-write-failed`)」，执行器忠实实现了它。契约错，不是实现错。
- **open_findings**：只修 P1-1，不得超出。

### P1-1：异步 node-pty 写失败仍会发送假 accepted

- 违反：不变式 1（accepted 只在写入成功后发出）；命中 personal 档「静默出错」红线。
- 位置：`src/session.ts` 的 `handleInputAction` 里 `try { this.pty.write(data) } catch`。
- 实测证据（`node-pty@1.1.0`，Node v24.14.0，真实 Linux PTY；把 write stream 的 fd 换成
  非法 fd 使底层进入真实 EBADF）：
  ```text
  {"event":"write-after-invalid-fd","threw":false,"returned":"undefined"}
  CAPTURED Unhandled pty write error Error: EBADF: bad file descriptor, write
  ```
  子进程退出后再写同样 `threw: false`。
- node-pty 内部实现（`lib/unixTerminal.js:314-327`）：`fs.write` 的错误回调里
  `this._writeQueue.length = 0`（**丢掉整个排队的写入**）+ `console.error(...)`，
  既不 emit 也不回调。
- 为什么是 P1 而不是低概率的 P2：**去重账本把这个错误固化了**。写失败后 `{id,data}` 照样入账，
  客户端重送同一 id 只会再收到一次 accepted、不会重写——保护机制变成了错误放大器，
  原始丢失永远修不回来。

## 修改边界

- **允许**：
  - `src/session-protocol.ts`
  - `src/session.ts`
  - `tests/session-protocol.test.ts`
  - `tests/session-action.test.ts`
  - `tests/session.test.ts`
  - `docs/designs/weak-network-experience.md`（**只新增** `## Known Limitations` 一节）
- **禁止**：`src/serve.ts`、`src/client-entry.ts`、`src/controls/**`、`src/pty.ts`、
  `node_modules/**`（不许 patch 依赖）、`.github/`、`package.json`、`pnpm-lock.yaml`
- **Scope-Globs**：src/session-protocol.ts src/session.ts tests/session-protocol.test.ts tests/session-action.test.ts tests/session.test.ts docs/designs/weak-network-experience.md
- **高风险区域**：
  - `tests/session-action.test.ts` 里那条 `does not record a synchronous PTY write failure`
    测的是"同步抛 → rejected(pty-write-failed) → 不记账"。改造后它应当变成
    "同步抛 → fail-loud + rejected(session-unavailable) → 不记账 → 后续 attach 被拒"。
    **不许直接删掉**——同步异常路径虽罕见但仍要锁死"不记账"这条。
  - 改名 `mirrorFailed → terminalFailed` 会碰到多处引用，`grep -rn "mirrorFailed\|failMirror\|TERMINAL_MIRROR_ERROR" src/ tests/` 一遍，一个不许漏。
  - 现有测试里断言过 `Terminal mirror failed; restart remobi.` 这个字面量的地方要同步改。

## 不变式轴表

轴：写入路径的失败形态 × 期望

| 失败形态 | 是否可被调用方观察 | 期望行为 |
|---|---|---|
| `pty.write` 同步抛异常（罕见） | 是 | fail-loud：粘性 `terminalFailed` + 广播不含正文的 error + 关闭所有 client；给触发方回 `input-rejected(session-unavailable)`；**不记账**；后续 attach 拒绝 |
| 底层 `fs.write` 异步失败（EBADF 等） | **否**（node-pty 不 emit/不回调） | 现状照旧发 accepted 并记账。**这是已知且已记录的限制**，测试与文档都要诚实反映，不许假装能捕获 |
| session 已 exited | 是 | `input-rejected(session-unavailable)` + 关闭连接（不变） |
| mirror 写失败 | 是 | fail-loud（不变，但字段/文案已泛化为 terminal） |
| 正常写入 | — | 记账 → `input-accepted`（不变） |
| 同 id 同 data 重送 | — | 不写 PTY，只再发 accepted（不变） |
| 同 id 不同 data | — | `input-rejected(id-conflict)`，不写 PTY（不变） |

另外：协议层不再存在 `'pty-write-failed'`，`parseServerMessage` 收到它必须判 `null`
（当作未知 reason 拒绝）——加一条断言。

## 完成条件

- **产物入库**：提交到 `card/wnet-t2`；报告贴出 `git log --oneline -1` 与
  `git show --stat HEAD` 的实际输出。
- **行为验收**：
  1. 协议里搜不到 `pty-write-failed`（`grep -rn "pty-write-failed" src/ tests/ docs/` 只在
     设计文档的「已知限制」与本卡历史记录里出现，源码零命中）。
  2. 同步写异常 → 整个 session fail-loud，第二个 client 也收到 error 并被关闭，后续 attach 被拒。
  3. 正常路径不受影响：全量测试绿。
  4. 设计文档能查到这条已知限制与实测证据。
- **相关测试**：`pnpm test` 全量绿（禁止 `-k` 子集）。
  封笔前贴出：`grep -rn "pty-write-failed\|mirrorFailed\|failMirror\|TERMINAL_MIRROR_ERROR" src/ tests/`
- **概率性验收**：`pnpm exec vitest run tests/session.test.ts tests/session-action.test.ts`
  **连续跑 5 次全绿**，5 次结果贴进报告。
- **跨发布边界验收**：真实 WebSocket 集成测试保持绿（`tests/serve-abuse.test.ts`）；
  若 fail-loud 的 error 文案变了，那里的断言要同步更新并贴出实际帧字符串。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **现场还原**：停在 `card/wnet-t2`；不要留游离的 node/PTY 进程。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①删 reason + 协议测试 ②同步异常改 fail-loud + 改名泛化 ③设计文档已知限制 三次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：本卡是**净减法**——删一个 reason、把两条失败路径并成一条。
  报告里要确认最终只有**一条** fail-loud 路径，没有新增第二套机制。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行。
  该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 第 2 轮独立审查 verdict：`fail`，P1 计数 1，只有 P1-1 这一条。
    其余方向（去重四态、seq/watermark、mirror fail-loud、协议违规关闭、多客户端并发、
    256 KiB 边界）实测全部成立，**不要动它们**。
  - `IPty` 的公开接口只有 `onData` / `onExit` 两个事件，`write(data: string | Buffer): void`
    没有回调、没有 Promise、没有 error 事件（`node_modules/node-pty/typings/node-pty.d.ts:149,155,176`）。
  - `card/wnet-t2` 已合入 `origin/main`（含 T1 与 typos 修复），CI 绿；PR #13 开着。
  - `origin/main` 已包含 T1（PR #14 已合并，`01ba69e`）。
- **机理/根因陈述**：
  - `accepted 可能在 PTY 没写进去时发出`（证据锚点：
    `node_modules/node-pty/lib/unixTerminal.js:314-327` 的 `fs.write` 错误回调只
    `console.error` 并清空 `_writeQueue`；审查实测 `threw:false`）。
- **关键决策**：主脑已定级 P1 并拍板走"减法 + 说实话"，三条检测型修法已否决（见非目标）。
- **下一步唯一动作**：先删 `'pty-write-failed'` 并让协议测试锁死"该 reason 不再被接受"。
