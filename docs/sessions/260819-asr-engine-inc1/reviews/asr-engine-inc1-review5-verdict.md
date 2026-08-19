# ASR 增量 1 独立 Review 5 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..c9ae8ecb075524234f9e368a06ef963a2bf9413a`
- H0：`c9ae8ec`
- 本轮新证据：`397e3d6..c9ae8ec` 的 HTML `Cache-Control`、CSP 两态精确字节测试、设计/Spike 文档收口；本轮首次以增量 2 PTT 状态机就绪度、接口消费面和 H0 终末门禁为主输入。
- 风险等级：仓未声明，按 `internal`；失败路径/状态机按 infra 例外提档。
- Verdict：**fail**（新增 2 条 P1；另有 2 条 P2，其中 1 条为前轮未完全收口的文档漂移）。

## 增量 2 就绪度对照

“增量 2 自建”表示不应回写为增量 1 finding；“缺口”表示仅靠 mic-controller 自己无法从当前引擎/类型面完成设计契约。

| PTT 状态/迁移 | 引擎/类型/config 支撑 | 结论与证据 |
|---|---|---|
| `idle → permission-requesting`（pointerdown） | `isSupported()` + `start()` 有；按钮、pointer 生命周期、状态字段是增量 2 自建 | 可接线。`src/asr/types.ts:18-25`；`engine.ts:374-415`。引擎不需要替 UI 持有 pointer 状态。 |
| `permission-requesting → connecting`（granted） | `start()` 覆盖异步 permission/WS/capture；没有独立“permission granted/connecting”事件 | UI 子状态由增量 2 自建；把 `start()` pending 作为启动阶段即可，不把缺少 UI 事件误报为增量 1 finding。 |
| `connecting → recording`（WS open/capture ready） | `start()` 仅在 WS open、capture ready 后 resolve；`onError` 覆盖失败 | 有；`engine.ts:414-436,477-520`。控制器可在 start fulfilled 后进入 recording，不依赖内部 WS 事件。 |
| `permission-requesting/connecting + pointerup → stopping/cancelled → idle` | `stop()` 在 starting 阶段可取消，返回共享 stop promise；engine epoch 会使迟到回调失效 | 有；`engine.ts:438-451,625-646`。增量 2 仍需自己的 pointer/cancel/generation。 |
| `permission denied → error` | `AsrErrorCode: permission-denied`；`NotAllowedError` 有映射 | 有；`engine.ts:49-67,414-436`。 |
| `connecting + fail → error` | `connection-failed`、`audio-context`、`unsupported-sample-rate`、`worklet-load-failed` | 有；`engine.ts:49-67,477-520`。 |
| `recording + pointerup → stopping → waiting-final` | `stop()` 先停采集/背压，再 flush、发尾包、等待 final/3s | 有；`engine.ts:438-451,625-646`。waiting-final 的 UI 状态由增量 2 自建。 |
| `recording + WS/provider/protocol/backpressure fail → error` | `socket-closed`、`provider-error`、`protocol-error`、`network-too-slow` 均经 `onError` 单次报告 | 有；`engine.ts:522-555,576-587,674-704`。 |
| `stopping + final → preview` | `onFinal(text)` 有，final 会唤醒 stop waiter | **P1-F1**：text 事件丢失协议 `sequence`，无法实现 E3 的 final 去重/乱序守卫，见下文。 |
| `waiting-final + 3s timeout → preview` | `stop()` 在 `FINAL_TIMEOUT_MS=3000` 后 resolve；空结果不产生文本事件 | 有；控制器根据 stop fulfilled 展示 preview；空结果“不注入”是增量 2 自建。 |
| `waiting-final + WS close → error`（保留已有文本） | `socket-closed` 经 `onError`；已送出的 partial/final handler 不被清除 | 有；`engine.ts:522-555`。文本保留和提示由增量 2 自建。 |
| 任意状态 + `visibilitychange hidden → cancelled → idle` | `stop()` 可被控制器调用；没有替控制器注册文档事件 | 增量 2 自建，且可接线。 |
| 任意状态 + `track.onended/onmute` 或 AudioContext interrupted → cancelled | `PcmCapture` 私有持有 track/context；AsrEngine 没有中断事件或等价错误码 | **P1-F2**：当前控制器无法观察这些信号，见下文。 |
| 重复/乱序 final | 协议 decoder 读出 `sequence`，但 engine handler 只传 text | **P1-F1**。 |
| 快速连按、`<300ms` 误触、pointer capture、focus 安全、preview/confirm/inject | 无需引擎新增能力 | 全部是增量 2 自建，不计 finding。 |

## 接口、错误码、能力与 epoch

### 事件面

`AsrEngine` 已有 `start(): Promise<void>`、`stop(): Promise<void>`、`isSupported()`、`onPartial`、`onFinal`、`onError`，满足普通 partial/final/error 接线；但 `onFinal` 的 `(text: string) => void` 丢掉了 SAUC final 的序号，触发 P1-F1。事件也没有音频中断信号，触发 P1-F2。

### AsrErrorCode 覆盖

| PTT/引擎错误路径 | 当前码 | 结论 |
|---|---|---|
| API/secure-context 不可用 | `unsupported` | `isSupported()` 检测 mediaDevices、AudioContext、AudioWorkletNode、WebSocket；非 secure context 通常没有 mediaDevices。 |
| getUserMedia 拒绝 | `permission-denied` | 有明确 `NotAllowedError` 映射。 |
| AudioContext 构造/恢复、采样率不符、worklet 加载失败 | `audio-context` / `unsupported-sample-rate` / `worklet-load-failed` | 有；仅运行时 processor error 未覆盖，列 P2-F3。 |
| 握手/网络、录音中 WS 断连 | `connection-failed` / `socket-closed` | 有。 |
| 0xF provider 帧、畸形帧、背压超限 | `provider-error` / `protocol-error` / `network-too-slow` | 有，且单次 fail-loud。 |
| 正常 stop、取消、尾包 3s 超时 | 无 error | 正确；这些是正常状态迁移，不应伪装成错误。`stopped` 当前未使用但不影响上述迁移。 |
| 来电/Siri/其它 App 音频中断 | 无可消费事件/专用码 | P1-F2；不能映射为设计要求的 `cancelled`。 |

### 会话 epoch 与 mic-controller generation

兼容性总体成立：engine 的 `epoch` 在 socket、capture callback、late resource 和 cleanup 上做内部失配丢弃；mic-controller 仍应按 v5 #3 维护自己的 generation，忽略旧的 `start()`/`stop()` Promise 结果。`start()` 被取消后可能 fulfilled 而不是以“cancelled”拒绝，这不是缺陷，只要 controller 以 generation/state 守门。当前真正缺的是 final sequence 和 audio interruption 信号，不是 epoch 互相冲突。

## Findings

### P1-F1：AsrEngine 丢弃 final sequence，增量 2 无法实现 E3 去重/乱序不变式

- 溯源 spec：`docs/designs/asr-voice-input.md:109-113` 的“重复/乱序 final”规则；`docs/designs/asr-voice-input.md:215-220` E3 的会话内单调 `appliedSeq`；v5 #3 的 generation 只解决异步会话，不替代 final 序号。
- 证据：`src/asr/doubao/protocol.ts:23-39,168-177` 已从 flags=3 读取 `DecodedServerResponse.sequence`；但 `src/asr/doubao/engine.ts:541-551` 只取 `getText(frame.json)` 并调用 `finalHandlers(text)`，没有比较/转发 `frame.sequence`。`src/asr/types.ts:14-25` 的 `AsrTextHandler` 也只有 `text`。
- 真实触发：火山 final 帧本身携带 sequence，且设计明确要求处理重复/乱序 final；provider/网络边界若重发同一 final 或出现旧 final，当前 engine 会逐个转发。mic-controller 不能从 text 反推出 provider 序号，也不能可靠地区分“重复同文”和“合法的新同文”。
- 后果：preview 可能被旧 final 覆盖；`autoEnter=true` 时，增量 2 可能把错误文本连同回车注入终端。结果错而无错误事件，属于 internal+infra 的不可接受静默错误，故为 P1。
- 最小修复方向：要么 engine 在 session 内按 sequence 过滤后再发 onFinal，要么把 sequence 纳入 final 事件并由 mic-controller 按 E3 过滤；不能让增量 2 猜测。

### P1-F2：音频中断信号不在 AsrEngine 消费面，PTT 无法完成 R2/E5 cancelled 迁移

- 溯源 spec：`docs/designs/asr-voice-input.md:109` 任意状态音频中断迁移；`docs/designs/asr-voice-input.md:148-156` R2 与“增量 1 通过 onError 提供错误回调”；`docs/designs/asr-voice-input.md:228-231` E5 的 `track.onended`、`track.onmute`、`AudioContext.statechange`、`visibilitychange` 多信号 OR；v5 #4 的 mute 观察/5s 超时规则。
- 证据：`src/asr/doubao/engine.ts:139-238` 的 `BrowserPcmCapture` 创建并私有保存 `MediaStream`、track、AudioContext，但没有注册 `track.onended`、`track.onmute` 或 `context.onstatechange`；`src/asr/types.ts:18-25` 也没有 interruption/cancel 事件，`PcmCapture` 只暴露 start/stop/getPcmInFlightBytes。当前 `visibilitychange` 只能由增量 2 自己监听，无法替代私有的 track/context 信号。
- 真实触发：手机来电、Siri 或其它 App 在页面仍可见时中断音频会话；这正是 R2/E5 纳入设计的目标路径，不能以本轮 spike 未人工制造硬中断为否定证据。
- 后果：引擎不发 `onError`，controller 也收不到 cancelled 信号；PTT 可能继续显示 recording、WS/采集资源不按中断路径收口，用户没有可见错误且后续 pointer 生命周期失步，不能接受，故为 P1。
- 最小修复方向：在 engine/capture 与 controller 之间提供一个明确的 interruption/cancel 事件（或等价的专用错误码），严格实现 #4 的 mute 观察/恢复/超时与 ended/interrupted 迁移；不要让 controller 复制第二套 getUserMedia。

### P2-F3：AudioWorklet 运行时异常没有映射到 onError

- 溯源 spec：`docs/designs/asr-voice-input.md:148-156` 将 AudioWorklet 异常列入零静默错误路径，并要求增量 1 通过 `onError` 暴露错误。
- 证据：`src/asr/doubao/engine.ts:202-238` 只设置 `node.port.onmessage`，没有设置 `node.onprocessorerror`；`src/asr/worklet-entry.ts:64-73` 虽会为未知命令发送 `{ type: 'error' }`，但 engine 的 message handler（`engine.ts:202-238`、`522-555`）将除 `flush-ack` 外的消息按 PCM 结构处理，未转成 `worklet-load-failed` 或其它错误码。当前主线程只发送合法 `start/flush`，因此级别为 P2 而非 P1；但 processor 真正抛错时仍无 fail-loud 回调。

## P2 收口核验

| 收口项 | 结论 | 证据 |
|---|---|---|
| HTML `Cache-Control` | **真闭环（HTML 路由）** | `src/serve.ts:325-330,354-372` 统一 `documentHeadersForRequest`；H0 HTTP 探针：`/` 返回 `200 cache-control: private, no-store`，`--base-path /proxy` 下 `/proxy/` 同样返回 `200 private, no-store`。`/proxy` 是 308 重定向，`Location: /proxy/`；重定向本身不是包含 config 的 HTML，canonical target 已覆盖。 |
| CSP/worklet 两态字节级测试 | **真闭环** | `src/serve.ts:162-173` 的 enabled/disabled 字节串与 `tests/serve.test.ts:216-245` 两个 `toBe(...)` 精确断言逐字符一致；`pnpm test` 通过。worklet 仅 enabled 注册，disabled 返回 404，现有 HTTP 测试 `tests/serve.test.ts:276-289` 通过。 |
| 文档漂移清理 | **假闭环/未完全收口** | `docs/designs/asr-voice-input.md:195-198,243-250` 已与 `_async`、query `api_key`、no-cache 和 inc2 UI 边界一致，旧 `docs/sessions/260819-1244-asr-spike-inc0.md` 也有 `superseded-by`。但活动卡 `docs/sessions/cards/asr-engine-inc1.md:113-121` 仍要求 `GET {basePath}asr-worklet.js?v={version}`，而实现/设计均定为无 query + no-cache；同一活动卡 v5 #15 又写无 query。该 P2 是 review4 已登记但本轮仍未闭环，不计本轮新增。 |

## 终末全量复验

- `pnpm test`：41 files / **576 tests passed**。
- `pnpm run check`：119 files checked，**0 errors**。
- `pnpm run lint:ox`：**0 errors**，6 warnings（worklet/engine `postMessage` 规则与既有 actions 拼接 warning，均非本轮错误）。
- `pnpm run build:dist`：**成功**；tsdown 24 files / 423.65 kB，overlay 生成 `dist/asr-worklet.js`（1624 bytes）。
- `git diff --check c23d8e7..c9ae8ec`：通过；H0 工作树仅有本 verdict 待新增。

## OCR 前置

`ocr-review` 已调用，但未得到可用审查结果：首次三腿均 `status=skipped`、`input_config_error`，stderr 明确为包装器把进程替代文件解析成不存在的 `/proc/self/fd/11`；改用 `/dev/stdin` 重跑只返回启动进度、没有最终 JSON envelope。按 review-discipline 不能把它描述为“扫过且干净”，本 verdict 未采纳 OCR finding。

## 历史 finding / 收敛

review1-review4 已闭环的 binaryType、epoch/stop 串行化、MessagePort 背压、真帧 mock、JSON 畸形帧、opened-WS starting close 和 stop 拒绝路径不重复提报。review4 的 HTML cache/CSP 两项已真闭环；公共入口 P2 已由设计明确为 inc2 接线前内部源码，不重复提报。活动卡 `?v={version}` 漂移与 P2-F3 仍列为 backlog。

本轮新增 P1：2 / 2。
