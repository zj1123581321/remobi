# ASR 增量 1 独立 Review 2 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..d74239f2402f7abdd94133d4901c4cb88925705`
- 修复增量重点：`50a2207..d74239f`（binaryType、epoch/stop 串行化、port 背压、真帧 mock、删熵增包装）
- 风险等级：仓未声明，按 `internal`；本 diff 属状态机/资源清理，按 infra 例外提档
- Verdict：**fail**
- 本轮新增：2 条 P1、1 条 P2

## 修复闭环核验表

| 上轮 finding | 假闭环拆穿输入 | H0 证据 | base 红验 | 结论 |
|---|---|---|---|---|
| P1 binaryType 缺省 Blob | 浏览器原生 WebSocket 默认 `binaryType='blob'`，真实二进制 0x9/0xF 响应进入引擎后应被拒绝 | `src/asr/doubao/engine.ts:88-94` 设为 `arraybuffer`；`tests/asr-engine.test.ts:243-260` 绿 | `50a2207` 同测试红：实际 `blob` | 真闭环 |
| P1 flushWaiter 竞争卡死 | stop 等待中插入 provider error，错误路径再次 stop；若未串行化，第二次 stop 覆盖 waiter/重复清理 | engine `captureStopPromise`：`engine.ts:503-515`；capture `stopPromise` 与 epoch waiter：`engine.ts:219-248`；交错测试绿 | `serializes interleaved...` 红：`capture.stopCalls=2`，期望 1 | 真闭环；真实 BrowserPcmCapture flush-ack 仍缺直接 seam 测试，列 backlog |
| P2 worklet port 背压 | `bufferedAmount=0` 且应用队列为空，但 MessagePort 仍积压 >2s PCM | `src/asr/worklet-entry.ts:76-85` 带 `posted`；`engine.ts:190-207,215-217,468-479` 计入总量 | base 错误列表 `[]`；H0 `reports network-too-slow when the worklet port...` 绿 | 真闭环 |
| P2 mock 真帧驱动 | mock 若继续自行 JSON 编码，真实 fixture 字节断言应拆穿 | `tests/fixtures/asr/mock-volc-server.ts:7-21,101-107,112-134` 发送真实 012/013；`tests/asr-engine.test.ts:277-312` 比对 sent 字节和尾包 | base 收到旧文本 `connected/mock partial`；H0 绿 | 真闭环；错误帧分支仍独立构造，但不改变原 finding 闭环 |
| P2 熵增包装 | 反射模块导出，检查 alias/PCM 包装是否仍暴露 | `d74239f` 删除三个 wrapper；`tests/asr-pcm.test.ts:9-16` 绿 | base 仍导出 wrapper，断言红 | 真闭环 |

## 误拒穷举：protocol 严格校验

| 合法输入 | 是否误拒 | 证据 |
|---|---|---|
| 当前 `_async` full request：0x1/flags0、offset 8 | 否 | 主 fixture `000-send-full-client-request.hex`；`tests/asr-protocol.test.ts:20-30` |
| PCM audio：0x2/flags0、offset 8、3200B s16le | 否 | 主 fixture `001-send-audio-1.hex`；`tests/asr-protocol.test.ts:32-37` |
| 无序列尾包：0x2/flags2、offset 8、空 payload | 否 | `tests/asr-protocol.test.ts:54-58` |
| 带序列尾包：0x2/flags3、offset 12、`sequence=-12` | 否 | `tests/asr-protocol.test.ts:39-41,109-112` |
| 0x9 partial flags0/offset8；0x9 final flags3/offset12/正序列 | 否 | `tests/asr-protocol.test.ts:43-52`；默认 `query-seedasr-duration` fixture 的 75 个合法帧全部 decode |
| 0xF error：flags0、code + length + JSON、offset12 | 否 | 真实错误 fixture；`tests/asr-protocol.test.ts:60-70` |
| `Uint8Array` view 或 `ArrayBuffer` 输入 | 否 | `src/asr/doubao/protocol.ts:59-67,140-145` 按 byteOffset 读取 |
| 旧 `/bigmodel` legacy 0x9/flags1 partial | 是，但不属当前合法契约 | spike 将 `_async` 定为默认 endpoint，旧 endpoint 仅兼容对照，不进默认实现 |
| 结构长度正确但 payload 不是 JSON | 未拒绝而 fail-open | `protocol.ts:154-162` 将 JSON 异常转为 `json: undefined`；见 P1-F2 |

## 误拒穷举：PCM RangeError

| 合法输入 | 是否误拒 | 证据 |
|---|---|---|
| 有限 `-1..1` 样本 | 否 | `src/asr/pcm.ts:8-13`；PCM 测试绿 |
| 量化允许的溢出样本 `-2/2` | 否，截断到 int16 边界 | `tests/asr-pcm.test.ts:18-26` |
| 空 `Float32Array`、足够大的 caller-owned target | 否 | `pcm.ts:33-47`；`tests/asr-pcm.test.ts:54-59` |
| 单声道/等长多声道 downmix | 否 | `pcm.ts:15-30`；`tests/asr-pcm.test.ts:44-52` |
| `NaN/±Infinity` | 否；不是合法 PCM 样本，RangeError 为预期 fail-loud | `pcm.ts:8-10`；3 个 RangeError 测试绿 |
| 无声道、缺声道、短声道、过小 target | 否；这些是非法 PCM 形状 | `pcm.ts:20-28,38-40`；AudioWorklet 无输入在 `worklet-entry.ts:99-102` 直接跳过 |

## 误拒穷举：config apiKey 必填

| 合法输入 | 是否误拒 | 证据 |
|---|---|---|
| disabled 且省略 apiKey | 否 | `assertValidConfigOverrides({asr:{enabled:false}})` 探针 accepted；`config-schema.ts:323-327` 仅 enabled=true 检查 |
| disabled 且空 apiKey | 否 | `tests/config-validate.test.ts:52-55` |
| enabled + 非空字符串 key，resourceId 省略用默认值 | 否 | `tests/config-validate.test.ts:29-40`、`tests/config.test.ts:119-128` |
| enabled + key 为字符串 `"0"` | 否 | 非空字符串条件；探针 accepted |
| enabled + 缺 key/空 key | 是，但这是设计要求 | `config-schema.ts:321-337`；测试确认路径存在且值 redacted |
| `asr`/`doubao` 被 secret 字符串整体替换 | 是，但不是合法 config shape | `config-validate.ts:88-97`；`tests/config-validate.test.ts:58-73` |

## 误拒穷举：epoch 失配丢弃

| 合法输入/时序 | 是否误拒 | 证据 |
|---|---|---|
| 旧轮 socket 在新轮触发 error/message | 否；应丢弃旧轮事件 | `engine.ts:377-389,417-447`；`tests/asr-engine.test.ts:436-440` 绿 |
| 旧轮 capture callback 在新轮到达 | 否；应丢弃，不写入新轮 | `engine.ts:333-335`、capture handler `engine.ts:195` |
| 当前轮 provider error 在 stop 等待中发生 | 否；只报告一次且不污染下一轮 | `engine.ts:518-531`；交错测试绿 |
| 正常 final/timeout 后 cleanup，再 start 下一轮 | 否 | `engine.ts:533-544`；7 个 ASR 定点测试文件 158 tests 绿 |
| `getUserMedia` pending 时 stop，授权随后返回 | 不是误拒，而是错误状态迁移：迟到资源仍被创建 | `engine.ts:333-338`、`BrowserPcmCapture.start` `engine.ts:153-187`；P1-F1 |

## 红验结果

红验均在 `50a2207` 临时 worktree 仅拷入目标测试文件后运行，未修改被审分支；H0 同测试均绿。

| 新增测试 | base 结果 | H0 结果 |
|---|---|---|
| `sets browser websocket binaryType to arraybuffer` | 红：`blob` ≠ `arraybuffer` | 绿 |
| `reports network-too-slow when the worklet port has queued PCM` | 红：`errors=[]` | 绿 |
| `serializes interleaved stop and provider failure across capture epochs` | 红：`stopCalls=2`，期望 1 | 绿 |
| `streams injected PCM through real server response fixtures` | 红：收到 `connected/mock partial` | 绿 |
| `does not expose test-only PCM or protocol wrappers` | 红：旧导出仍存在 | 绿 |

## epoch/stop 状态迁移表与不一致窗口

| 状态 | 事件 | 迁移 | 结论 |
|---|---|---|---|
| idle(e) | start | `epoch=e+1`，starting；等待旧 capture stop 后开 socket/capture，成功 recording | 正常 |
| recording(e) | stop | stopping；停 monitor，复用 capture stop，发尾包，等 final/3s，cleanup 到 idle(e+1) | 正常；上轮 stop 竞争已收敛 |
| stopping(e) | provider/protocol/socket fail | fail 只命中一次，epoch++、idle、resolve waiter、复用同一个 capture stop；旧 stop 由 guard 返回 | H0 交错测试通过 |
| starting(e) | fail | engine epoch 失配，但 pending `capture.start` 没有取消标记；无资源时的 stop 先完成，迟到授权仍建 stream/context/node | **不一致，P1-F1** |
| starting(e) | stop | stop 不递增 epoch；pending capture start 返回后只检查 epoch，仍可能写 recording；cleanup 不再次 stop 新资源 | **不一致，P1-F1** |
| idle(e) 且旧 captureStop pending | start 与 stop 交错 | start 等待后不复查 state；stop 可先置 stopping，start 仍创建第二 socket/capture | **不一致，P1-F1** |
| cleanup 后 idle | stale callback | 新 epoch 使旧事件丢弃 | 这部分机制正确，但不能覆盖 pending capture start |

## Findings

### P1-F1：pending capture start 未被 stop/fail 取消，导致泄漏并可停后启动

- 溯源 spec：`docs/designs/asr-voice-input.md` E3 会话 epoch、错误路径零静默失败；`docs/sessions/cards/asr-engine-inc1.md` 完成条件 1/3（start/stop 全链路、停采集→排空→尾包）。
- 证据：`src/asr/doubao/engine.ts:313-343` 只在 `capture.start()` 返回后检查 engine epoch；`engine.ts:345-362` 的 stop 在 starting 状态不递增 epoch；`BrowserPcmCapture.start()` `engine.ts:153-187` 会在异步 getUserMedia 后继续建资源；`cleanup()` `engine.ts:533-544` 不调用 capture.stop。
- 触发路径：fake browser `getUserMedia` pending，先 `start()` 再 `stop()`，随后释放授权；`start/stop` 均 fulfilled，但 track `stopped:false`。WS fail 同样可在权限 pending 时触发，fail 的无资源 stop 先结束，迟到授权仍泄漏资源。旧轮 fail 后 captureStop pending，再 start/stop 交错时独立探针观测 `startCalls=2,sockets=2,stopCalls=1`。
- P1 两问：真实手机权限弹窗、AudioContext 初始化、WS 握手与用户松手/网络断开可交错；麦克风 track/context 在 stop/fail 后仍存活且后续可能覆盖引用，属于不可接受的资源泄漏和错误 start/stop 语义。

### P1-F2：结构完整但 JSON payload 畸形时静默吞掉

- 溯源 spec：`docs/sessions/cards/asr-engine-inc1.md` 轴 1“畸形帧拒绝”、完成条件 1/4；`docs/designs/asr-voice-input.md` 错误路径零静默失败与 0x9/0xF 处理。
- 证据：`src/asr/doubao/protocol.ts:154-162` 捕获 JSON.parse 异常并返回 `json: undefined`；`src/asr/doubao/engine.ts:426-443` 对 `getText()===undefined` 直接 return，不触发 protocol-error/onError。
- 触发路径：构造 0x9 flags0、长度正确、payload 为 `{` 的帧。探针得到 `decodeFrame -> server-response/json=undefined`，引擎 `errors=[]、partials=[]`，随后正常 stop 也无错误。
- P1 两问：provider 协议漂移或异常 payload 会沿真实 WS onmessage 进入；partial/final 被丢弃且无错误回调，用户得到静默缺字，违反结果错但不报错红线。

### P2-F3：capture.stop rejection 后引擎卡在 stopping

- 溯源 spec：`docs/designs/asr-voice-input.md` 错误路径零静默失败；`docs/sessions/cards/asr-engine-inc1.md` 完成条件 3 失败清理。
- 证据：`engine.ts:345-352` 直接 await `requestCaptureStop()`，无失败终态；`engine.ts:503-515` 只清 promise；`engine.ts:518-531` fail 路径 fire-and-forget 丢弃 rejection。注入 stop rejection 后结果为 `stop=rejected`、后续 start fulfilled 但实际 no-op、`errors=[]`、socket 仍 OPEN。
- 级别：异常 capture 状态下可触发但低于 internal+infra P1 稳定触发红线，列 P2；仍需 fail-loud 收口。

## Backlog

- 实际 BrowserPcmCapture flush-ack 机制已有 epoch + stopPromise，但当前绿测使用 injected capture seam；应补真实 AudioWorklet port fake，覆盖 flush ack pending → provider fail → stop → next start。
- 旧 `/bigmodel` fixture 的 flags1 partial 被拒绝；其 endpoint 已被 spike 排除默认契约，不放宽 decoder。
- H0 全量 vitest 的非 ASR CLI/serve 失败均是临时 worktree 缺 `tsx`（`spawn tsx ENOENT`），应在完整依赖 checkout 复跑。
- 上轮 P1 虽已闭环，本轮新增 P1，按 internal + infra 收敛规则不能判 pass。
