# 任务卡：弱网 T3 — 客户端原地重连与画面新鲜度

## 目标

让用户回到页面时，**能证明**看到的画面是新鲜的，而不是把三十分钟前的旧屏当成最新。

今天的实现做不到这一点：客户端只建一次 WebSocket，没有任何重连（`client-entry.ts:286`），
所谓"重连"是 `reconnect.ts:84-88` 的 `location.reload()` 整页刷新；断线期间敲的每一个键都进了
`queuedMessages`，重连后被**全量重放**进终端（`client-entry.ts:216-222, 292`）；连接状态被
`client-entry` 和 `reconnect` **两个模块各存一份**；`isConnected()` 只代表 socket OPEN，
不代表画面已经跟服务端对齐。

本卡把连接收成一个状态机，唯一事实源在 `client-entry`：epoch 隔离旧连接、snapshot 才算同步、
带 ID 的单在途心跳、前后台强制换新连接、非同步期间不发也不排队。

设计出处：`docs/designs/weak-network-experience.md` §1「恢复可信」+ Implementation Tasks · T3。

## 非目标

- **不新增 `ConnectionManager` 类**（设计明令禁止）。状态、epoch、缓冲、计时器全部留在
  `client-entry.ts` 模块内的模块级变量里。
- **不碰 composer 的原子提交**——`input-action` 的发送、pending 落盘、accepted/unknown/rejected
  全是 T4 的活。本卡只负责让 T4 有一个可信的 `synced` 状态可用。
- 不改服务端（`src/session*.ts`、`src/serve.ts` 一行不碰，那是已合并的 T2）。
- 不改 `src/controls/**`（mic-controller / asr-preview 是 T1/T4 的范围）。
- 不做增量 snapshot、不做终端内容 diff、不做离线输入缓存/重放。
- 不引入 Web Push、通知、Mosh。
- 不给 `ReconnectConfig` 加配置项——退避、deadline 全是模块常量。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：380
- **Diff-Lines-Hard**：700
- **阶段**：implementing
- **锁定决策**：

  1. **唯一事实源**：`client-entry.ts` 拥有 `connect()`、当前 socket、epoch、snapshot 缓冲、
     重连计时器、心跳计时器。`reconnect.ts` **只渲染状态、只转发用户点击**，
     `let disconnected = false`（`reconnect.ts:81`）这类第二份连接真相必须删掉。
  2. **四态**：`'disconnected' | 'reconnecting' | 'syncing' | 'synced'`。
     - `synced` **只能**由当前 epoch 的完整 snapshot 产生。
     - socket OPEN **不等于** synced。
  3. **epoch**：每次 `connect()` 先 `epoch++`。所有 socket 事件处理器闭包捕获自己的 epoch，
     进门第一件事就是 `if (myEpoch !== currentEpoch) return`。旧 socket 的
     open / message / error / close / pong **一律忽略**，不改状态、不写屏、不计失败、不清退避。
  4. **snapshot deadline = 10 秒**：socket open → 进入 `syncing`、重置该 epoch 的
     `snapshotLoaded` 与 output 缓冲、启动 10 秒计时。只有当前 epoch 的 snapshot 能取消它并
     进入 `synced`。到期则主动 `socket.close()`，按**一次"同步前失败"**处理。
  5. **"同步前失败"的定义**（统一口径）：socket 在当前 epoch 收到 snapshot **之前**
     error / close，或 snapshot deadline 到期。连续 3 次之后，UI 显示
     `Connection failed — you may need to re-authenticate.` 外加一个手动刷新按钮；
     **仍然继续按 15 秒重试**，不停。只有用户点那个按钮才 `location.reload()`。
     理由：Cloudflare Access 过期与普通网络故障在浏览器侧无法可靠区分，所以不自动刷新，
     否则会把用户没提交的草稿刷没。
  6. **退避 `[1, 2, 4, 8, 15]` 秒**，15 秒是**单次上限**，第 6 次及以后一直用 15 秒，
     **不设总次数上限**。退避与"连续同步前失败"计数**只在 snapshot 成功应用之后清零**——
     socket OPEN 本身不算恢复成功。
  7. **前后台强制换新连接**：
     - `hidden` / `pagehide`：立即让 `synced` 失效（状态转 `disconnected`）、停掉重连与心跳
       计时器、**主动关闭当前 socket**；
     - `visible` / `pageshow`：**无条件**建新 epoch 连接并重新取完整 snapshot，
       **即使旧 socket 仍然显示 OPEN**。手机上"socket 看着还开着但其实早就死了"是常态，
       这条不许优化成"OPEN 就复用"。
  8. **事件合并**：`online` / `pageshow` / `visibilitychange` 同时到达时只产生**一次**立即尝试。
     任一时刻最多存在**一个**活动 socket、**一个**重连 timer、**一个**在途 ping。
     `online` 仅仅是"可以早点重试"的提示，**不能**当作服务可达的证据。
  9. **心跳（单在途 ping）**：进入 `synced` 后发一次 `{type:'ping', id: crypto.randomUUID()}`
     并启动 **15 秒** pong deadline。收到**当前 epoch 且 id 匹配**的 pong → 清 deadline →
     **等 10 秒**再发下一个（新 id）。id 不匹配的 pong、迟到的 pong **一律不续命**。
     deadline 到期 → 关闭 socket → `disconnected` → 走退避重连。
     心跳只证明链路活着，snapshot 才证明内容收敛。
  10. **output 应用规则**（消费 T2 的 `seq` / `outputWatermark`）：
      - `syncing` 期间到达的 output 先进缓冲（记住各自的 `seq`）；
      - 收到当前 epoch 的 snapshot 后：先 `term.reset()` + 写入 snapshot.data，
        然后**丢弃缓冲里 `seq <= outputWatermark` 的项**，剩下的按 seq 升序应用；
      - snapshot 之后到达的 output 直接应用。
  11. **缓冲上限 1 MiB**（UTF-8 字节，用与协议层同一套 `TextEncoder` 计数）：
      超限立即关闭该 socket，显示 `Output too fast — resyncing.`，按正常退避重连。
      不许让持续刷屏在 10 秒 deadline 内无界吃掉手机内存。
  12. **非 synced 一律不发、不排队、不重放**：
      - **删除 `queuedMessages` 与它的全量 flush**（`client-entry.ts:207, 216-222, 292`）。
        这是当前"断线后按键被重放进终端"的根因，属于会误触发命令的真实危险。
      - 普通 input 在 `disconnected / reconnecting / syncing` 期间**丢弃**，
        并给一次可见提示 `Not sent — still syncing.`
      - **resize 例外且只例外这一个**：非 synced 期间只**覆盖保存最后一个** `{cols, rows}`，
        进入 `synced` 后发送**一次**。
  13. **`isConnected()` / `onConnectionChange()` 的布尔语义收紧为 `synced`**（不再是 socket OPEN）。
      `src/types.ts` 里这两个成员的注释要同步改写清楚。
  14. **服务端消息解析失败 = 协议错误**（这条替代了原先设想的"snapshot 字段存在性守卫"，
      理由见下方「现场事实」里 T2 的实际实现）：
      `parseServerMessage()` 返回 `null` 时——现在是**静默丢弃**（`client-entry.ts:308-311`）——
      改为：
      - 记 `lastFailureReason = 'protocol-error'`；
      - 主动关闭当前 socket，按**一次"同步前失败"**处理，走正常退避重连；
      - 连续失败提示文案里带上版本线索：
        `Connection failed — refresh, and check the server version.`

      这一条同时覆盖两种情况，不需要各写一套：①真正的畸形帧；
      ②**浏览器缓存了新 bundle 而服务端被回滚到旧版本**——旧服务端发的 snapshot 缺
      `sessionId` / `outputWatermark`，T2 的 `parseServerMessage` 会直接判 `null`。
      两种情况的用户出口是同一个：刷新页面。刷新后浏览器从服务端重新取 bundle，
      版本自然对齐（客户端 bundle 是服务端发的，见现场事实）。
      **不做协议版本协商，也不新增 `protocolMismatch` 状态位**——它没有真实触发路径，
      属于反熵条款要撤掉的那种字段。
  15. **两套 overlay 的分工**（现在是重复的两份 DOM）：
      - `reconnect.ts` 的 overlay 负责**连接状态**四种文案 + 两个动作（立即重试 / 重新认证）；
      - `client-entry.ts` 的 `SessionStatusOverlay`（`:137-186, 239-253`）继续只管 **`exit`
        会话结束**那件事，语义不变。
      不要求本卡合并这两份 DOM（那是无关的清理），但**禁止**再新增第三份。

- **任务类型**：frontend-ui
- **复杂度**：L
- **Base commit**：**T2 卡合并进 `origin/main` 之后的那个 sha**（派发时由主脑回填；
  执行器请以 `git rev-parse origin/main` 实际值为准并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器与模型**：codex（`delegate --class big`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与验收；review 按仓 `risk-tier: personal`，
  P1 红线 = 数据丢失 / 静默出错 / 崩溃。**本卡改动核心是失败路径与状态迁移，按 infra/状态机
  例外，收敛条件升一档：连续 2 轮无新增 P1。** review 卡将点名一轮降层审查：
  ①进入 `synced` 之前已经发生了哪些不可逆动作（写屏、发送、reload）？
  ②epoch 这个守卫值在真实部署形态下自身唯一吗？
  ③保护覆盖的是"写状态"还是"实际行为（写屏 / 发帧 / reload）"？

## 修改边界

- **允许**：
  - `src/client-entry.ts`
  - `src/reconnect.ts`
  - `src/types.ts`
  - `tests/reconnect.test.ts`
  - `tests/client-connection.test.ts`（本卡新增）
  - `tests/playwright/weak-network.spec.ts`（本卡新增）
- **禁止**：`src/session.ts`、`src/session-protocol.ts`、`src/serve.ts`、`src/controls/**`、
  `src/asr/**`、`src/config.ts`、`styles/base.css`、`.github/`、`CHANGELOG.md`、
  `package.json`、`pnpm-lock.yaml`
- **Scope-Globs**：src/client-entry.ts src/reconnect.ts src/types.ts tests/reconnect.test.ts tests/client-connection.test.ts tests/playwright/weak-network.spec.ts
- **高风险区域**：
  - **`onConnectionChange` 的语义变了**（OPEN → synced），而 `mic-controller.ts:467-471`
    正在订阅它，`tests/playwright/asr.spec.ts:170, 188` 正在断言它的行为。
    本卡**不许改** `src/controls/**`，但**必须**在报告里写明这次语义收紧对 composer 的影响面，
    并确认现有 asr e2e 仍然全绿（如果它们因为语义收紧而红了，说明现有断言依赖的是
    "OPEN 就算连上"，需要在报告里明确列出来交给主脑判断，不要自行放宽实现去迁就旧断言）。
  - **删 `queuedMessages` 会打穿现有断言**：`tests/playwright/asr.spec.ts` 里有
    "断线保留 preview 且不入 send 队列" 的用例，`tests/mic-controller.test.ts:725` 同理。
    删队列之后这些行为应当**更**正确，但断言的措辞可能需要跟着调整——
    只能改 `tests/reconnect.test.ts` 和本卡新增的测试文件，
    `tests/mic-controller.test.ts` 与 `tests/playwright/asr.spec.ts` **在禁止清单里**，
    它们如果红了，把失败输出原样贴进报告交给主脑。
  - `reconnect.test.ts` 现有 15 个用例**几乎全部围绕 `location.reload()` 语义**
    （点按钮 / 点 backdrop / 点 message 各只 reload 一次）。本卡把默认重连从 reload 改成
    原地重连，这些用例必须**重写**成对应四态渲染与"立即重试"的断言，
    **不许直接删掉了事**——「点了就该有反应且只有一次」这个意图要保住。
  - fake timers 是本卡的主要测试手段。`vi.useFakeTimers()` 与 rAF、`fonts.ready`
    （`src/startup-resize.ts`）、xterm 的异步 write 回调容易互相打架，
    测试要显式 `await vi.advanceTimersByTimeAsync(...)` 而不是同步 `advanceTimersByTime`。

## 不变式轴表

### 轴 1：页面生命周期 × 旧 socket 状态

| 事件 | 旧 socket | 期望 |
|---|---|---|
| `hidden` | OPEN 且 synced | 立即离开 synced；停重连/心跳计时器；**主动 close 旧 socket** |
| `pagehide`（persisted=false） | OPEN 且 synced | 同上 |
| `pagehide`（persisted=true，bfcache） | OPEN 且 synced | 同上 |
| `visible` | 旧 socket 仍 OPEN | 建**新** epoch 新 socket；旧 socket 的后续事件被忽略；snapshot 前禁输入 |
| `pageshow`（persisted=true） | 已关闭 | 建新 epoch |
| `visible` + `online` + `pageshow` 同帧触发 | — | **只有一个** socket、一个 timer 被创建 |
| `online`，页面可见且离线中 | 无 socket | 触发一次立即尝试（不等退避走完） |
| `online`，页面 hidden | — | **不**建连接（后台不跑） |

### 轴 2：epoch 守卫（迟到事件）

| 迟到事件（来自旧 epoch） | 期望 |
|---|---|
| snapshot | 不写屏、不进入 synced、不清退避 |
| output | 丢弃，不写屏 |
| pong | **不续命**当前 epoch 的心跳 deadline |
| close / error | 不计"同步前失败"、不触发退避、不改状态 |
| open | 忽略（不进入 syncing） |

### 轴 3：心跳

| 场景 | 期望 |
|---|---|
| 进入 synced | 立刻发一次 ping（带唯一 id），启 15s deadline |
| 收到 id 匹配的 pong | 清 deadline；**10s 后**发下一个（新 id） |
| 收到 id **不**匹配的 pong | 不续命；deadline 继续跑到底 |
| 15s 内无匹配 pong | close socket → `disconnected` → 退避重连 |
| 任意时刻 | 在途 ping 数量恒 ≤ 1 |
| 离开 synced（hidden / 断线） | 心跳计时器被清掉，后台不跑 |

### 轴 4：snapshot × output 交错

| 场景 | 期望 |
|---|---|
| 缓存 seq 1..5，snapshot `outputWatermark=3` | 丢弃 1-3，按序应用 4、5；屏幕无重复字符 |
| 缓存 seq 1..5，watermark=5 | 全部丢弃 |
| 缓存 seq 1..5，watermark=0 | 全部应用 |
| snapshot 之后到达 seq=6 | 直接应用 |
| output 乱序到达（5 先于 4） | 按 seq 升序应用 |
| 缓存累计 > 1 MiB（UTF-8 字节） | close socket；显示 `Output too fast — resyncing.`；正常退避重连 |
| 收到 snapshot 缺 `sessionId`（旧服务端） | `parseServerMessage` 判 null → `lastFailureReason='protocol-error'`；close socket；计一次同步前失败；退避重连 |
| 收到 snapshot 缺 `outputWatermark` | 同上 |
| 收到任意无法解析的服务端帧 | 同上（**不再静默丢弃**） |
| 10 秒无 snapshot | close socket；计一次同步前失败；退避重连 |

### 轴 5：连接状态 × 用户输入

| 状态 | 动作 | 期望 |
|---|---|---|
| `disconnected` | 普通按键 | **不发送、不入队**；提示 `Not sent — still syncing.` |
| `reconnecting` | 普通按键 | 同上 |
| `syncing`（socket 已 OPEN） | 普通按键 | 同上（**OPEN 不是放行条件**） |
| `synced` | 普通按键 | 正常发送一帧 `input` |
| 非 synced | resize ×3（不同值） | 一帧都不发；只保留最后一个值 |
| 非 synced → synced | — | 发送**一次** resize，值为保留的最后一个 |
| `synced` | resize | 直接发送（现状不变） |

### 轴 6：退避与失败计数

| 场景 | 期望 |
|---|---|
| 连续第 1/2/3/4/5 次同步前失败 | 下次重连延迟 1s / 2s / 4s / 8s / 15s |
| 第 6 次及以后 | 恒 15s，**不停止重试** |
| 第 3 次同步前失败 | UI 出现 `Connection failed — you may need to re-authenticate.` + 手动刷新按钮 |
| socket OPEN 但 snapshot 超时 | 算**一次**同步前失败（不因为 OPEN 过就清零） |
| snapshot 成功应用 | 退避与失败计数**清零**，重新认证提示消失 |
| 页面 `hidden` 期间 | 重连计时器不运行（回到前台才立即尝试） |
| 用户点"立即重试" | 立刻尝试一次并重置当前等待，但**不**清零失败计数 |

表驱动测试必须覆盖上面六张表的每一格。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. 断网 → 界面**不再**显示"已连接/已同步"；恢复网络后**只有**应用了当前连接的 snapshot
     才回到 synced。
  2. 断网期间敲键盘 → 恢复后终端里**不会**冒出那些按键（队列重放已彻底删除）。
  3. 锁屏 30 分钟回来 → 强制新连接 + 完整 snapshot，画面与服务端一致。
  4. 弱网期间终端持续输出 → 恢复后画面收敛到最新，且**没有重复字符**。
  5. 连续失败 3 次 → 出现"可能需要重新认证"，草稿仍在，点了才刷新。
- **相关测试**：`pnpm test`（全量，禁止 `-k` 子集）、
  `pnpm exec playwright test tests/playwright/weak-network.spec.ts`（两个 project 都跑）。
  封笔前跑引用扫描并贴进报告：
  `grep -rn "isConnected\|onConnectionChange\|__remobiSockets\|queuedMessages\|setupReconnect" src/ tests/`
- **跨发布边界验收**（硬要求）：WebSocket 是真实的序列化边界。
  测试必须断言**客户端实际发出的帧字符串**（用假 WebSocket 捕获 `send(payload)` 的**字符串
  实参**，再 `JSON.parse` 比对字段），至少覆盖：
  1. `syncing` 期间敲键盘 → `send` **一次都没被调用**；
  2. 非 synced 期间 3 次 resize → `send` 零调用；进入 synced 后**恰好一帧** resize，
     且 cols/rows 等于最后那次的值；
  3. 进入 synced 后的第一帧是 `{"type":"ping","id":"..."}`，id 非空。
  只断言内部状态变量**不算**过这一条。
- **概率性验收**：本卡全是时序改动。
  `pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`
  **连续跑 5 次全绿**才算过，5 次结果全部贴进报告。主脑验收会同样抽跑 ≥5 次。
- **e2e 弱网 fixture**（本卡新建，T4 会复用）：仓里目前**没有**任何离线模拟能力
  （`tests/playwright/` 零命中 `setOffline` / `route` / CDP）。本卡用
  `context.setOffline(true/false)` 建一个最小 fixture，至少覆盖：
  - 离线 → 敲键盘 → 恢复 → 终端里没有那些按键；
  - 离线 → 恢复 → 状态回到 synced 且画面与服务端一致。
- **接口契约**（T4 会照这份消费，签名即契约，不许改名）：
  ```ts
  // src/types.ts
  export type ConnectionState = 'disconnected' | 'reconnecting' | 'syncing' | 'synced'
  export type ConnectionFailureReason =
    | 'socket-closed' | 'socket-error' | 'snapshot-timeout'
    | 'heartbeat-timeout' | 'output-overflow' | 'protocol-error'
  export interface ConnectionStatus {
    readonly state: ConnectionState
    readonly consecutivePreSyncFailures: number
    readonly lastFailureReason: ConnectionFailureReason | null
  }
  export interface XTerminal {
    // …现有成员保留…
    isConnected(): boolean                    // 语义收紧：仅当 state === 'synced'
    onConnectionChange(handler: (connected: boolean) => void): { dispose(): void }  // 同上
    getConnectionStatus(): ConnectionStatus
    onConnectionStatusChange(handler: (status: ConnectionStatus) => void): { dispose(): void }
    requestReconnect(): void                  // reconnect.ts 的「立即重试」按钮
  }
  ```
  两个消费者：`reconnect.ts`（渲染四态 + 立即重试）与 T4 的 composer
  （判断能否提交）。**禁止**新增 `ConnectionManager` /
  `SocketController` / `ReconnectPolicy` 之类的类。
  模块常量（写死，不进配置）：
  ```ts
  const SNAPSHOT_DEADLINE_MS = 10_000
  const HEARTBEAT_INTERVAL_MS = 10_000
  const HEARTBEAT_DEADLINE_MS = 15_000
  const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const
  const PRE_SYNC_FAILURES_BEFORE_AUTH_HINT = 3
  const MAX_PRE_SNAPSHOT_OUTPUT_BYTES = 1024 * 1024
  ```
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **截图或探活**：Playwright 在 `test-results/` 留下四态各一张截图
  （disconnected / reconnecting / syncing / synced），路径写进报告。
- **现场还原**：停在卡分支；不要改主仓 checkout；不要留下 Playwright 起的 serve 进程。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①四态 + epoch + connect/退避骨架 ②snapshot deadline 与 seq/watermark 应用规则
  ③1 MiB 缓冲上限 + 字段存在性守卫 ④单在途心跳 ⑤lifecycle 强制换连接与事件合并
  ⑥删队列 + 非 synced 输入守卫 + resize 合并 ⑦reconnect.ts 改成纯渲染 ⑧弱网 e2e
  至少 8 次提交**，每步测试绿了就提交。本卡是全批最大的一张，攒着提交等于把风险堆到最后。
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
  - **T2 已合并的服务端契约**（本卡直接消费，主脑已逐条核对过 diff 与实跑）：
    ```ts
    // src/session-protocol.ts（T2 落地后的实际形状）
    interface PingMessage       { type: 'ping';  id: string }              // id 必填
    interface PongMessage       { type: 'pong';  id: string }
    interface InputActionMessage{ type: 'input-action'; id: string; data: string }
    interface SnapshotMessage   { type: 'snapshot'; data: string; sessionId: string; outputWatermark: number }
    interface OutputMessage     { type: 'output'; data: string; seq: number }   // seq 从 1 开始
    interface InputAcceptedMessage { type: 'input-accepted'; id: string }
    interface InputRejectedMessage { type: 'input-rejected'; id: string; reason: InputRejectedReason }
    type InputRejectedReason = 'id-conflict' | 'pty-write-failed' | 'session-unavailable'
    const MAX_ACTION_ID_BYTES = 128
    ```
    真实 WebSocket 首帧实测长这样（T2 报告贴的原始字符串）：
    `{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"4b5d0e89-…"}`
  - **`parseServerMessage` 对新字段是严格必填**：snapshot 缺 `sessionId` / `outputWatermark`
    直接返回 `null`，output 缺 `seq`（或 `seq <= 0`）同样返回 `null`。
    **这就是决策 14 改成"解析失败 = 协议错误"的原因**——协议层不给"宽松识别旧 snapshot"
    留口子，客户端也就不该自己 `JSON.parse` 绕过它。
  - **客户端 bundle 是服务端发的**：生产走 `scripts/serve-prod.sh` → `tsx cli.ts serve`，
    `build.ts` 在 serve 时用 esbuild 现场 bundle overlay。所以"新客户端 + 旧服务端"
    只可能来自浏览器缓存了旧 bundle 而服务端已更新（或反向的回滚），
    **刷新页面就能让两边版本对齐**——这是决策 14 那条提示要引导用户做的唯一动作。
  - **客户端零重连**：`client-entry.ts:286` 只 `new WebSocket()` 一次；
    `close`/`error`（`:294-301`）只调 `notifyConnectionChange()` + `showSessionStatus()`。
    真正的"重连"是 `reconnect.ts:84-88` 的 `triggerReconnect() = location.reload()`。
  - **队列重放的确切位置**：`queuedMessages`（`:207`）、`send()` 在非 OPEN 时无上限 push
    （`:216-222`）、`open` 时 `flushQueuedMessages` 全量倒出（`:37-43, 292`）。
  - **两份连接状态**：`client-entry.ts:209-212` 的 `connectionListeners` / `lastConnectionState`
    与 `reconnect.ts:81-82` 的 `disconnected` / `reconnectTriggered`。
  - `isConnected()`（`:255-257`）当前 = `socket?.readyState === WebSocket.OPEN`。
    `onConnectionChange()`（`:259-269`）会**立即把当前状态重放给晚订阅者**——这个行为要保留
    （`tests/playwright/asr.spec.ts:170` 锁着它）。
    `notifyConnectionChange()`（`:271-276`）有去重，`error`+`close` 只发一次 false
    （`asr.spec.ts:188` 锁着它）。
  - **snapshot / output 现状**：`snapshotLoaded` 布尔 + `pendingOutput: string[]`（`:211-212`），
    snapshot 分支先 `term.reset()` 再 `term.write(data, cb)`，回调里置位并 flush（`:313-320`）；
    output 未 loaded 时压栈（`:322-328`）。**缓冲无上限**。
  - **页面 lifecycle 目前散在三处**，`client-entry.ts` 里一个都没有：
    `src/index.ts:160-166`（`beforeunload` + `pagehide`，`event.persisted` 时跳过 dispose）、
    `src/reconnect.ts:106-110/120`（`visibilitychange` **仅在找不到 socket 的 fallback 分支注册**）、
    `src/controls/mic-controller.ts:449-457`（hidden 时取消录音）+ `:459-461`（pageshow 恢复草稿，T1 新增）。
  - `syncSize()`（`:224-227`）= `fitAddon.fit()` + `send(resize)`，触发点四处
    （socket open `:291`、window resize `:344`、visualViewport resize `:345`、
    `window.__remobiResize` `:284`），**无节流、无重复值抑制**。
  - `reconnect.ts` 的 `setupReconnect(_term, config)`（`:76`）**第一个参数当前未使用**
    （下划线前缀）——本卡正好用它拿连接状态。
  - `ReconnectConfig`（`types.ts:142-145`）只有 `{ enabled: boolean }`，默认 `true`
    （`config.ts:347`）。`enabled === true` 时 `showSessionStatus` 直接 return
    （`client-entry.ts:240-242`），所以默认配置下生效的是 `reconnect.ts` 那个 overlay。
  - **`reconnect.test.ts` 现有 15 个用例全部围绕 reload 语义**（点按钮/backdrop/message
    各只 reload 一次、非 `/ws` socket 被忽略、fallback 支持 tap）。
  - **e2e 无离线能力**：`tests/playwright/` 下零命中 `setOffline` / `route` / CDP
    `Network.emulateNetworkConditions`；现有唯一"断线"手法是
    `page.evaluate(() => window.__remobiSockets?.[0]?.close())`（`asr.spec.ts:175, 197`）。
    `tests/playwright/isolated-serve.ts` 提供 `reservePort` / `waitForHttp` / `startIsolatedServe`，
    可直接复用。
  - **测试缺口（现状）**：全仓没有任何针对重连状态机、snapshot 一致性、消息去重、
    弱网时序的测试。
- **机理/根因陈述**：
  - `断线后按键被重放进终端` 的根因是无上限队列 + open 时全量 flush
    （证据锚点：`src/client-entry.ts:216-222` 与 `:37-43, 292`）。这不是体验问题——
    重放的按键会真的执行到 Herdr 里去。
  - `"已连接"不代表画面新鲜` 的根因是 `isConnected()` 绑的是 `readyState === OPEN`
    （证据锚点：`src/client-entry.ts:255-257`），与 snapshot 是否已应用完全无关。
- **已完成**：设计文档已过 CEO + Eng review；T2（服务端 `sessionId` / `seq` /
  `outputWatermark` / 带 id 的 ping-pong）是本卡的前置依赖，必须已合并进 `origin/main`。
- **未完成**：本卡的全部实现。
- **关键决策**：本卡串在 T2 之后（硬依赖 T2 的协议字段），与 T1 无依赖关系。
  T4 串在本卡之后（消费 `ConnectionStatus` 与 `synced` 语义）。
- **已否决方案**（不得重新提起）：`ConnectionManager` 通用连接类、IndexedDB outbox、
  离线输入缓存与重放、协议版本协商、自动刷新页面来处理 Access 过期、
  把 `online` 当作服务可达证据、给 `ReconnectConfig` 加退避/超时配置项、
  多标签页协同、Mosh 集成。
- **下一步唯一动作**：先落四态 + epoch + `connect()`/退避骨架，让轴表 1、2 的每一格有断言。
