# 弱网 T3 独立审查第 2 轮 verdict
<!-- delegate-outcome: succeeded -->
## 结论

`pass`。P1：0；P2/P3：0。冻结范围内没有发现违反 I1/I2/I3、普通输入不排队/不重放、epoch 隔离或单活动 socket 不变式的问题。

本轮新证据只有两类：

- J：逐状态、逐输入穷举 `disconnected` / `reconnecting` / `syncing` / `synced` 的连接状态矩阵；关键边界用 H0 代码行和 fake-timer 事件探针核对。
- K：在 H0 临时 detached worktree 中，用 fake timers、手工 `EventTarget`/WebSocket 事件和可重入状态订阅，实际运行 8 个 probe 用例（K1–K6，K5 拆成同一 turn 与跨 turn 两个观察），全部通过。

审查对象固定为 `84c3ce2c906ec6cf33c4ecb75eb9149bc4cb3fe5` 的内容，基线唯一匹配短 SHA `513d3fb` 解析为 `513d3fb89af660c5db549ebb3456b490e0f8c4c6`。任务卡提供的 base 全 SHA 末尾多了一个字符，因此不能作为 Git revision 直接解析；没有改用分支移动审查对象。

## 证据与方法

H0 关键实现定位：`send()` 与 freshness gate 在 `src/client-entry.ts:254-283`；定时器/失败收口在 `:366-473`；snapshot、输出、pong 在 `:475-591`；立即重连、挂起和 epoch 建立在 `:593-656`；生命周期监听在 `:674-729`。`reconnect.ts:77-142` 只读取 `ConnectionStatus`、展示文案并转发用户动作，没有第二份连接状态。

已实际运行：

```text
H0: pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts --reporter=verbose
Test Files 2 passed; Tests 70 passed

J/K probe:
./node_modules/.bin/vitest run tests/wnet-t3-review2-race.test.ts --reporter=verbose \
  --config /home/zlx/projects/oss/remobi-worktrees/wnet-t3/vitest.config.ts
Test Files 1 passed; Tests 8 passed
```

探针源文件仅在 `/tmp/remobi-wnet-t3-review2-h0/tests/wnet-t3-review2-race.test.ts`，没有写入被审仓库。

OCR 前置扫描已执行，但包装器三条腿均为 `status=skipped` 等价结果，原因是 `input_config_error`：主腿和两条备腿均报 `read background file "/proc/self/fd/11": stat ... no such file or directory`。这不是“扫过且干净”，不作为本轮清洁证据；也没有从 skipped 结果推导 finding。

## 证据源 J：完整状态转移矩阵

下表每行都是一个输入格。除特别标注外，socket 事件均指当前 epoch 的 listener；旧 epoch 事件首先在 `client-entry.ts:562-563` 或各 socket listener 的 epoch guard 被丢弃。`message:action-ack` 是协议解析器已知但 T3 客户端没有消费者的 T4 消息，列出是为了不把它隐含在“其他消息”中。

### 当前状态：`disconnected`

| 输入 | 实际行为 |
|---|---|
| socket `open` | 若存在当前 epoch socket，进入 `syncing`，建 10 秒 snapshot deadline，并把 resize 合并到 pending；旧 socket无效。 |
| socket `close` | 无当前 socket时无动作；若是仍关联当前 epoch 的异常 close，按同步前失败计数并进入 `reconnecting`（页面 visible 时安排退避）。 |
| socket `error` | 与 close 相同；旧 epoch error 无动作。 |
| message `snapshot` | 真实 WebSocket 顺序中不会早于 open；手工注入到 CONNECTING/`disconnected` socket 时，代码的 `applySnapshot()` 没有额外 state guard，会直接走 snapshot→synced。这是协议顺序不可能产生的合成格，已用代码定位但不构成真实 P1。 |
| message `output` | 当前 epoch 会进入 pre-snapshot `Map`，按 UTF-8 字节计数；超过 1 MiB 走 `output-overflow` 失败，否则保持 disconnected。真实连接不会在此状态收到该帧。 |
| message `exit` | 只置 `exitReceived=true`，不自动重连；无当前 socket的真实路径。 |
| message `error` | 只 `console.error`，不改变状态；服务端 error 后的 close 再驱动 reconnect。 |
| message `pong`（匹配/错误） | disconnected 没有在途 ping，均忽略；旧 epoch 亦忽略。 |
| message `input-accepted/rejected` | 解析后无 T3 状态消费者，忽略；不改变连接状态。 |
| 无法解析 / 非字符串 message | 当前 epoch 走 `protocol-error`，计同步前失败并安排 reconnect；旧 epoch无动作。 |
| `visibilitychange(hidden)` | `pageHidden=true`，`suspendConnection()` 递增 epoch、清 timer、停心跳、关 socket，保持 disconnected。 |
| `visibilitychange(visible)` | `pageHidden=false`，force `queueImmediateConnect(true)`；微任务中建立新 epoch，进入 reconnecting。 |
| `pagehide` | 同 hidden；任何 pending reconnect timer 被清掉。 |
| `pageshow` | `pageHidden=false`，force 建新 epoch，进入 reconnecting。 |
| `freeze` | 同 pagehide；不在后台继续尝试。 |
| `resume` | 同 pageshow；必须经过新 socket 的 open+snapshot 才能 synced。 |
| `online` | visible 时 queue 一次立即连接；hidden 时无动作；不把 online 当作 synced 证据。 |
| `offline` | `suspendConnection()` 立即清理并关闭当前 socket，最终 disconnected；等待 online/visible/用户 retry。 |
| 普通 input | 不发送、不排队，发一次 `Not sent — still syncing.` notice。 |
| resize | 不发送，只覆盖 `pendingResize` 的最后一组值；未来 snapshot 成功后只发一次。 |
| `requestReconnect()` | visible 时 force queue 一个新 epoch；同一 turn 合并，跨 turn 每次显式调用都会替换当前 CONNECTING socket。 |
| snapshot deadline | 没有当前 syncing deadline，正常无动作；任何旧 timer callback 已被 epoch/timer 清理。 |
| heartbeat deadline | 没有 heartbeat，正常无动作。 |
| heartbeat next | 无在途 heartbeat，回调 guard 直接返回。 |
| reconnect backoff 到期 | 当前 timer 到期后 `connect()`，进入 reconnecting；hidden 时 timer 已由 suspend 清除。 |
| bufferedAmount settle | 若无 synced 当前 socket，无动作；旧 probe 由 epoch guard 丢弃。 |
| 时间流逝至 freshness window 过期 | 状态不因纯时间自动改变；没有可发送的普通 input。之后 visible 的新 epoch仍需 snapshot。 |

### 当前状态：`reconnecting`

| 输入 | 实际行为 |
|---|---|
| socket `open` | 当前 socket进入 `syncing`，启动 snapshot deadline；open本身不清 failure count、不宣称 synced。 |
| socket `close` | `failConnection()` 再记一次同步前失败，保持/重新安排 reconnecting；已失效 epoch不计数。 |
| socket `error` | 与 close 相同，按 `socket-error` 记一次并退避。 |
| message `snapshot` | 正常 producer 必先 open，因此正常从 syncing处理；手工提前注入会直接应用并进入 synced，属于协议不可能的合成格。 |
| message `output` | 当前 epoch缓冲并按 seq排序；超过 1 MiB 关闭、记 output-overflow、继续退避。 |
| message `exit` | 只置 exitReceived；若随后 close，则 session-ended 分支阻止自动 reconnect。 |
| message `error` | 只记录 console error，状态仍 reconnecting；close/timeout 才是连接失败信号。 |
| message `pong`（匹配/错误） | 没有 heartbeatPingId，匹配与否都不刷新 freshness。 |
| message `input-accepted/rejected` | 无 T3 消费者，忽略。 |
| 无法解析 / 非字符串 message | `protocol-error`，计一次 pre-sync failure，保持退避。 |
| `visibilitychange(hidden)` | suspend，清掉 reconnect timer，状态 disconnected。 |
| `visibilitychange(visible)` | force取消原 backoff并建立一个新 epoch，仍先 reconnecting再 syncing。 |
| `pagehide` | suspend，关闭当前 CONNECTING socket并清 timer。 |
| `pageshow` | force建立新 epoch；必须重新 open+snapshot。 |
| `freeze` | 同 pagehide。 |
| `resume` | 同 pageshow。 |
| `online` | 非 force queueImmediateConnect会清掉现有 backoff并立即 connect；同一 turn 合并。 |
| `offline` | suspend，最终 disconnected，当前 reconnect timer 不再运行。 |
| 普通 input | 丢弃且不排队，notice；不会补发到新 socket。 |
| resize | 只保留最后一组 pending resize，不能在 reconnecting socket发送。 |
| `requestReconnect()` | force立即建立新 epoch；同一 turn合并，跨 turn按每次显式请求替换。 |
| snapshot deadline | 仅当前 state进入 syncing后才会有；reconnecting中不存在，旧 callback无效。 |
| heartbeat deadline | 无 heartbeat；无动作。 |
| heartbeat next | 无 heartbeat；无动作。 |
| reconnect backoff 到期 | timer回调清 timer并调用 connect，创建当前 epoch socket。 |
| bufferedAmount settle | 只有 synced input才会安装；reconnecting中的旧 settle被 epoch/state/socket guard丢弃。 |
| 时间流逝至 freshness window 过期 | 状态仍 reconnecting，普通 input仍丢弃；不凭时间自行进入 synced。 |

### 当前状态：`syncing`

| 输入 | 实际行为 |
|---|---|
| socket `open` | 已是 syncing时，重复 open 会重设 snapshot deadline并再次 syncSize；真实 WebSocket只派发一次 open。 |
| socket `close` | `snapshot`前失败，递增 pre-sync failure，关闭并按退避进入 reconnecting。 |
| socket `error` | 与 close相同，reason为 socket-error。 |
| message `snapshot` | 只接受第一个；`term.reset()`/`term.write()`回调成功后清 deadline、置 synced、清失败计数、写 freshness proof、按 watermark应用 buffered output、启 heartbeat、发最后 resize。 |
| message `output` | 按 seq缓冲；重复 seq替换旧数据并修正字节账本；超过 1 MiB 走 failConnection。 |
| message `exit` | 置 exitReceived，不立即改变 state；随后 close 会停止自动重连。 |
| message `error` | 只 console.error，保持 syncing，直到 snapshot成功或 deadline/close/error失败。 |
| message `pong`（匹配/错误） | 没有 heartbeatPingId，均不刷新 freshness；错误 pong不续命。 |
| message `input-accepted/rejected` | 无 T3 消费者，忽略。 |
| 无法解析 / 非字符串 message | protocol-error，立刻退出 syncing并按退避重连。 |
| `visibilitychange(hidden)` | suspend，立刻失效当前 snapshot过程并关闭 socket。 |
| `visibilitychange(visible)` | force新 epoch；不沿用当前同步过程。 |
| `pagehide` | suspend并清 snapshot deadline。 |
| `pageshow` | force新 epoch，重新 snapshot。 |
| `freeze` | 同 pagehide。 |
| `resume` | 同 pageshow。 |
| `online` | 非 force且 state为 syncing，`queueImmediateConnect()`不重复建连接；当前同步继续。 |
| `offline` | suspend，state disconnected，当前 socket关闭。 |
| 普通 input | 丢弃、不排队，notice；不会在 snapshot后补发。 |
| resize | 只覆盖 pendingResize；snapshot成功回调中发最后一组。 |
| `requestReconnect()` | force立即切换新 epoch，当前同步被关闭；同一 turn合并。 |
| snapshot deadline | `failConnection(snapshot-timeout)`，socket关闭，pre-sync failure+1，安排退避。 |
| heartbeat deadline | 正常不存在；snapshot成功前不会启动 heartbeat。 |
| heartbeat next | 正常不存在；无动作。 |
| reconnect backoff 到期 | 若仍有 timer则 connect并重新进入 reconnecting；当前 syncing通常已无 backoff。 |
| bufferedAmount settle | 正常不存在；旧 buffered probe被 state/epoch guard丢弃。 |
| 时间流逝至 freshness window 过期 | state仍 syncing且普通 input继续丢弃；freshness proof只有snapshot回调成功才写入。 |

### 当前状态：`synced`

| 输入 | 实际行为 |
|---|---|
| socket `open` | 正常 epoch不会重复 open；若手工重复，进入 syncing并重新要 snapshot，未把 open当作 fresh。 |
| socket `close` | 失效 synced、递增 epoch、停 heartbeat、关 socket；visible时进入 reconnecting退避，`exitReceived`时保持 session-ended 不自动重连。 |
| socket `error` | 与 close相同，reason为 socket-error。 |
| message `snapshot` | 当前 epoch `snapshotLoaded=true`，后续 snapshot被 guard忽略，不用重复 snapshot冒充 pong proof。 |
| message `output` | 直接写终端；按 server 的单调 seq/同一 WebSocket顺序，正常应大于 snapshot watermark。 |
| message `exit` | 只置 exitReceived，state暂保持 synced；server contract随后 close，真实浏览器实测 close后为 disconnected且不自动重连；这是已审过且接受的 session-ended 方向，不重复报。 |
| message `error` | 只 console.error；server terminal failure随后 close，close负责失效 synced。 |
| message `pong`（匹配） | 仅当前 epoch且 ID匹配才清 heartbeat deadline、更新 `lastProvenFreshAt`、等待 10 秒后发下一 ping。 |
| message `pong`（错误/迟到） | 不清 deadline、不更新 freshness、不发下一 ping；旧 epoch直接丢弃。 |
| message `input-accepted/rejected` | 无 T3 消费者，忽略，不影响连接状态。 |
| 无法解析 / 非字符串 message | `protocol-error` 立即失效 synced、关闭并退避；不是静默忽略。 |
| `visibilitychange(hidden)` | I1路径：立即 suspend，失效 synced、递增 epoch、停 timer/heartbeat、关闭 socket。 |
| `visibilitychange(visible)` | I2路径：force新 epoch，即使旧 socket先前 OPEN；snapshot前回到 reconnecting/syncing。 |
| `pagehide` | 同 hidden；persisted不改变“先失效再恢复”的行为。 |
| `pageshow` | 同 visible；新 epoch+完整 snapshot后才能回 synced。 |
| `freeze` | 同 pagehide，探针验证 socket closed且不后台重连。 |
| `resume` | 同 pageshow；旧 epoch output/pong不影响新 epoch。 |
| `online` | state已 synced时非 force queue直接返回，不把 online当 freshness证据、不重复建 socket。 |
| `offline` | I1路径：suspend立即关闭 OPEN socket并使 synced失效；online/visible/retry后重新 snapshot。 |
| 普通 input（fresh） | 只有 state=synced、socket=OPEN且 `Date.now()-lastProvenFreshAt <=25s` 才序列化发送；若 bufferedAmount非零，100ms settle probe负责发现持续堵塞。 |
| 普通 input（freshness过期） | 先 `failConnection(currentEpoch,'heartbeat-timeout')`，不发送、不排队，进入 reconnecting并发既有 notice。 |
| resize | socket OPEN时立即发送，不受 freshness gate影响；socket不可用时转为最后一组 pending resize。 |
| `requestReconnect()` | force新 epoch，旧 synced socket关闭；必须重新 snapshot，不能沿用画面。 |
| snapshot deadline | snapshot成功已清掉该 timer；若人为保留旧 callback，epoch/state guard使其无动作。 |
| heartbeat deadline | 当前 ping ID仍在途时关闭并进入 reconnecting；同 tick先收到匹配 pong会清 deadline并合法续命。 |
| heartbeat next | 匹配 pong后到期才发一个新 ping；若已失效/非 synced，guard返回。 |
| reconnect backoff 到期 | synced正常没有 reconnect backoff；若旧 timer残留，connect路径会清理旧 epoch并重新同步。 |
| bufferedAmount settle | 当前 socket仍 OPEN且仍 synced时，bufferedAmount>0 走 socket-error fail；归零则保持 synced。 |
| 时间流逝至 freshness window 过期 | 纯时间推进不派事件，状态字段暂仍是 synced；下一次普通 input 先过 `Date.now()` gate，失效并关闭 socket。该时间层是事件漏发/页面冻结的兜底，不把“未收到坏消息”当证据。 |
