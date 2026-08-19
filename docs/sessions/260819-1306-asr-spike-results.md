# ASR 增量 0 Spike 结果（2026-08-19 13:06）

## 执行结论

**FAILED（阻塞）**：本次执行未能开始网络探针，因为指定密钥文件 `/home/zlx/projects/oss/remobi/spikes/asr/.env.local` 不存在，环境变量 `VOLC_APP_KEY` / `VOLC_ACCESS_KEY` 也未就位。这里不是服务端 no-go 判定；在密钥就位前，不能声称 query 鉴权支持或不支持。

真实执行证据：`spikes/asr/live-run.log`。

```text
$ node_modules/.bin/tsx --no-cache spikes/asr/probe-auth.ts query-raw
FATAL: 缺少 VOLC_APP_KEY / VOLC_ACCESS_KEY（环境变量或 spikes/asr/.env.local）
$ echo $?
2
```

fixture 目录探活（本次没有生成帧）：

```text
tests/fixtures/asr/：空目录
fixture_total_bytes=0
```

## 验收清单

| 项目 | 状态 | 证据与说明 |
| --- | --- | --- |
| query 鉴权握手 | ❌ | 未进入 WebSocket；缺钥 fail-fast。脚本已实现 query raw、STS JWT、header 对照三条路径，待密钥重跑。 |
| full/audio/partial/final 真实 fixture | ❌ | `tests/fixtures/asr/` 没有生成帧；不能用源码或模拟帧替代真实服务端帧。 |
| 尾包 `0b0010` vs `0b0011` | ❌ | 两个发送分支和 offset 记录已实现，但未获得实帧，当前未定案。 |
| 握手拒绝、0xF、0x9 错误表现 | ❌ | Node HTTP rejection、协议错误模式、业务错误分类均已实现，但没有握手可供触发。浏览器侧差异已写入页面和协议备忘。 |
| 浏览器探针页 | ✅（代码）/ ❌（真机结果） | `spikes/asr/probe.html` 已完成；iPhone Safari 标签页、iPhone 主屏 PWA、Android Chrome 和中断信号均标记待用户真机回填。 |
| AudioContext 实际 16 kHz | ❌ | 页面会在用户点击后记录请求值与实际 `sampleRate`；当前无真机结果。 |
| opus 附带探针 | ❌ | Node `opus` 模式已实现，但没有鉴权链路，未确认服务端是否接受。 |
| 密钥零泄露自查 | ✅ | 输出物只含 origin/path、query 参数名、脱敏配置样例、帧摘要和缺钥错误；没有密钥值、STS token、完整带参 wss URL 或 STS 原文。 |

## 浏览器探针操作步骤

1. 先把页面放在 HTTPS 下访问：LAN 的 `http://IP:端口` 不是 secure context；使用 Tailscale Serve 或 HTTPS 反向代理。`localhost` 只用于本机测试。
2. 分别在 iPhone Safari 标签页、iPhone 添加到主屏后的 standalone PWA、Android Chrome 打开页面。
3. 点击“开始能力检测”，允许麦克风权限；记录环境标识、`AudioContext` 实际采样率、`AudioWorklet.addModule`、`getUserMedia` 结果。
4. 保持页面打开，测试切后台、锁屏和来电/其它音频中断；回来后点“停止采集”。保留 `track.onended`、`track.onmute`、`AudioContext.statechange`、`visibilitychange` 的顺序。
5. 用“复制日志”把 JSONL 发回，页面不连接 ASR，也不记录音频或密钥。

## 协议与增量 1 影响

已落地的源码推导和待实跑项见 `spikes/asr/PROTOCOL-NOTES.md`。当前不能锁定：

- query 鉴权是否被 bigmodel upgrade 接受；
- 服务端 0x9 response 的 partial/final JSON 与真实 payload offset；
- `neg-no-seq` 与 `neg-with-seq` 哪个尾包被接受；
- `opus` 是否被接受；
- 16 kHz 是否被目标真机实际遵守，以及是否需要线性抽取回退。

因此增量 1 仍被本 spike 阻塞，不应据此写正式引擎或 golden fixture 测试。密钥就位后，直接运行：

```text
node_modules/.bin/tsx --no-cache spikes/asr/probe-auth.ts all
```

探针会把真实帧写入 `tests/fixtures/asr/`，然后再补本结果文档的状态、fixture 清单、stdout 摘录和最终 go/no-go。

## 产出与提交

- `spikes/asr/probe-auth.ts`：Node 探针，包含 query/header/STS、SAUC 帧编解码、尾包、opus、0xF/0x9 模式和脱敏 fixture 录制。
- `spikes/asr/probe.html`：零依赖浏览器能力/中断探针与真机步骤。
- `spikes/asr/live-run.log`：本次真实缺钥运行证据。
- `spikes/asr/PROTOCOL-NOTES.md`：协议备忘与待实跑锁定项。
- `docs/sessions/260819-1306-asr-spike-results.md`：本结果文档。
- 真实 fixture：无（密钥未就位）。

提交：`063382d`、`d8fc128`、`d158554`、`416c6ca`、`a214883`，本轮未 push、未开 PR、未修改 `src/` 或主仓 checkout。
