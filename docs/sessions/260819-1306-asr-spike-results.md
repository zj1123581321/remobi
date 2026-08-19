# ASR 增量 0 Spike 结果（2026-08-19，实跑更新）

## 执行结论

**GO（query 直连闸门通过）**：使用单个 `X_API_KEY`，新版 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`，query `api_key + api_resource_id`，resourceId `volc.seedasr.sauc.duration`，Node 真实完成 HTTP 101、full client request、16 kHz PCM 上行、0x9 partial/final 下行。由于音频是正弦波，文本为空；这验证协议链路，不验证识别质量。

`volc.seedasr.sauc.concurrent` 的鉴权也通过，但业务层返回 45000292 并发配额不足；`volc.bigasr.sauc.duration` 的 `_async` 与旧 `/bigmodel` 对照均有真实响应。旧端点不作为增量 1 默认路径。

## 验收清单

| 项目 | 状态 | 证据与说明 |
| --- | --- | --- |
| query 鉴权握手 | ✅ | `_async + api_key + seedasr.duration` HTTP 101，fixture `20260819T052830488Z-query-seedasr-duration-2b7d8bd5`；header 对照同样 101。旧 `/bigmodel + api_key` 也 101。 |
| full/audio/partial/final 真实 fixture | ✅ | 19 个目录、271 个文件、948,065 bytes；主 fixture 含 full、10 个 PCM 音频帧、0x9 partial、0x9 final、尾包。 |
| 尾包 `0b0010` vs `0b0011` | ✅ | `neg-no-seq` 与 `neg-with-seq` 都返回 final；带序列尾包的实测序列规则为 10 音频帧时 `-12 = -(N+2)`。 |
| 握手拒绝 | ❌ | 本轮所有候选均 101，没有 401/403 样本；Node rejection 分支仍保留，浏览器只能获得通用 error/close 的差异已记录。 |
| 协议错误 0xF | ✅ | 45000000（尾包序列错/截断帧）、45000151（非法格式）、45000292（并发配额）均有真实帧。 |
| 业务错误 0x9 | ❌ | 实际 0x9 是 partial/final server response；非法 opus/format 实际返回 0xF/45000151，未观察到 0x9 非零业务 code，已如实记录。 |
| opus 附带探针 | ❌ | full request 可握手，但服务端 0xF/45000151 明确 `unsupported format opus`；增量 1 禁用 opus。 |
| 浏览器能力页 | ✅（代码 + 真机三环境） | `probe.html` 真机实测（2026-08-19，日志见下节）：Android Chrome 151 与 iOS 17.4（Safari 标签页 + 真 standalone PWA）`AudioContext({sampleRate:16000})` 实际输出均 16000；AudioWorklet 三环境全 ok；getUserMedia 三环境全 ok（iOS 17.4 PWA 实测可用）。中断信号见下节矩阵。 |
| 密钥零泄露自查 | ✅ | 输出物无 key 值、完整带参 wss URL、STS token 或 STS body；fixture 仅保存帧 bytes、脱敏摘要、resourceId 和 endpoint。 |

## 实跑 stdout 摘录

```text
=== mode=query-seedasr-duration ... ===
target: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async resource=volc.seedasr.sauc.duration auth=query (query 参数名: api_key,api_resource_id)
握手成功（HTTP 101）
recv server-partial ... type=0b1001 flags=0b0000 offset=8
recv server-final ... type=0b1001 flags=0b0011 offset=12
=> OK: 收到 final 响应

=== mode=query-seedasr-duration-opus ... ===
recv protocol-error ... type=0b1111 ...
protocol-error code=45000151
=> OK: 收到协议错误帧 0xF code=45000151
```

## 浏览器真机步骤与状态

1. 使用 HTTPS 打开 `spikes/asr/probe.html`；LAN `http://IP:端口` 不是 secure context，需 Tailscale Serve 或 HTTPS 反向代理。
2. 分别在 iPhone Safari 标签页、iPhone 主屏 standalone PWA、Android Chrome 打开。
3. 点击“开始能力检测”，记录实际 `AudioContext.sampleRate`、AudioWorklet、getUserMedia 结果。
4. 测试切后台、锁屏、来电/其它音频中断，保留 `track.onended`、`track.onmute`、`AudioContext.statechange`、`visibilitychange` 顺序。
5. 复制 JSONL 日志回填本结果文档。

真机已回填（2026-08-19，用户设备：iPhone iOS 17.4 + Android Chrome 151，经 Tailscale Serve HTTPS）：

| 环境 | 16k 实际采样率 | AudioWorklet | getUserMedia | 锁屏/切后台触发的信号 |
| --- | --- | --- | --- | --- |
| Android Chrome 151（标签页） | 16000 ✅ | ok ✅ | ok ✅ | 仅 `visibilitychange`(hidden→visible)；track 事件与 statechange 全程静默 |
| iOS 17.4 Safari 标签页 | 16000 ✅（AudioContext 先 `suspended`，~150ms 后自动 `running`） | ok ✅ | ok ✅ | 仅 `visibilitychange`；后台 JS 冻结，track 事件不投递 |
| iOS 17.4 主屏 standalone PWA | 16000 ✅（同样 suspended→running） | ok ✅ | ok ✅ | `track-mute`（比 visibilitychange hidden 早 ~0.6s）→ hidden → visible → `track-unmute`，回前台采集自动恢复，无需重新授权 |

要点：

- `AudioContext({sampleRate:16000})` 三环境都真给 16000——pcm.ts 线性抽取回退不建（维持设计默认路径）。
- iOS 上 AudioContext 启动为 `suspended` 后自动转 `running`：增量 1 引擎要容忍这个启动时序（构造后校验 + 等待 running，不能假定构造即 running）。
- 中断信号矩阵证实设计 v5 #4 的多信号 OR 是最保守正解：`visibilitychange` 三环境全覆盖；`track.onmute/onunmute` 只在 iOS PWA 真实出现（观察/unmute 恢复/超时 cancel）；`track.onended` 与 `AudioContext.statechange(interrupted)` 三环境锁屏/切后台均未触发，仅作为兜底保留。
- 用户在书签环境（非 standalone）曾观察到中断后重新请求麦克风授权；真 standalone PWA 锁屏路径实测为 mute/unmute 自动恢复、无重新授权。来电/Siri 硬中断（track.onended 路径）本轮未制造出来，按设计「任一信号触发即 cancelled」覆盖，增量 2 e2e 用 fake track 补测。
- 回填方法学备注：首轮「PWA」日志实际是 Safari 书签（探针页缺 `apple-mobile-web-app-capable`，`standalone:false` 露馅），补 meta 后重测才拿到真 PWA 数据——验证 PWA 结论先看 `navigator.standalone`。

## 对增量 1 的设计影响

- config 从 `appKey + accessKey` 改为单 `apiKey`，默认 resourceId 为 `volc.seedasr.sauc.duration`。
- 主 endpoint 改为 `/api/v3/sauc/bigmodel_async`；旧 `/bigmodel` 只作为兼容事实，不进默认实现。
- PCM 16 kHz/16-bit/mono 保持；opus 实测不支持，不重评 MediaRecorder 路径。
- `neg-no-seq` 与 `neg-with-seq` 均可接受；带序列尾包按实测 `-(audioFrameCount+2)` 编码，0x9 final flags=`0b0011`、sequence/payload offset=12。
- 由于正弦波没有文本，增量 1 仍需使用真实语音或 mock fixture 验证文本字段；本 spike 已提供协议层 golden 输入。
- 真机采集能力三环境全绿（采样率/worklet/getUserMedia），iOS PWA 可用性假设成立；引擎需处理 iOS AudioContext suspended→running 启动时序，中断检测按 `visibilitychange` 全覆盖 + `track.onmute/unmute`（iOS PWA 实测）+ `track.onended` 兜底的多信号 OR。

## 产出与提交

- `spikes/asr/probe-auth.ts`：X_API_KEY、`_async`/旧端点、resourceId query/header 候选、错误/opus/尾包探针。
- `spikes/asr/probe.html`：浏览器能力与中断观察页。
- `spikes/asr/PROTOCOL-NOTES.md`：实跑协议备忘。
- `tests/fixtures/asr/`：19 个运行目录，真实收发帧 hex + transcript/meta。
- `docs/sessions/260819-1306-asr-spike-results.md`：本结果文档。

## 报告与后续

Outcome 本轮为 `succeeded`（探针已真实运行，无论协议结论如何均按任务卡成功收口）。真机三环境已于 2026-08-19 回填完毕（见上节矩阵）；增量 1 可基于本 fixture 进入设计/实现评审。
