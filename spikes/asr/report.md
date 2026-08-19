<!-- delegate-outcome: failed -->

# 执行器报告：ASR 增量 0 Spike

## Outcome

本卡按任务卡收口为 `failed`：密钥未就位导致 Node 探针无法建立连接。无服务端 no-go 结论，也没有伪造 fixture。

## 已完成

- `spikes/asr/probe-auth.ts`：query raw、query STS JWT、header 对照、尾包两个 variant、opus、协议错误 0xF、业务错误 0x9 分类、全帧 hex/transcript 录制、密钥脱敏。
- `spikes/asr/probe.html`：16 kHz 实际采样率、AudioWorklet、getUserMedia、iOS Safari/PWA/Android 标记与四类中断事件观察；内含 HTTPS 和真机步骤。
- `spikes/asr/PROTOCOL-NOTES.md`：header nibble、offset 推导、full request 脱敏样例、fixture 约定与待实跑结论。
- `docs/sessions/260819-1306-asr-spike-results.md`：逐项验收状态、阻塞原因和增量 1 影响。

## 真实验证

```text
node_modules/.bin/tsx --no-cache spikes/asr/probe-auth.ts query-raw
FATAL: 缺少 VOLC_APP_KEY / VOLC_ACCESS_KEY（环境变量或 spikes/asr/.env.local）
exit=2
```

`pnpm exec biome check spikes/asr` 通过；探针使用专门 TypeScript 编译参数检查通过；浏览器页内脚本用 Node `new Function` 语法检查通过。`tests/fixtures/asr/` 没有真实帧目录。

fixture 目录探活：`tests/fixtures/asr/` 为空，`fixture_total_bytes=0`。

## 安全自查

已检查新增输出物和差异：没有密钥值、STS token、完整带参 wss URL 或 STS 响应原文；日志只写 origin/path、query 参数名、状态码、logid（若服务端提供）和 payload 截断摘要。主仓 `.env.local` 未复制、移动或删除。

## 提交

- `063382d chore(asr): add SAUC auth spike probe [codex]`
- `d8fc128 chore(asr): add browser capability probe [codex]`
- `d158554 test(asr): record blocked live probe run [codex]`

等待密钥就位后应重跑 `node_modules/.bin/tsx --no-cache spikes/asr/probe-auth.ts all`，再用真实 fixture 补齐结果文档；当前不应进入增量 1。
