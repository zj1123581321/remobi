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
| 浏览器能力页 | ✅（代码）/ ❌（真机待回填） | `probe.html` 已覆盖 16k 实际采样率、AudioWorklet、getUserMedia、Safari 标签页/PWA/Android 与中断信号；真机结果仍由用户回填。 |
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

当前真机各项仍为“待用户真机回填”，Node 网络闸门 GO 不替代采集能力验证。

## 对增量 1 的设计影响

- config 从 `appKey + accessKey` 改为单 `apiKey`，默认 resourceId 为 `volc.seedasr.sauc.duration`。
- 主 endpoint 改为 `/api/v3/sauc/bigmodel_async`；旧 `/bigmodel` 只作为兼容事实，不进默认实现。
- PCM 16 kHz/16-bit/mono 保持；opus 实测不支持，不重评 MediaRecorder 路径。
- `neg-no-seq` 与 `neg-with-seq` 均可接受；带序列尾包按实测 `-(audioFrameCount+2)` 编码，0x9 final flags=`0b0011`、sequence/payload offset=12。
- 由于正弦波没有文本，增量 1 仍需使用真实语音或 mock fixture 验证文本字段；本 spike 已提供协议层 golden 输入。

## 产出与提交

- `spikes/asr/probe-auth.ts`：X_API_KEY、`_async`/旧端点、resourceId query/header 候选、错误/opus/尾包探针。
- `spikes/asr/probe.html`：浏览器能力与中断观察页。
- `spikes/asr/PROTOCOL-NOTES.md`：实跑协议备忘。
- `tests/fixtures/asr/`：19 个运行目录，真实收发帧 hex + transcript/meta。
- `docs/sessions/260819-1306-asr-spike-results.md`：本结果文档。

## 报告与后续

Outcome 本轮为 `succeeded`（探针已真实运行，无论协议结论如何均按任务卡成功收口）。真机页面结果待用户回填；增量 1 可基于本 fixture 进入设计/实现评审。
