# 任务卡：弱网 T4 — composer 原子提交闭环（accepted / unknown / rejected）

## 目标

让用户提交一整条长语音指令之后，能得到一个**诚实的**结果状态，并且这条指令**不会被写进
终端两次**。

今天的情况：`sendData(term, text)` 发出去就完事，没有任何回执，用户无从判断服务端收没收到
（`mic-controller.ts:406`）；`autoEnter` 的回车还是**第二次**独立发送（`:421`），
正文成功而回车丢失是可达状态；断线重连后草稿和"到底发出去没有"一起变成谜。

本卡接上 T2 的 `input-action` / `input-accepted` / `input-rejected` 协议与 T3 的 `synced` 状态，
把提交做成：**先落盘 pending → 发一个带 ID 的原子 action → 拿到 accepted 才算收下**；
确认丢了就用同一个 ID 重送，服务端的 128 条去重 Map 保证 PTY 只被写一次。

这是设计文档三条用户可感知不变式里的第三条，也是最后一块。

设计出处：`docs/designs/weak-network-experience.md` §3「提交不重不漏」+ Implementation Tasks · T4。

## 非目标

- **不做跨服务重启的 exactly-once**，也不许在任何文案里暗示它。`accepted` 的语义**只有**
  「remobi 服务端成功调用了当前 PTY 的 `write(data)`」——不代表操作系统已落盘，
  更**不代表 Herdr 已经执行完**。文案里不许出现"已执行""已完成"。
- 不做通用 outbox / 消息总线 / IndexedDB 队列 / 多条并发 pending。**同一时刻最多一个 pending。**
- 不给普通逐键输入加确认（legacy `input` 保持无回执）。
- 不改服务端（T2 已合并）、不改连接状态机（T3 已合并）。
  本卡在 `client-entry.ts` 里只**新增**三个桥接方法，不动 T3 的状态机内核。
- 不做多标签页协同、不做多设备同步、不做草稿历史。
- 不新增页面或导航。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：380
- **Diff-Lines-Hard**：700
- **阶段**：implementing
- **锁定决策**：

  1. **提交流程顺序锁死**（每一步的先后都是有意的，不许重排）：
     ```
     点击 Send
      ├─ 已有 pending（status ∈ {pending, unknown}）→ 按钮本就该禁用；防御性 return
      ├─ sourceText = preview.getText()
      ├─ sourceText 为空 → 'Type or speak something to send.'，return
      ├─ 不是 synced → 'Not sent — still syncing.'，return（草稿保留）
      ├─ await runBeforeSendData({ data: sourceText, … })     ← 只在用户首次点击时跑
      ├─ await 返回后【重新】检查 composer generation 与 synced；任一变了 → return
      ├─ before.blocked → return（不生成 action、不落 pending）
      ├─ body = sanitizeVoiceText(before.data)
      ├─ body 为空 → 'Speech contained no printable text.'，return（**不发孤立 \r**）
      ├─ data = config.asr.autoEnter ? body + '\r' : body      ← 回车就在这一个字符串里
      ├─ sessionId = term.getSessionId()；为 null → 'Not sent — still syncing.'，return
      ├─ id = crypto.randomUUID()
      ├─ 【先】持久化 pending = { id, sessionId, sourceText, data, status: 'pending' }
      ├─ 【后】term.sendInputAction(id, data)
      ├─ 启动 15 秒结果 deadline
      └─ await runAfterSendData({ data })                     ← 只在首次浏览器发送后跑一次
     ```
     **「先落盘、后发送」不许调换**：反过来的话，发出去的瞬间页面被杀掉，用户就永远不知道
     那条指令去哪了。
  2. **autoEnter 必须在同一个 `data` 里**。删掉现有的
     `sendData(term, text)`（`:406`）+ `sendData(term, '\r')`（`:421`）两次写。
     一次提交 = 一个 action = 一次 PTY write。
  3. **accepted 处理**（id 匹配当前 pending）：
     - 清结果 deadline；
     - **无条件**删除 pending；
     - **只有** `preview.getText() === pending.sourceText` 时才一并清空 draft——
       用户在等待期间改出来的新文本必须留着；
     - Send 按钮立即恢复可用；
     - 状态文案 `Received by terminal.`（不是"已执行"）。
  4. **rejected 处理**：保存 `reason`，`status = 'rejected'`，**停止自动重送**，文案固定：
     | reason | 文案 | 允许的动作 |
     |---|---|---|
     | `pty-write-failed` | `Not received: terminal write failed.` | 用**原 ID** 手动重试 / 放弃 |
     | `id-conflict` | `Not received: duplicate submission id.` | **只能**放弃后重新输入 |
     | `session-unavailable` | `Not received: terminal session unavailable.` | **只能**放弃后重新输入 |
  5. **15 秒无响应 → `status = 'unknown'`**，文案
     `Result unknown — the terminal may or may not have received it.`
     同一条连接上**不自动盲重试**。
  6. **自动重送规则**（严格，越界就是重复执行命令的风险）：
     - 仅当 `synced` **且** `term.getSessionId() === pending.sessionId`；
     - `status ∈ {pending, unknown}` 才重送，`rejected` **绝不**重送；
     - **每个 epoch 至多一次**（记住已重送过的 epoch 编号）；
     - 重送用**同一个 id、同一个 data**；
     - 重送**不跑** before/after hook（传输层重试不是新的业务动作）。
  7. **sessionId 变了**（新 snapshot 的 sessionId ≠ pending.sessionId）：
     `status = 'unknown'`，**禁止**自动重送，文案
     `Terminal session changed — last result unknown.`，由用户看着屏幕自己判断重试还是放弃。
  8. **pending 的三条清理路径，仅此三条**：①匹配的 accepted；②用户明确点「放弃本次待确认提交」；
     ③用户清空全部草稿并**二次确认**连 pending 一起放弃。
     「放弃」的文案必须诚实——只说"已从本机移除"，**不许**说"服务端未收到"。
  9. **UI**（贴着发送按钮，不新增页面）：
     - pending / unknown 存在时 **Send 按钮禁用**（防双击、防第二个并发 action），
       但 textarea **仍可编辑且继续持久化**；
     - pending / unknown / rejected 时显示「重试」与「放弃」两个动作（按决策 4 决定重试是否可用）；
     - 状态区用 `aria-live="polite"`，**文字 + 图标，不许只靠颜色**区分状态；
     - **关闭 composer 不删除 pending**；重开时状态照旧显示。
  10. **服务端版本不匹配不需要本卡单独处理**。T3 已经把"服务端消息解析失败"归成
      `protocol-error` 类的同步前失败——连接会被关掉重连，客户端根本进不了 `synced`，
      而本卡的提交与自动重送都以 `synced` 为前提，所以旧服务端场景自动被挡在门外。
      **不许**为此新增 `protocolMismatch` 状态位或第二条判断路径。
  11. **schema 不变**：直接用 T1 已经定死的 `remobi:composer:v1:${basePath}` 与
      `{version:1, draft, pending}`。本卡只是把 `pending` 字段真正用起来，
      **不许改格式、不许换 key、不许升 version**。

- **任务类型**：frontend-ui
- **复杂度**：L
- **Base commit**：**T3 卡合并进 `origin/main` 之后的那个 sha**（派发时由主脑回填；
  执行器以 `git rev-parse origin/main` 实际值为准并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器与模型**：codex（`delegate --class big`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与验收；review 按仓 `risk-tier: personal`，
  P1 红线 = 数据丢失 / 静默出错 / 崩溃。**本卡改动核心是状态迁移与"不可逆动作"账本
  （PTY 写入），按 infra/状态机例外，收敛条件升一档：连续 2 轮无新增 P1。**
  review 卡将点名一轮降层审查：
  ①在 pending 被最终清理之前，已经发生了哪些**不可逆**动作（PTY 写入、hook 副作用、UI 清空）？
  ②去重守卫用的那个 `id` 在真实部署形态下自身唯一吗（`crypto.randomUUID` 的可用性与 fallback）？
  ③保护覆盖的是"改状态"还是"真实发帧 / 真实写 PTY"？

## 修改边界

- **允许**：
  - `src/client-entry.ts`（只**新增**三个桥接方法 + `input-accepted` / `input-rejected` 的分发）
  - `src/types.ts`
  - `src/controls/mic-controller.ts`
  - `src/controls/asr-preview.ts`
  - `tests/mic-controller.test.ts`
  - `tests/asr-preview.test.ts`
  - `tests/composer-action.test.ts`（本卡新增）
  - `tests/playwright/weak-network.spec.ts`（T3 建的 fixture，本卡追加用例）
  - `styles/base.css`（**仅限** pending/unknown/rejected 状态区与两个动作按钮的样式）
- **禁止**：`src/session.ts`、`src/session-protocol.ts`、`src/serve.ts`、`src/reconnect.ts`、
  `src/asr/**`、`src/config.ts`、`.github/`、`CHANGELOG.md`、`package.json`、`pnpm-lock.yaml`
- **Scope-Globs**：src/client-entry.ts src/types.ts src/controls/mic-controller.ts src/controls/asr-preview.ts styles/base.css tests/mic-controller.test.ts tests/asr-preview.test.ts tests/composer-action.test.ts tests/playwright/weak-network.spec.ts
- **高风险区域**：
  - **`generation` 与 epoch 是两套不同的代际**：`generation` 是 composer 会话代际
    （`mic-controller.ts:106-114`），epoch 是连接代际（T3 引入）。
    自动重送的"每 epoch 至多一次"用的是 **epoch**；before hook await 后的重查用的是
    **generation + synced**。混用会导致要么漏重送、要么重复重送。
  - **`finishSend()`（`mic-controller.ts:172-180`）现在的语义是"发完就清空"**——
    本卡之后"发完"不等于"完成"，清空必须挪到 accepted 到达时，而且要带上
    "draft 未被改过"这个条件。直接沿用旧的无条件清空 = 吃掉用户新写的文本 = P1。
  - **`crypto.randomUUID()` 在非安全上下文不可用**。remobi 的 ASR 本来就要求 HTTPS
    （localhost 例外），`isVoiceInputSupported()`（`mic-controller.ts:59-63`）已经查了
    `isSecureContext`，所以 composer 能开就一定有 `crypto.randomUUID`。
    **报告里要确认这条推理成立**；如果不成立，用可见失败而不是静默降级成弱随机 id。
  - **e2e 的 `autoEnter: true`**：`tests/playwright/asr.config.ts` 开着它，
    `asr.spec.ts:44` 断言"PTY 收到净化字节"。改成单 action 之后这些断言的期望值会变
    （从两帧变一帧），`tests/playwright/asr.spec.ts` **在禁止清单里**——
    如果它红了，把失败输出原样贴进报告交给主脑判断，不要自行放宽实现去迁就旧断言。

## 不变式轴表

### 轴 1：pending 生命周期

| 当前 status | 事件 | 期望 |
|---|---|---|
| 无 pending | 点 Send（synced，正文非空） | **先**写 localStorage pending(status=`pending`)，**后**发帧；顺序可断言 |
| `pending` | 匹配 id 的 accepted | 清 pending；draft 未改 → 一并清空；按钮恢复；文案 `Received by terminal.` |
| `pending` | 匹配 id 的 accepted，但 draft 已被用户改过 | 清 pending；**draft 保留新文本**；按钮恢复 |
| `pending` | `rejected(pty-write-failed)` | status=`rejected`；重试可用；停止自动重送 |
| `pending` | `rejected(id-conflict)` | status=`rejected`；重试**不可用**，只能放弃 |
| `pending` | `rejected(session-unavailable)` | 同上 |
| `pending` | 15 秒无响应 | status=`unknown`，文案 `Result unknown — …` |
| `unknown` | 迟到的匹配 accepted | 仍然清 pending（当前 sessionId + id 匹配） |
| `pending` | 旧 epoch 的迟到 accepted | 不改变当前状态（T3 的 epoch 守卫在前；本卡断言不被打穿） |
| `pending` / `unknown` | 再点 Send | 按钮禁用；即使强行调用也**不产生第二个 action** |
| `pending` | 关闭 composer | pending **保留**；重开后状态照旧显示 |
| `pending` | 用户点「放弃」 | 只清本地 pending；文案不声称服务端未收到 |
| `rejected(pty-write-failed)` | 用户点「重试」 | 用**同一个 id、同一个 data** 重发；**不跑** hook |
| 有 pending | 用户清空全部草稿 | **二次确认**后才连 pending 一起放弃 |

### 轴 2：自动重送 × session × epoch

| pending.sessionId vs 当前 | status | 触发时机 | 期望 |
|---|---|---|---|
| 相同 | `pending` | 新 epoch 进入 synced | 自动重送**一次**（同 id 同 data），不跑 hook |
| 相同 | `pending` | 同一 epoch 内再次触发 | **不重送**（每 epoch 至多一次） |
| 相同 | `unknown` | 新 epoch 进入 synced | 自动重送一次 |
| 相同 | `rejected` | 新 epoch 进入 synced | **不重送** |
| **不同** | `pending` | 新 epoch 进入 synced | status=`unknown`；**禁止**自动重送；文案 `Terminal session changed — …` |
| 当前 sessionId 为 `null` | `pending` | — | 不重送 |
| 连接处于 `protocol-error` 重连中 | 任意 | 非 synced | 不重送（非 synced 本就不重送）；提交被 `synced` 前置守卫挡下 |

### 轴 3：hook 单次语义

| 场景 | before hook | after hook |
|---|---|---|
| 用户首次点 Send | 跑 1 次 | 跑 1 次 |
| 新 epoch 自动重送 | **0 次** | **0 次** |
| 用户手动「重试」（同 id） | **0 次** | **0 次** |
| 服务端重复发来的 accepted | — | **0 次** |
| before await 期间 draft 变了（generation 变） | 跑了 1 次 | **0 次**（整条不发送、不落 pending） |
| before await 期间断线（离开 synced） | 跑了 1 次 | **0 次**（不发送，草稿保留） |
| before 返回 `blocked` | 跑了 1 次 | **0 次**（不生成 action、不落 pending） |
| after hook 收到的 `data` | — | 必须**逐字等于**实际发出的 `data`（含可选 `\r`） |

### 轴 4：autoEnter 原子性

| `asr.autoEnter` | 正文 | 期望发出的帧 |
|---|---|---|
| false | `"hello"` | 恰好 1 帧 `input-action`，`data === "hello"` |
| true | `"hello"` | 恰好 1 帧 `input-action`，`data === "hello\r"` |
| true | sanitize 后为空 | **0 帧** |
| true | 多行文本 | 恰好 1 帧，`data` = 原多行文本 + 一个 `\r` |

表驱动测试必须覆盖上面四张表的每一格。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. 提交一条长指令 → 看到「待确认」→ 收到 accepted → 变「已接收」，草稿清空。
  2. 提交后立刻断网（accepted 丢失）→ 恢复 → 自动重送同一 ID → **终端里那条命令只出现一次**。
  3. 提交后等待期间改了草稿 → accepted 到达 → pending 清了，**新草稿还在**。
  4. 重启 remobi 服务（sessionId 变）→ 旧 pending 变「结果未知」，**不会**被自动重送。
  5. `autoEnter` 开启时，终端里只多出一次回车，不会出现"文本到了、回车没到"或回车重复。
  6. 全程没有任何文案宣称"Herdr 已执行"。
- **相关测试**：`pnpm test`（全量，禁止 `-k` 子集）、`pnpm run test:pw`（两个 project 都跑）。
  封笔前跑引用扫描并贴进报告：
  `grep -rn "sendData\|confirmPreview\|finishSend\|runAfterSendData\|runBeforeSendData\|autoEnter" src/ tests/`
- **跨发布边界验收**（硬要求，两条都要）：
  1. **WebSocket 帧**：断言客户端实际发出的帧**字符串**——`autoEnter` 开启时，
     一次提交**恰好一帧** `{"type":"input-action","id":"…","data":"hello\r"}`，
     不是两帧、不是 `data` 缺回车。
  2. **localStorage**：断言**实际写入的 JSON 字符串**里 pending 的每个字段；
     并且断言**"落盘早于发帧"**——在假 WebSocket 的 `send()` 实现里读一次 localStorage，
     此刻 pending 必须已经在了。
- **概率性验收**：本卡含 15 秒 deadline、自动重送与 epoch 交互，属时序改动。
  `pnpm exec vitest run tests/composer-action.test.ts tests/mic-controller.test.ts`
  **连续跑 5 次全绿**才算过，5 次结果全部贴进报告。主脑验收会同样抽跑 ≥5 次。
- **弱网 e2e**（在 T3 建的 `tests/playwright/weak-network.spec.ts` 里追加）：
  1. 输入长文本 → `context.setOffline(true)` → 点 Send → **不发送**、草稿与提示都在 →
     恢复在线 → 自动重送 → accepted → 终端里**只出现一次**；
  2. 发送成功后立刻离线（模拟 accepted 丢失）→ 恢复 → 同 ID 重送 →
     服务端去重 → 终端里**仍然只有一次**。
     这一条是设计文档 Success Criteria #4，是整个弱网闭环最核心的一条，不许省。
- **接口契约**（在 T3 的 `XTerminal` 上**新增**这三个，不改 T3 已有成员）：
  ```ts
  // src/types.ts
  export interface InputActionResult {
    readonly id: string
    readonly accepted: boolean
    readonly reason: InputRejectedReason | null   // accepted 时为 null
  }
  export interface XTerminal {
    // …T3 的成员全部保留…
    getSessionId(): string | null                  // 当前 epoch snapshot 里的 sessionId
    sendInputAction(id: string, data: string): boolean  // 非 synced → false 且不发帧
    onInputActionResult(handler: (result: InputActionResult) => void): { dispose(): void }
  }
  ```
  单一消费者（composer）为什么仍然必要，报告里要写清楚：普通 `input()` 是**无回执**的
  逐键通道，原子提交需要的是**带 ID 且有回执**的第二条通道，二者语义不同，
  用可选参数糅进 `input()` 会制造模糊分支（Eng review 的 P2 结论）。
  **禁止**新增 `OutboxManager` / `PendingActionStore` / `SubmissionQueue` 之类的类。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **截图或探活**：Playwright 在 `test-results/` 留下 pending / unknown / rejected / accepted
  四张状态截图（Pixel 5），路径写进报告。
- **现场还原**：停在卡分支；不要改主仓 checkout；不要留下 Playwright 起的 serve 进程。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①client-entry 三个桥接方法 + 结果分发 ②提交流程改成单 action（含 autoEnter 合并）
  ③pending 落盘与 accepted/rejected/unknown 状态机 ④自动重送与 session 变化守卫
  ⑤hook 单次语义 ⑥UI 状态区与重试/放弃 ⑦弱网 e2e 两条 至少 7 次提交**，
  每步测试绿了就提交。
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
  - **提交路径全文在 `mic-controller.ts:363-425`（`confirmPreview()`）**，关键行：
    - `:378-381` 空文本守卫 `Type or speak something to send.`
    - `:382-385` 第一次 `isConnected()` 守卫
    - `:387-394` `runBeforeSendData`（context 恒为 `source:'toolbar'`, `actionType:'voice-input'`, `kbWasOpen:false`）
    - `:395` `canSendComposerText(sessionGeneration, wasOpen)` 重查
    - `:397` `sanitizeVoiceText(before.data)`——**sanitize 在 hook 之后**
    - `:398-401` 空正文守卫 `Speech contained no printable text.`
    - `:402-405` 第二次 `isConnected()` 守卫
    - `:406` `sendData(options.term, text)` ← 第一次写
    - `:407-414` `runAfterSendData`
    - `:415` 再次 `canSendComposerText`
    - `:416-422` `autoEnter` 分支，`:417-420` 第三次 `isConnected()` 守卫，
      **`:421` `sendData(options.term, '\r')` ← 独立的第二次写**
    - `:423` `finishSend()`
  - `finishSend()`（`:172-180`）：`generation++` → 清 `baseDraft` → `preview.resetDraft()`
    → 转 `idle` → `setComposerExpanded(true)`。
  - `sendData(term, data)`（`src/util/terminal.ts`）→ `term.input(data, true)`
    → bridge `send({type:'input',data})`（`client-entry.ts:90-92`）——**全程无回执**。
  - `sanitizeVoiceText`（`:66-75`）剥 C0/DEL/C1 + Cf/Zl/Zp；`isVoiceInputSupported()`（`:59-63`）
    查 `isSecureContext` + `getUserMedia`。
  - hook registry（`src/hooks/registry.ts`）：`beforeSendData` 可 `{block:true}` 或改写 `{data}`
    （串行 reduce）；hook 抛异常被 `logHookError` 吞成 console.error，**不影响发送**。
  - `asr.autoEnter` 默认 `false`（`src/config.ts:332`）；
    **e2e 配置 `tests/playwright/asr.config.ts` 把它设成 `true`**。
  - `AsrPreview` 接口（`asr-preview.ts:4-23`）：`element` / `input` / `message` / `isOpen` /
    `getText` / `open` / `close` / `show` / `setPartial` / `showMessage` / `resetDraft` / `clear` /
    `onOpenChange` / `onHeightChange` / `onConfirm` / `onCancel`。
    `onConfirm = (h) => register(sendButton, h)`（`:214`），send 按钮在 `:78-82`。
  - `tests/mic-controller.test.ts` 现有 799 行 / 37 个用例，其中 `:682` 锁着
    hook+sanitize+autoEnter 的顺序、`:740` 锁着 after-send hook 期间断线阻断 autoEnter。
  - `tests/playwright/asr.spec.ts:44` 断言"假麦克风 → mock final → PTY 收到净化字节"，
    在 `autoEnter: true` 下当前期望的是两次写。
- **机理/根因陈述**：
  - `整条指令的送达状态不可判定` 的根因是发送通道无回执：`sendData` → `term.input` →
    `send({type:'input'})`，socket 非 OPEN 就进队列（证据锚点：`src/client-entry.ts:216-222`），
    OPEN 就 `socket.send` 后直接返回，调用方拿不到任何服务端信号。
  - `autoEnter 可能只到一半` 的根因是两次独立发送（证据锚点：
    `src/controls/mic-controller.ts:406` 与 `:421`，中间还隔着一个 await 与两处连接检查）。
- **已完成**：设计文档已过 CEO + Eng review。前置依赖 T1（草稿 schema 与持久化）、
  T2（`input-action` 协议与去重）、T3（`synced` 语义、`ConnectionStatus`、epoch）
  必须**都已合并**进 `origin/main`。
- **未完成**：本卡的全部实现。
- **关键决策**：本卡是整条链的最后一张，串在 T3 之后，同时消费 T1 的存储 schema。
- **已否决方案**（不得重新提起）：通用 outbox / 消息总线、IndexedDB 队列、多条并发 pending、
  跨进程 exactly-once、给普通逐键输入加确认、把 `id` 做成 legacy `input` 的可选字段、
  自动盲重试（同一连接内）、accepted 后无条件清空 draft、多标签页协同。
- **下一步唯一动作**：先在 `client-entry.ts` 落三个桥接方法与结果分发，
  让 `tests/composer-action.test.ts` 能断言"发出的帧字符串"。
