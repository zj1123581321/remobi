# ASR 增量 1 独立 Review 1 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..50a220793a6eaed2defe559e6b627cd0f9878ac3`
- 审查方式：冻结 SHA 的全量 diff、调用方、测试、真实 SAUC fixture、设计/任务卡不变式；未把 OCR finding 直接当结论。
- 结论：**fail**

## Findings

| 级别 | 溯源 spec | 证据与触发路径 |
|---|---|---|
| **P1** | `docs/designs/asr-voice-input.md`：增量 1 行为验收 1、E2 partial/final；`docs/sessions/cards/asr-engine-inc1.md`：完成条件 1、轴 1 server response | 生产适配器 `src/asr/doubao/engine.ts:87-131` 创建原生 `WebSocket`，但没有设置 `socket.binaryType = 'arraybuffer'`。浏览器 WebSocket 的默认二进制类型是 `Blob`；而 `engine.ts:343-351` 只接受 `ArrayBuffer`/`ArrayBufferView`，所以真实火山二进制 0x9/0xF 响应在 `handleMessage` 入口即 `protocol-error`（`engine.ts:343-372`），不会产生 partial/final。现有集成测试的 `ws` 适配器收到 `Buffer`（`tests/asr-engine.test.ts:25-70`），因此不能覆盖生产适配器。真实手机浏览器会触发；后果是 ASR 核心链路在生产中不可用、语音结果被丢弃，不能接受。 |
| **P1** | `docs/designs/asr-voice-input.md`：E2 背压/flush-ack/stop 顺序及错误路径；`docs/sessions/cards/asr-engine-inc1.md`：完成条件 1、3（失败路径、清理时序、单实例多轮） | `BrowserPcmCapture.stop()` 只有一个共享 `flushWaiter`（`engine.ts:188-211`，赋值在 `193-195`）。用户 stop 已在等待 worklet flush ack 时，provider 0xF/协议错误可经 `handleMessage` 调用 `fail()`；`fail()` 无条件再次执行 `void this.capture.stop()`（`engine.ts:427-435`），第二次 stop 覆盖 waiter。随后第一个 stop 收不到自己的 resolve，`DoubaoEngine.stop()` 永久卡在 `await this.capture.stop()`（`engine.ts:284-298`）。同时 `fail()` 先把 state 写回 `idle`，旧异步 stop 尚未完成时允许新一轮 `start()`，旧 cleanup 还能操作同一个 capture 的新 node/context。真实错误帧与释放时序可交错；后果是清理不成对、stop 卡死、下一轮音频丢失，不能接受。 |
| **P2** | `docs/designs/asr-voice-input.md`：E2 “在途总量 = worklet MessagePort + 应用缓冲 + ws.bufferedAmount”、v5 #6；`docs/sessions/cards/asr-engine-inc1.md`：完成条件 3 | worklet 在 `src/asr/worklet-entry.ts:72-80` 通过 `MessagePort.postMessage()` 发出 PCM；主线程在 `engine.ts:176-181` 收到后直接调用 `sendPcm`。但 100ms 背压检查只计算 `queuedBytes + socket.bufferedAmount`（`engine.ts:394-403`），没有记录/估算 MessagePort 在途量。worklet port 尚有多包排队时，两个可观测量可能都低于 2 秒高水位，规定的 `network-too-slow` 不会及时触发；当前代码没有静默丢包，但背压不满足锁定闭环，持续慢网会积压或延迟暴露。 |
| **P2** | `docs/sessions/cards/asr-engine-inc1.md`：E4 mock fixture-driven、轴 1 golden/跨边界契约；完成条件 4 及跨发布边界验收 | `tests/fixtures/asr/mock-volc-server.ts:48-66,102-124` 自己生成 JSON 帧，未消费 `tests/fixtures/asr/2026*` 的真实服务端帧；`tests/asr-engine.test.ts:144-173` 只断言收到的 message type 为 `[1,2,2]`，没有断言真实 response 字节、payload offset 或 `-(audioFrameCount+2)` 尾包序列。协议 golden 单测虽独立覆盖 `decodeFrame`，但没有把真实 fixture 穿过 `DoubaoEngine`；因此 mock 与生产协议实现各自“自证”，无法锁住 engine↔real-frame 的发布边界。 |
| **P2（熵增）** | `docs/sessions/cards/asr-engine-inc1.md`：反熵条款；`docs/designs/asr-voice-input.md`：手写最小协议层/最小接口 | `src/asr/doubao/protocol.ts:239` 新增 `decodeServerFrame = decodeFrame`，仓内无消费者，且返回类型仍是可代表 full-request/audio/error 的 `DecodedFrame`，名字反而暗示更窄的 server-response 契约。`src/asr/pcm.ts` 的 `chunkPcm16`/`float32ToPcm16` 也只有自身测试使用，生产 worklet/engine 不调用。没有第二消费者或行为必要性，增加了公共面和未来误用路径；应删除未用别名/包装，或先证明第二消费者。 |

## 降层三问

1. **终态写入成功之前的不可逆动作与成对性**：`openSocket()` 已向 provider 发出 full request（`engine.ts:322-339`），录音期间还可能已发出若干 PCM 帧（`375-385`）；stop 先停采集/停 track，再等待 flush ack，之后发送队列和负序列尾包（`284-297`）。失败路径中 `fail()` 先通知 error handler，再把 state 置 idle、关闭 socket，并异步再次 stop capture（`427-435`）。因此在“原 stop 等 flush ↔ provider error ↔ fail 再 stop”交错时序中，发送动作无法回滚，且两个 stop 共享 waiter/资源，未成对；这就是 P1-2 的证据。
2. **守卫值在单实例多轮下是否一致**：`reportedError`、`audioFrameCount`、`queuedBytes` 只在 `start()` 开头重置（`262-268`），但 `fail()` 将 state 置 idle 后不清理 `finalWaiter/finalTimer`、不等待 capture stop，也不隔离旧 socket/capture 回调。下一轮 start 可以复用同一实例而旧异步 cleanup 仍在运行，故这些值和资源不再属于同一 session；守卫不一致。
3. **保护覆盖写入还是行为**：当前检查确实覆盖了已入应用队列的 `queuedBytes` 与 WebSocket `bufferedAmount`，但不覆盖 worklet port 的在途消息；`postMessage` 到主线程回调之间没有计数或 ack。它只覆盖两个可观测写入量，没有覆盖 spec 要求的完整行为链，故 P2-3 成立。

## 反熵审查记录

已逐项检查新增文件、状态、配置和包装层。ASR 配置字段、AudioWorklet 独立 entry、Doubao engine/protocol 是锁定模块；`decodeServerFrame` 单纯转发 alias 及未被生产消费的 PCM 包装函数命中熵增，已列 P2。未发现需要为修 P2/P3 新增 fallback、重试或防御式 catch 的正当性。

## Backlog / 接受不修

- base 之前的终端 WebSocket 文本链路、既有 CSP/host 校验问题不计入本轮。
- C8 “query URL 使用 apiKey”的意见按锁定 spec 接受，不重复提报。
- `float32ToInt16` 默认 target 分配、worklet 未知控制消息的非生产入口诊断属于 P3/后续减法；它们不改变本轮 P1 结论。
- `pnpm test` 未在当前 base checkout 上冒充验证 H0；本轮已运行冻结范围 `git diff --check`，并阅读 H0 全部测试与真实 fixture。OCR 直调返回 `status=complete`，但仅作为线索，未直接复制其意见。
