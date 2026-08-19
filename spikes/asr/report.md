<!-- delegate-outcome: succeeded -->

# 执行器报告：ASR 增量 0 Spike

## Outcome

本卡按任务卡收口为 `succeeded`：密钥已就位，Node 探针真实完成新版 `_async` query/header 候选、full/PCM/partial/final、尾包、opus 和错误模式运行。

## 结论

- **GO**：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` + query `api_key/api_resource_id` + `volc.seedasr.sauc.duration`。
- **NO-GO**：opus；服务端返回 0xF/45000151 `unsupported format opus`。
- `neg-no-seq` 与 `neg-with-seq` 都收到 final；带序列尾包对 10 个音频帧必须是 `-12`（`-(N+2)`）。
- 19 个 fixture 目录、271 个文件、947,313 bytes；主 fixture `20260819T052830488Z-query-seedasr-duration-2b7d8bd5`。
- 真机浏览器能力仍待用户回填；页面已完成，不把 Node 网络闸门当作真机采集结论。

## 已完成

- `spikes/asr/probe-auth.ts`：读取 X_API_KEY，按新版 3 个 resourceId 试 query/header，保留旧 endpoint 对照；真实录制所有收发帧；标注 0x9 partial/final、0xF errors、opus 与两种尾包。
- `spikes/asr/probe.html`：16 kHz 实际采样率、AudioWorklet、getUserMedia、iOS Safari/PWA/Android 与中断信号观察。
- `spikes/asr/PROTOCOL-NOTES.md`：实帧 offset、尾包 sequence、resourceId/endpoint 选择、错误表现和增量 1 影响。
- `docs/sessions/260819-1306-asr-spike-results.md`：逐项验收与 go/no-go 结果。

## 真实验证摘录

```text
query-seedasr-duration: HTTP 101; 0x9 server-partial flags=0b0000 offset=8; 0x9 server-final flags=0b0011 offset=12
query-seedasr-duration-end-variant-neg-no-seq: HTTP 101; 0x9 server-final flags=0b0011 offset=12
query-seedasr-duration-opus: HTTP 101; 0xF code=45000151 unsupported format opus
query-seedasr-duration-protocol-error: HTTP 101; 0xF code=45000000
```

错误 fixture 还记录 45000292 并发配额不足、旧尾包 `-11` 导致 expected `-12` 的 sequence mismatch，以及非法 format 的 45000151。所有候选握手均 101，没有握手拒绝样本。

## 安全自查

输出物没有 key 值、完整带参 wss URL、STS token 或 STS body；fixture 只保存二进制帧、脱敏 payload 摘要、endpoint/resourceId/authMode。主仓 `.env.local` 只读使用，未复制、移动或删除。

## 提交

本轮将按小步提交：探针代码、真实 fixture、备忘/结果文档。最终 commit 列表以 `git log` 为准；未 push、未开 PR、未修改 `src/`。

下一步：用户回填 `probe.html` 真机结果后，增量 1 采用单 `apiKey`、`volc.seedasr.sauc.duration`、`bigmodel_async`、PCM 传输与已锁定帧规则。
