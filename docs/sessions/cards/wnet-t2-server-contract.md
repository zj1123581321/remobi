# 任务卡：弱网 T2 — 服务端新鲜度契约与原子 input-action

## 目标

在服务端建立三个很薄的契约，让客户端**有能力证明**画面是新鲜的、指令是被收下的：

1. **session 身份**：每个 `SharedTerminalSession` 有 `sessionId`，随 snapshot 下发。
   PTY session 一换（服务重启、命令退出重开），客户端立刻能看出来，从而不敢盲目重送旧指令。
2. **输出序号**：PTY output 带 session 内单调 `seq`；snapshot 带 `outputWatermark`，
   让客户端能丢掉"snapshot 里已经包含过"的缓存输出，画面不出现重复字符。
3. **原子 input-action**：整条语音指令用带 ID 的独立消息发送，服务端回
   `input-accepted` / `input-rejected`，并在 session 内用容量 128 的 FIFO Map 去重——
   确认帧丢了、客户端用同一 ID 重送，PTY **不会被写第二次**。

外加一条债务清算：`src/session.ts:120` 那个 `.catch(() => {})` 把 mirror 写失败整个吞掉，
而 snapshot 正是从 mirror 序列化出来的。吞掉它，"画面是新鲜的"这个承诺就是假的。本卡改成
fail-loud。

交付对象：T3（客户端重连）与 T4（composer 原子提交）会消费这套协议。

设计出处：`docs/designs/weak-network-experience.md` §1、§3 + Implementation Tasks · T2。

## 非目标

- **不改客户端**：`src/client-entry.ts`、`src/reconnect.ts`、`src/controls/**` 一行都不碰（T3/T4 的活）。
- 不做协议版本协商、不做能力握手、不做 feature flag。加法式扩展，旧 `{type:'input',data}` 原样保留。
- 不做增量 snapshot / 差分传输。snapshot 继续是全量序列化。
- 不做跨进程 exactly-once、不建数据库、不做 TTL/持久化日志。服务重启就是换一个 `sessionId`，
  由客户端负责不自动重送——**不许在服务端假装能跨重启保证。**
- 不改 `src/serve.ts`。它的 `SessionClient.send` 里那个 `try{}catch{}`（`serve.ts:352-374`）
  是"关闭中的 raw.send 竞态"，设计明确判定可以忽略，本卡不动它。
- 不改 CSP / Origin / Host 校验、不改 `.github/`、不改发布配置。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：340
- **Diff-Lines-Hard**：640
- **阶段**：implementing
- **锁定决策**：

  1. **sessionId**：`SharedTerminalSession` 构造时 `crypto.randomUUID()` 生成一次，
     整个 session 生命周期不变，**只**在 snapshot 消息里下发。不加到 output/exit/pong 上。
  2. **output seq**：session 内从 `1` 开始单调递增，每个 `pty.onData` 分配一个。
     ```ts
     export interface OutputMessage { readonly type: 'output'; readonly data: string; readonly seq: number }
     ```
  3. **snapshot**：
     ```ts
     export interface SnapshotMessage {
       readonly type: 'snapshot'
       readonly data: string
       readonly sessionId: string
       readonly outputWatermark: number
     }
     ```
  4. **snapshot 稳定循环**（这是本卡最容易写错的一处，形状锁死）：
     ```ts
     private async snapshot(): Promise<{ data: string; outputWatermark: number }> {
       for (;;) {
         const pending = this.pendingMirrorWrite
         await pending
         if (this.pendingMirrorWrite !== pending) continue  // 期间来了新 output，重来
         // 同一个 event-loop turn 内完成序列化，中间不许再 await
         return {
           data: this.serializeAddon.serialize() + this.serializeMouseEncoding(),
           outputWatermark: this.outputSeq,
         }
       }
     }
     ```
     正确性依据：`pty.onData` 里**先**把 mirror write 挂上 `pendingMirrorWrite` 链、**再**分配 seq
     并广播（顺序见决策 5）。链排空且引用未变 ⇒ 当前 `outputSeq` 对应的每一条 data 都已写进
     mirror ⇒ 序列化结果包含全部 `seq <= outputWatermark` 的输出。**`return` 之前不许再有 `await`**，
     否则 watermark 与 data 会错位。
  5. **`pty.onData` 内的顺序**固定为：分配 `seq` → 把 mirror write 挂上 `pendingMirrorWrite` 链
     → `broadcast({type:'output', data, seq})`。三步都在同一个同步块里，中间不许 await。
  6. **mirror 失败 fail-loud**（替换 `session.ts:120` 的 `.catch(() => {})`）：
     - 记录**粘性** session 错误（一次失败后永久为真，不自愈）；
     - 向当前所有 client 广播 `{type:'error', message:'Terminal mirror failed; restart remobi.'}`
       ——**message 里不许出现任何终端正文或用户输入**；
     - 关闭所有 client 连接；
     - 之后 `addClient()` 直接发同样的 error 并 close，**不入 clients 集合**；
     - 之后所有 `input-action` 一律 `input-rejected(session-unavailable)`。
  7. **heartbeat 带 ID**：
     ```ts
     export interface PingMessage { readonly type: 'ping'; readonly id: string }
     export interface PongMessage { readonly type: 'pong'; readonly id: string }
     ```
     服务端收到合法 ping 就原样回同 `id` 的 pong。**旧的无 id `{type:'ping'}` 从此是协议违规**
     （parse 返回 `null` → 现有 `closeForProtocolViolation` 路径）。这是安全的破坏性变更：
     现场事实节已核实**当前客户端从不发 ping**，没有存量 producer。
  8. **原子 action 三消息**：
     ```ts
     export interface InputActionMessage { readonly type: 'input-action'; readonly id: string; readonly data: string }
     export interface InputAcceptedMessage { readonly type: 'input-accepted'; readonly id: string }
     export type InputRejectedReason = 'id-conflict' | 'pty-write-failed' | 'session-unavailable'
     export interface InputRejectedMessage { readonly type: 'input-rejected'; readonly id: string; readonly reason: InputRejectedReason }
     ```
     - `id` 边界：非空字符串，UTF-8 ≤ `MAX_ACTION_ID_BYTES = 128`（uuid 是 36 字节）。
     - `data` 边界：沿用现有 `MAX_CLIENT_INPUT_BYTES`（256 KiB）与同一个 UTF-8 字节计数函数。
     - **拿不到可靠 ID 就不许伪造 rejected**：id 缺失/非 string/空串/超长、data 缺失/超限、
       畸形 JSON、未知 type —— 一律走现有协议违规策略关闭连接，**不发 rejected**。
       只有"结构合法且 ID 已取到"的 action 才配拿到 accepted/rejected。
  9. **去重 Map 与写入顺序**（顺序锁死，写反了就等于假装收下）：
     ```
     收到合法 input-action(id, data)
       ├─ session 不可用（已 exited 或 mirror 粘性错误）
       │    → send input-rejected(id, 'session-unavailable') → 关闭该 client 连接
       ├─ Map 命中 id
       │    ├─ 记录的 data === 本次 data → send input-accepted(id)   // 不再 pty.write
       │    └─ 记录的 data !== 本次 data → send input-rejected(id, 'id-conflict')  // 不 pty.write
       └─ Map 未命中
            ├─ try { this.pty.write(data) }
            │    catch → send input-rejected(id, 'pty-write-failed')  // 不写 Map
            └─ 成功 → map.set(id, data) → 淘汰超出 128 的最旧项 → send input-accepted(id)
     ```
     **必须是「write 成功 → 写 Map → 发 accepted」这个顺序**：accepted 在网络上丢了的时候，
     客户端重送同 ID 才能命中 Map、拿到补发的 accepted 而不是第二次 PTY 写入。
  10. **FIFO 容量 128**，用 `Map` 的插入序实现（`map.size > 128` 时删 `map.keys().next().value`）。
      生命周期 = 该 PTY session，不设 TTL、不落盘。淘汰后同 ID 重送**会**再写一次 PTY——
      这是已知且被接受的边界（单用户单 pending 流程下，pending 未确认就不会产生后续 action），
      测试要**诚实锁死这个行为**，不许加特判去掩盖。
  11. **legacy input 不变**：`{type:'input', data}` 继续无回执，session 已退出时继续静默忽略
      （`session.ts:183`）。resize 逻辑与边界完全不变。
  12. `handleClientMessage` 的签名可以扩展（它已经拿到 `client`），但**不新增 session 之外的
      新类/新模块**。去重 Map 就是 `SharedTerminalSession` 的一个私有字段。

- **任务类型**：backend-logic
- **复杂度**：M
- **Base commit**：ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb（origin/main；若已前进，用新的 origin/main sha 作 base 并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读；同批并行的 T1 卡只碰 `src/controls/**`，与本卡零重叠）
- **执行器与模型**：codex（`delegate --class big`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与验收；review 按仓 `risk-tier: personal`，
  P1 红线 = 数据丢失 / 静默出错 / 崩溃。**本卡改动核心是失败路径、状态迁移与资源账本
  （去重 Map），按 infra/状态机例外，收敛条件升一档：连续 2 轮无新增 P1。**

## 修改边界

- **允许**：
  - `src/session-protocol.ts`
  - `src/session.ts`
  - `tests/session-protocol.test.ts`
  - `tests/session.test.ts`
  - `tests/session-action.test.ts`（本卡可新增；也可并进 `tests/session.test.ts`）
  - `tests/serve-abuse.test.ts`（**只允许新增**真 WebSocket 帧断言用例，不得改动现有用例语义）
- **禁止**：`src/client-entry.ts`、`src/reconnect.ts`、`src/controls/**`、`src/asr/**`、
  `src/types.ts`、`src/serve.ts`、`src/config.ts`、`styles/base.css`、`.github/`、
  `CHANGELOG.md`、`package.json`、`pnpm-lock.yaml`
- **Scope-Globs**：src/session-protocol.ts src/session.ts tests/session-protocol.test.ts tests/session.test.ts tests/session-action.test.ts tests/serve-abuse.test.ts
- **高风险区域**：
  - **`addClient` 的三段竞态**（`session.ts:146-174`）：先查 `exited` → `clients.add` →
    `await snapshot()` → send snapshot → **再查一次 `exited`** 处理 await 期间的退出。
    改成新 snapshot 形状后这三段都要跟着改，第二次 exited 检查不许丢。
    另外要新增第四种情况：await 期间 mirror 出粘性错误。
  - **`OutputMessage` 加了必填 `seq`** ⇒ 所有构造 output 的地方都要跟着改。
    封笔前 `grep -rn "type: 'output'" src/ tests/` 一遍，一个不许漏。
    `PingMessage`/`PongMessage` 加 `id` 同理：`grep -rn "'ping'\|'pong'" src/ tests/`。
  - `session.test.ts:` 现有 10 个用例里有 3 个直接断言 snapshot / exit 行为
    （SGR mouse encoding、迟到 client 收最终 snapshot + exit），改 snapshot 形状会打穿它们，
    必须一起更新且**保持原有断言意图**，不许把断言删掉了事。
  - `pty.write` 在 node-pty 里是同步调用，但异常形态取决于底层。只在这一次调用边界 catch
    **同步**异常并转 rejected；不许把 catch 范围扩大到整个 handler，否则会把编码 bug 也
    伪装成 `pty-write-failed`。

## 不变式轴表

### 轴 1：action id × data × session 状态

| Map 里有 id？ | 本次 data 与记录 | session 状态 | 期望（PTY 写入次数 / 回帧） |
|---|---|---|---|
| 否 | — | 正常 | 写 1 次 → Map 写入 → `input-accepted(id)` |
| 是 | 相同 | 正常 | **写 0 次** → 再发一次 `input-accepted(id)` |
| 是 | 不同 | 正常 | **写 0 次** → `input-rejected(id,'id-conflict')` |
| 否 | — | `pty.write` 抛异常 | **Map 不写** → `input-rejected(id,'pty-write-failed')` |
| 否 | — | session 已 exited | `input-rejected(id,'session-unavailable')` → 关闭连接 |
| 否 | — | mirror 粘性错误 | `input-rejected(id,'session-unavailable')` → 关闭连接 |
| 是（第 1 条，已被第 129 条挤掉） | 相同 | 正常 | 诚实结果：**再写 1 次** + accepted（锁死 FIFO 淘汰语义，不许掩盖） |

### 轴 2：output seq × snapshot watermark

| 场景 | 检测点 |
|---|---|
| 尚无任何 output 时 attach | `outputWatermark === 0`，snapshot.data 为初始态 |
| N 条 output 后 attach | `outputWatermark === N`；snapshot.data 包含这 N 条的全部内容 |
| attach 的 await 期间又来了 M 条 output | 稳定循环终止（不死循环）；返回的 watermark 与 data 一致——即 data 里包含且仅包含 `seq <= watermark` 的输出 |
| 连续 output | `seq` 严格递增 1,2,3…，无重复、无跳号 |
| 两个 client 同时在线 | 两者收到相同 `seq` 序列；各自 attach 时刻的 watermark 可以不同 |
| session 已 exited 后 attach | 仍先发 snapshot（带 sessionId 与 watermark）→ 再发 exit → close，且**不入** clients 集合 |

### 轴 3：ping id

| ping 帧 | 期望 |
|---|---|
| `{"type":"ping","id":"abc"}` | 回 `{"type":"pong","id":"abc"}` |
| `{"type":"ping"}`（缺 id） | parse → `null` → 协议违规关闭连接 |
| `{"type":"ping","id":""}` | 同上 |
| `{"type":"ping","id":123}` | 同上 |
| `id` 超过 128 字节 | 同上 |

### 轴 4：mirror 失败

| 时机 | 期望 |
|---|---|
| 在线期间 mirror.write 失败 | 广播不含终端正文的 `error` → 关闭全部 client；粘性标记置位 |
| 粘性错误后新 client `addClient` | 发同样的 error 并 close，**不入** clients 集合，不发 snapshot |
| 粘性错误后收到 `input-action` | `input-rejected(id,'session-unavailable')` |
| 粘性错误后收到 legacy `input` | 静默忽略（与已 exited 行为一致），不崩溃 |

表驱动测试必须覆盖上面四张表的每一格。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**（从 T3/T4 客户端视角看）：
  1. 连上 `/ws`，第一帧 snapshot 里能读到 `sessionId` 和 `outputWatermark`。
  2. 后续 output 帧带严格递增的 `seq`。
  3. 发 `input-action` 能拿到 `input-accepted`；同 ID 同 data 再发一次，**终端里只出现一次**。
  4. 同 ID 不同 data 拿到 `id-conflict` 且终端毫无变化。
  5. 重启 remobi 后 `sessionId` 变成另一个值。
- **相关测试**：`pnpm test`（全量，禁止用 `-k` 子集代替）。
  封笔前跑一遍引用扫描并把结果贴进报告：
  `grep -rn "type: 'output'\|'ping'\|'pong'\|parseClientMessage\|parseServerMessage\|handleClientMessage\|addClient" src/ tests/`
- **跨发布边界验收**（本卡的硬要求，不许省）：WebSocket 是真实的跨进程序列化边界。
  **必须至少有 2 个用真实 WebSocket 连接、断言原始帧字符串的集成测试**
  （模板：`tests/serve-abuse.test.ts` 已经起了真 server + 真 ws）：
  1. 连上后收到的第一帧，`JSON.parse` 后含非空 `sessionId`（uuid 形状）与数值 `outputWatermark`；
  2. 发一条 `input-action` 收到 `input-accepted` 帧；**用同一 id + 同一 data 再发一次**，
     再次收到 `input-accepted`，而终端里那段文本**只出现一次**。
     建议用 `cat` 作为被 spawn 的命令（写什么回显什么，数出现次数最直观），
     或用能稳定回显的等价方式；具体手法自定，但"只出现一次"必须是**从真实 output 帧数出来的**，
     不许改成断言内部 Map 的 size。
  仅断言 `SharedTerminalSession.send` 收到的对象参数**不算**过这一条——那是同进程调用，
  越不过序列化边界。
- **概率性验收**：snapshot 稳定循环与 attach 竞态属于时序改动。
  `pnpm exec vitest run tests/session.test.ts tests/session-action.test.ts` **连续跑 5 次全绿**
  才算过，把 5 次的结果都贴进报告。主脑验收会同样抽跑 ≥5 次。
- **接口契约**（T3/T4 会照这份实现客户端，签名即契约，不许改名）：
  ```ts
  // src/session-protocol.ts
  export interface InputMessage { readonly type: 'input'; readonly data: string }               // 不变
  export interface ResizeMessage { readonly type: 'resize'; readonly cols: number; readonly rows: number } // 不变
  export interface PingMessage { readonly type: 'ping'; readonly id: string }                   // 加 id
  export interface InputActionMessage { readonly type: 'input-action'; readonly id: string; readonly data: string }
  export type ClientMessage = InputMessage | ResizeMessage | PingMessage | InputActionMessage

  export interface SnapshotMessage { readonly type: 'snapshot'; readonly data: string; readonly sessionId: string; readonly outputWatermark: number }
  export interface OutputMessage { readonly type: 'output'; readonly data: string; readonly seq: number }
  export interface ExitMessage { readonly type: 'exit'; readonly exitCode: number; readonly signal: number | null } // 不变
  export interface ErrorMessage { readonly type: 'error'; readonly message: string }            // 不变
  export interface PongMessage { readonly type: 'pong'; readonly id: string }                   // 加 id
  export type InputRejectedReason = 'id-conflict' | 'pty-write-failed' | 'session-unavailable'
  export interface InputAcceptedMessage { readonly type: 'input-accepted'; readonly id: string }
  export interface InputRejectedMessage { readonly type: 'input-rejected'; readonly id: string; readonly reason: InputRejectedReason }
  export type ServerMessage =
    | SnapshotMessage | OutputMessage | ExitMessage | ErrorMessage | PongMessage
    | InputAcceptedMessage | InputRejectedMessage

  export const MAX_ACTION_ID_BYTES = 128
  // MAX_CLIENT_MESSAGE_BYTES / MAX_CLIENT_INPUT_BYTES / MAX_RESIZE_COLS / MAX_RESIZE_ROWS 不变
  ```
  **禁止**新增 `ActionLedger` / `DedupeStore` / `SessionRegistry` 之类的类或模块——
  去重 Map 是 `SharedTerminalSession` 的私有字段，`sessionId` 是它的私有只读字段。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **截图或探活**：不需要截图。报告里贴出**真实 WebSocket 集成测试里抓到的原始帧字符串**
  （至少一条 snapshot 帧、一条 output 帧、两条 input-accepted 帧），证明线上格式与契约一致。
- **现场还原**：停在卡分支；不要改主仓 checkout；不要留下跑测试时起的 PTY 进程
  （测试收尾必须 `dispose()`）。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①协议类型与边界（含 ping id）+ 协议单测 ②sessionId + output seq + snapshot 稳定循环
  ③input-action 去重 Map 四态 ④mirror fail-loud ⑤真 WebSocket 帧集成测试 至少 5 次提交**，
  每步测试绿了就提交，不要攒到最后。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言
  恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原
  刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个
  二级标题之前，必须恰好出现一行机读 outcome：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取，2026-08-20，来自只读代码勘查）**：
  - `origin/main` = `ba25ddf`；工作区干净；无 open PR。
  - **现有协议共 8 种消息**（`src/session-protocol.ts`，147 行，全文即协议层）：
    client→server = `input` / `resize` / `ping`（`:1-16`）；
    server→client = `snapshot` / `output` / `exit` / `error` / `pong`（`:23-53`）。
    **没有任何 seq / ack / sessionId / resume 概念**——这就是本卡要补的空白。
  - 现有常量（`:18-21`）：`MAX_CLIENT_MESSAGE_BYTES = 256*1024`（同时用作 `wss.options.maxPayload`）、
    `MAX_CLIENT_INPUT_BYTES = 256*1024`、`MAX_RESIZE_COLS = 500`、`MAX_RESIZE_ROWS = 200`。
    UTF-8 字节计数用模块级 `TextEncoder`（`:63`）+ `isInputWithinLimit`（`:65-67`）——**复用它**。
  - parse 失败一律 `return null`（`:104-106` / `:144-146`），调用方走
    `serve.ts:388-412` 的 `closeForProtocolViolation`。本卡的"无可靠 ID 就关连接"直接复用这条路。
  - **`ping` 目前只有服务端被动回 pong（`session.ts:193`），客户端从不发 ping**
    （`client-entry.ts` / `serve.ts` 全文零命中）。所以给 ping 加必填 `id` **没有存量 producer 会断**。
  - `SharedTerminalSession` 私有字段在 `session.ts:74-81`：
    `pty` / `mirror` / `serializeAddon` / `clients: Set<SessionClient>` / `exitPromise` /
    `exitResolve` / `exited: SessionExit | null` / `pendingMirrorWrite: Promise<void>`。
  - **`pty.onData` 当前实现（`session.ts:112-123`）——本卡的两个改点都在这 12 行里**：
    ```ts
    this.pty.onData((data) => {
      this.pendingMirrorWrite = this.pendingMirrorWrite
        .then(() => new Promise<void>((resolve) => { this.mirror.write(data, resolve) }))
        .catch(() => {})          // ← :120 唯一显式静默吞错，本卡要替换
      this.broadcast({ type: 'output', data })   // ← 要加 seq
    })
    ```
    注意现有顺序已经是"先挂 mirror write、再广播"，正好是决策 5 需要的顺序。
  - 现有 snapshot（`session.ts:211-229`）：
    ```ts
    private async snapshot(): Promise<string> {
      await this.pendingMirrorWrite
      return this.serializeAddon.serialize() + this.serializeMouseEncoding()
    }
    ```
    只 await 一次、不检查 promise 是否被替换——这正是决策 4 要修的地方。
    `serializeMouseEncoding()`（`:220-229`）读 `mirror._core?.coreMouseService?.activeEncoding`，
    `'SGR' → '\x1b[?1006h'`、`'SGR_PIXELS' → '\x1b[?1016h'`，**保持不变**。
  - `addClient`（`:146-174`）的竞态三段见上文「高风险区域」。`broadcast`（`:231-235`）是私有的
    `for (const client of this.clients) client.send(message)`，无背压、无失败感知——本卡不改它。
  - `handleClientMessage`（`:180-197`）：`input`/`resize` 在 `this.exited` 时**静默 return**
    （`:183` / `:188`），`ping` 回 pong（`:194`）。
  - `serve.ts` 的第二处静默 catch 在 `:352-374`（`raw.send` 竞态），设计判定可忽略，**本卡禁止改**。
  - 现有测试：`tests/session-protocol.test.ts`（45 行 / 6 用例）、`tests/session.test.ts`
    （183 行 / 10 用例，含 SGR mouse encoding 与迟到 client 收最终 snapshot+exit）、
    `tests/serve-abuse.test.ts`（206 行，**已有真 server + 真 WebSocket 的脚手架，照抄它**）。
  - **测试缺口（现状）**：全仓没有任何针对重连后 snapshot 一致性、消息去重、弱网时序的测试。
- **机理/根因陈述**：
  - `snapshot 不能证明画面新鲜` 的根因是 snapshot 与 output 之间没有共同的序号基准
    （证据锚点：`src/session-protocol.ts:23-31`，两种消息都只有 `data`），
    客户端无法判断缓存的 output 有没有已经被 snapshot 包含。
  - `mirror 写失败被吞` 证据锚点：`src/session.ts:120` `.catch(() => {})`；
    而 snapshot 正是 `serializeAddon.serialize()` 从这同一个 mirror 读出来的（`:213`）。
    因此 mirror 静默失败 ⇒ snapshot 静默失真 ⇒「已同步」是假的。
- **已完成**：设计文档已过 CEO + Eng review（`docs/designs/weak-network-experience.md`，
  状态 APPROVED / CLEAR，无未决产品决策）。
- **未完成**：本卡的全部实现。
- **关键决策**：本卡与 T1（草稿持久化）并行派发——两张卡文件范围零重叠
  （本卡 `src/session*.ts`，T1 `src/controls/**`），不存在产物依赖。
  T3（客户端重连）硬依赖本卡的协议产物，本卡合并后才派。
- **已否决方案**（不得重新提起）：协议版本协商、能力握手、增量 snapshot、
  跨进程 exactly-once、持久化日志/数据库、去重 Map 加 TTL、把 `id` 做成 legacy `input` 的可选字段
  （会制造模糊协议分支，Eng review P2 已判定）。
- **下一步唯一动作**：先落协议类型与边界校验（含 ping 加 id）并让 `tests/session-protocol.test.ts` 全绿。
