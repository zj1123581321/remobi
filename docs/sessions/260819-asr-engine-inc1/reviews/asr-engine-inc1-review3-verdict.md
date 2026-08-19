# ASR 增量 1 独立 Review 3 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..efa5bd7`，重点 `d74239f..efa5bd7`
- H0：`efa5bd7`（新提交不纳入本轮）
- 审查视角：运行时交错压力、I1-I6 不变式攻击、状态读取/epoch 守门穷举、迁移表↔实现↔测试对照
- 风险等级：internal；状态机/资源清理按 infra 例外提档
- Verdict：**fail**
- 本轮新增：1 条 P1、1 条 P2（均不是前两轮已闭环 finding 的重复）

## 本轮新证据与门禁

本轮新证据是前两轮未使用的 `d74239f..efa5bd7` 生命周期收口实现、唯一 `transition()` 写入口、epoch + state 双守门、pending 资源作废路径、stop rejection 终态，以及真实 `BrowserPcmCapture` 的 `AudioWorklet` port fake seam。另在临时目录用 Vitest 写了事件交错攻击探针；探针未修改仓库文件。

OCR 前置扫描已调用，但包装器三条腿均在输入阶段失败，不能视为扫过且干净：三份 stderr 都是 `input_config_error`，原因是包装器把背景文件解析成不存在的 `/proc/self/fd/11`。本 verdict 不采纳 OCR finding。

只读门禁结果：

- `pnpm test`：41 files / 570 tests passed
- `pnpm run check`：119 files checked，0 errors
- `pnpm exec tsc --noEmit`：passed
- `pnpm run lint:ox`：0 errors，6 条既有 warning
- 定点 `pnpm exec vitest run tests/asr-engine.test.ts tests/asr-protocol.test.ts`：54 tests passed

## 运行时交错压力结果

探针文件与可复跑命令：

```text
/tmp/remobi-asr-review3.2t9Tyx/attack.test.ts
/tmp/remobi-asr-review3.2t9Tyx/vitest.config.ts
pnpm exec vitest run --config /tmp/remobi-asr-review3.2t9Tyx/vitest.config.ts /tmp/remobi-asr-review3.2t9Tyx/attack.test.ts
```

压力部分使用固定 seed 的确定性伪随机序列，事件集合为 `start / stop / WS open / WS close / WS error / provider 0xF / malformed / capture ready / final / timeout / PCM`；每条 10 事件，共 **400 个排列**。每个事件及最终收口各做 6 项状态/资源断言，共 **26,400 个不变式断言**。另外运行了一个最小 close 复现和 I6 三项（`bufferedAmount`、worklet 在途、queued bytes）独立攻击。

结果：

- 400 个序列中有 **38 个**命中同一个已定位的 `I4/starting + opened-WS close` 窗口；没有出现第二种违反。
- 除该已知窗口外，I1、I2、I3、I5 的收口断言为 0 violation。
- I6 三项分别超过水位后均收到恰好一次 `network-too-slow`。
- 探针输出的最小复现为：

  ```text
  start → ws-open → capture-pending → ws-close
  errorsBeforeCaptureReady = []
  stateBeforeCaptureReady = starting
  capture-ready 后 state = recording，errors 仍为 []
  ```

  为了让探针结束，随后显式 stop 才得到 `socket-closed`；这不是 close 事件本身的及时错误响应。

## Findings

### P1-1：已打开 WS 在 capture pending 阶段 close 被静默吞掉，随后仍进入 recording

- **溯源 spec**：
  - `docs/sessions/cards/asr-engine-inc1-fix1.md` 的 I4：WS 错误必须恰好一次 `onError`；状态机表“starting + WS error/close → failing”。
  - 同文档 I2：失败/停止后的 pending 异步工作必须代际作废；I1：旧代际不得触碰当前状态。
  - `docs/designs/asr-voice-input.md:146-154`：错误路径零静默失败；`E2` `:201-208`：WS CLOSING/CLOSED 立即转 error。
- **代码证据**：`src/asr/doubao/engine.ts:474-490` 的 `onclose` 在 `opened === false` 时调用 `fail()`，在 `recording` 时调用 `fail('socket-closed')`，在 `stopping` 且未收到 final 时也调用 `fail()`；但 `opened === true && state === 'starting'` 落入最后的 `resolveFinalWaiter()` 分支。starting 阶段没有 final waiter，因此该分支实际不报错、不递增 epoch、不改变 state。
- **后续证据**：`start()` 在 `:421-427` 只要 `openSocket()` 已完成且 `capture.start()` 返回，就用原 epoch 通过 `isCurrent()` 并迁移 `starting → recording`。背压监视器直到 `:428` 才启动，所以 permission/AudioWorklet pending 期间没有后续监视器替它报错。
- **最小触发序列**：`start → ws-open → capture pending → ws-close`。探针观测到 close 后 `errors=[]`、state 仍 `starting`；放行 capture 后 state 变成 `recording` 且仍无错误。只有之后人为 `stop()` 才得到 `socket-closed`。
- **P1 两问**：
  1. 真实使用可触发：手机权限弹窗、`getUserMedia`、AudioContext/AudioWorklet 初始化未完成时，服务端/网络可主动关闭已完成握手的 WS。
  2. 后果不可接受：权限一直未决时，WS close 永远没有 `onError`，start 也一直悬挂；权限随后完成时则在已关闭 socket 上创建并启动采集，进入错误的 recording 状态，用户无提示且麦克风资源要等另一次动作才清理。
- **与前轮区分**：这不是 review2 的 pending `capture.start()` 被 stop/provider/onerror 作废 finding；那些路径在 `fail()` 中已有 epoch + cleanup。本 finding 的新输入是“握手已开后、capture 尚 pending 的 `onclose`”，该事件没有进入 `fail()`。

建议修复必须把 `opened === true && state === 'starting'` 明确纳入 connection-failed 迁移，并增加上述最小时序回归；不应以启动背压 timer 或等待用户 stop 代替 close 事件的 fail-loud。

### P2-1：迁移表的检测点没有覆盖全部明确子事件

- **溯源 spec**：`docs/sessions/cards/asr-engine-inc1-fix1.md` 状态机轴表注明“必须全格有检测点”，完成条件要求上表全格有测试。
- **证据**：实现表在 `src/asr/doubao/engine.ts:326-342` 已把 `stopping + provider/WS/protocol/stop failure` 合并写入，但测试分别覆盖 provider（`tests/asr-engine.test.ts:567-604`）、WS close（`:713-733`）和 stop rejection（`:796-824`），没有 protocol-error 发生在 stopping 阶段的独立检测；`turns malformed JSON...`（`:773-794`）是在 recording 阶段注入。另有 `stopping/failing + start` 只由 `start():401` 的同步 busy guard 实现，没有在 stopping/failing 期间直接断言 reject（现有 `:658-689` 断言的是 starting/capture pending 时第二次 start）。
- **级别理由**：实现分支静态上会经 `fail() → reportStopError()`，本轮交错探针也未发现行为违反，故不是 P1；但不满足收口卡要求的“每格测试锁死”，未来修改 `reportStopError` 或 start admission 时会缺少回归保护。

## I1-I6 逐条攻击结论

| 不变式 | 攻击输入/最小序列 | 结论 | 代码与测试证据 |
|---|---|---|---|
| I1 单代际占有 | `start → start`（capture pending）；旧 socket error/close 在新轮到达；400 条交错序列 | **未拆穿**（但 P1-1 是 starting 状态未因 close 失败的状态语义缺口） | `engine.ts:400-415,422-426,465-477,730-738`；`tests/asr-engine.test.ts:658-689,567-604`；探针未出现 >1 live socket |
| I2 停后禁建 | `start → capture pending → stop → late capture ready`；真实 BrowserPcmCapture 的 late permission | **未拆穿** | `engine.ts:166-200,223-254,436-447`；`tests/asr-engine.test.ts:887-926` 断言 late track 被 stop 且无 context/node |
| I3 成对清理 | 正常 stop、flush ack timeout、provider fail 与 stop 交错 | **未拆穿** | `engine.ts:260-321,608-621,718-727`；`tests/asr-engine.test.ts:826-885` 断言 port/node/source/track/context 各一次；400 序列无额外 close violation |
| I4 异常必响 | malformed、provider 0xF、WS error/close、capture/stop rejection；重点 `start → ws-open → capture pending → ws-close` | **拆穿** | 普通错误路径由 `engine.ts:520-553,672-702` 覆盖；但 `engine.ts:484-490` 的 opened-WS/starting close 不报错，探针在 capture ready 前后均为 0 error，违反 I4 |
| I5 stop 契约 | stop 两次、stop 与 provider fail 交错、capture.stop rejection、flush ack timeout | **未拆穿** | `engine.ts:436-447,623-669`；`tests/asr-engine.test.ts:567-604,713-733,796-885`；stop promise 均 settle，可重新 start |
| I6 背压三要素 | 分别令 queued bytes、worklet in-flight、`bufferedAmount` 超过 2 秒水位 | **未拆穿** | `engine.ts:574-585` 明确求和；`tests/asr-engine.test.ts:511-545` 覆盖 socket/worklet，临时探针三项均得到一次 `network-too-slow` |

## transition() 唯一写入口与 state 读取穷举

全文件 `this.state` 读取/写入点如下：

| 位置 | 用途 | epoch/state 守门判断 |
|---|---|---|
| `engine.ts:401` | start admission | 同步入口，无异步读-判-用窗口；随后立即 increment epoch + transition |
| `:403`、`:427` | transition 调用 | 写入集中在 `transition()`；`:735-738` 先校验 from，再唯一执行 `this.state = to` |
| `:437-447` | stop 分支选择 | 同步完成 state 读取、迁移、epoch 作废；无异步穿插 |
| `:470-472` | WS error | 先 `epoch !== this.epoch` 丢弃，再同步读 state；starting/recording/stopping 都 fail |
| `:484-490` | WS close | 先 epoch guard；recording/stopping fail，但 **opened + starting 漏掉 fail（P1-1）** |
| `:539-549` | final/text 分派 | 调用方 `onmessage` 在 `:465-467` 先做 epoch guard；同步读 state 只控制 stopping final waiter |
| `:556` | PCM admission | 同步 state gate；浏览器 capture callback 在 `:423-425` 另有 epoch guard；stopping 接收迟到 PCM 是 stop flush 契约的一部分 |
| `:642`、`:654` | finishStop/finishFailure 收口 | 这是 await 后的 cleanup 条件，不决定新资源归属；对应异步流程在 state 仍 stopping/failing 时才可收口，失败路径用 `failedDuringStop` 防重 |
| `:673-679` | fail admission | 先 epoch，再 state；stopping 转 `reportStopError`，starting/recording 才能进入 failing |
| `:689-696` | stop error | state stopping 是 starting stop 已主动 epoch++ 后的合法例外；`failedDuringStop` 防重并立即 invalidate |
| `:730-731` | `isCurrent` | 同时比较 epoch 与 state |

没有发现第二个“读 state → await → 使用旧判断”的窗口。唯一未守门完备性是 `onclose` 已有 epoch 守门却漏掉 `starting` 分支的迁移动作；这是 P1-1，而非另一个独立的 epoch race。

## 迁移表 ↔ 实现 ↔ 测试对照

| 迁移表行 | 实现位置 | 锁死测试/对照结论 |
|---|---|---|
| idle + start → starting | `engine.ts:400-428` | `streams injected PCM...:436-472`、`cancels pending capture...:658-689`；一致 |
| starting + WS error/close → failing | `:468-482`、`:672-686` | handshake 前 close `:735-754`、runtime error `:547-565`；**握手已开且 capture pending 的 close 漂移，P1-1** |
| starting + capture pending + stop → stopping → idle | `:436-447,623-630,718-727` | `:658-689`；一致 |
| starting + capture pending + late resource → discarded | BrowserPcmCapture `:166-200,223-254`，engine `:423-426` | `:887-926`；一致 |
| starting + provider/protocol failure → failing → idle | `:520-553,672-686` | provider pending `:691-711`、malformed `:773-794`；一致 |
| recording + stop → stopping → flush/tail/final/cleanup | `:436-447,623-644` | fixture integration `:436-472`、real port seam `:826-855`；一致 |
| recording + WS/provider/protocol/backpressure failure → failing → idle | `:468-490,520-585,672-686` | provider `:474-492`、backpressure `:511-545`、runtime WS `:547-565`、malformed `:773-794`；一致 |
| stopping + provider/WS/protocol/stop failure → report once, keep stop, cleanup | `:623-696` | provider interleave `:567-604`、WS close `:713-733`、stop rejection `:796-824`；protocol-in-stopping 缺独立锁死，P2-1 |
| stopping + stop → same promise | `:437-439,659-669` | `:675-676,726-730,813-815`；一致 |
| stopping/failing + start → reject | `:401` | 代码同步 guard 正确；缺 stopping/failing 直接测试，P2-1 |
| any + second start while capture pending → reject | `:401` | `:672-675`；一致 |
| any + malformed JSON → protocol-error | protocol `:154-166,209-216`；engine `:520-553` | protocol `:72-74`、engine `:773-794`；一致 |
| legal JSON without text → ignore | `engine.ts:72-87,543-549` | `:787-790`；一致 |
| epoch-mismatched callbacks cannot touch current state | `:413-415,422-426,465-477,497-500`；Browser capture `:167-200,215-225` | stale socket/epoch `:567-604`、late Browser permission `:887-926`；一致 |

## 收敛结论

本轮不是 0 新增 P1：P1-1 是新的 `onclose` 交错窗口，不能计入“连续无新增 P1”的第 1 个收敛轮。P2-1 为测试锁定缺口；前两轮的 binaryType、epoch waiter、port 背压、真帧 mock、删除无消费者包装，以及 review2 登记的 pending capture/provider/stop rejection 路径均未重复提报。
