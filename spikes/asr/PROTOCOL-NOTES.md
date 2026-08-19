# SAUC bigmodel 协议备忘（增量 0，实跑版）

状态：✅ 2026-08-19 已用主仓 `.env.local` 的单个 `X_API_KEY` 真实运行。query 直连闸门结论为 **GO**：新版 `_async` 端点、`api_key + api_resource_id` query 鉴权、`volc.seedasr.sauc.duration` 均完成 HTTP 101、full request、PCM 上行、0x9 partial/final 下行。密钥值从未进入 stdout、fixture、备忘、结果文档或报告。

## 端点、密钥与候选

主端点：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`。

密钥只读取 `X_API_KEY`（优先环境变量，其次只读主仓绝对路径 `/home/zlx/projects/oss/remobi/spikes/asr/.env.local`），不再读取旧版 `VOLC_APP_KEY` / `VOLC_ACCESS_KEY`。输出只打印 endpoint、resourceId、鉴权方式和 query 参数名。

| 探针候选 | 实跑结果 | 证据 |
| --- | --- | --- |
| `_async` query + `volc.seedasr.sauc.duration` | ✅ GO | `20260819T052830488Z-query-seedasr-duration-2b7d8bd5`：101、0x9 partial、0x9 final |
| `_async` query + `volc.seedasr.sauc.concurrent` | ⚠️ 鉴权通过，业务配额拒绝 | `20260819T052613808Z-query-seedasr-concurrent-40a7884a`：0xF/45000292，`quota exceeded for types: concurrency` |
| `_async` query + `volc.bigasr.sauc.duration` | ⚠️ 101；首轮尾包序号错误 | `20260819T052613997Z-query-bigasr-duration-928a5a65`：0xF/45000000 为 probe sequence mismatch |
| `_async` header + `volc.seedasr.sauc.duration` | ✅ 对照通过 | `20260819T052917193Z-header-seedasr-duration-dce0213c`：101、partial、final |
| `_async` header + `volc.seedasr.sauc.concurrent` | ⚠️ 鉴权通过，业务配额拒绝 | `20260819T052614458Z-header-seedasr-concurrent-a626ccba`：0xF/45000292 |
| `_async` header + `volc.bigasr.sauc.duration` | ⚠️ 101；首轮尾包序号错误 | `20260819T052614680Z-header-bigasr-duration-f6e26053` |
| 旧 `/bigmodel` query + `volc.bigasr.sauc.duration` | ✅ 低优先级对照可用 | `20260819T052917502Z-legacy-query-bigasr-duration-c4f8df13`：101、多个 partial、final |

所有候选均拿到 HTTP 101；因此 query/header 对照没有发现“key 错导致握手拒绝”。concurrent 的拒绝发生在握手后业务层，不能当作鉴权失败。

## Header nibble 与实测 payload offset

4 字节协议头：

| byte | 高 4 bit | 低 4 bit | 实测值 |
| --- | --- | --- | --- |
| 0 | version | header size（4 字节 word 数） | `0b0001` / `0b0001`，即 `0x11` |
| 1 | message type | flags | 见下表 |
| 2 | serialization | compression | JSON=`0b0001`，none=`0b0000` |
| 3 | reserved | — | `0x00` |

| message type | 值 | 含义 |
| --- | --- | --- |
| client full request | `0b0001` | 首帧 JSON 配置 |
| client audio only | `0b0010` | 后续音频 bytes |
| server full response | `0b1001` | partial/final JSON response |
| server ack | `0b1011` | 服务端 ack |
| server error | `0b1111` | 协议/业务处理错误 |

flags：none=`0b0000`、positive sequence=`0b0001`、negative without sequence=`0b0010`、negative with sequence=`0b0011`。

- client full/audio：4 字节 header + 4 字节大端 payload 长度 + payload，payload offset=8。
- `_async` 0x9 partial：实帧 flags=`0b0000`，payload offset=8；例如 payload 是只含 `result.additions.log_id` 的 JSON。
- `_async` 0x9 final：实帧 flags=`0b0011`，4 字节 sequence 后 payload 长度，payload offset=12；`sequence=1`，payload 含 `audio_info.duration=1000`。
- 旧 `/bigmodel` 的 0x9 partial 实帧 flags=`0b0001`、sequence 从 1 递增，offset=12；final flags=`0b0011`、offset=12。
- 0xF：header 后 4 字节 error code + 4 字节 payload 长度，payload offset=12。

每个 fixture 的 `transcript.jsonl` 记录方向、label、header nibble、payload offset/size、sequence/errorCode 和 payload SHA-256；完整帧在同目录 `.hex` 文件中。

## Full client request 与音频

```json
{
  "user": { "uid": "remobi-spike-<random>" },
  "audio": { "format": "pcm", "rate": 16000, "bits": 16, "channel": 1 },
  "request": {
    "model_name": "bigmodel",
    "show_utterances": true,
    "enable_punc": true
  }
}
```

音频是程序生成的 16 kHz、16-bit、mono 440 Hz 正弦 PCM，每 100 ms（3200 bytes）一帧；发送侧不 gzip、不带正序列号。服务端因此返回了 partial/final 协议响应，但正弦波没有可识别文本，实帧中的 `result.text` 为空；这证明链路和 final，不证明语音识别质量。

## 尾包 variant 定案

两种 variant 都被 `seedasr.duration` 的 `_async` query 链路接受，并收到 0x9 final：

- `neg-no-seq`：flags=`0b0010` + payload length `0`，发送帧 8 bytes，payload offset=8；fixture：`20260819T052830811Z-query-seedasr-duration-end-variant-neg-no-seq-73fd940e`。
- `neg-with-seq`：flags=`0b0011` + 4 字节负序列号 + payload length `0`，发送帧 12 bytes，payload offset=12；fixture：`20260819T052830488Z-query-seedasr-duration-2b7d8bd5`。

关键规则：本次 10 个无正序列音频帧，带序列尾包必须发 `sequence=-12`，即 `-(audioFrameCount + 2)`。旧探针曾发 `-11`，服务端真实返回 0xF/45000000：`autoAssignedSequence (-12) mismatch sequence in request (-11)`；这份错误 fixture 保留作为畸形序列 golden 证据。

## 错误表现

- **握手拒绝**：本轮没有产生 401/403；7 个候选均 HTTP 101，因此没有 Node `unexpected-response` 或握手期 `X-Tt-Logid` 样本。浏览器仍只能得到通用 error/close，不能读取 upgrade 状态/header；页面已记录该差异。
- **协议错误 0xF**：真实收到 45000000（尾包序列错、故意截断帧）、45000151（不支持音频格式/非法业务配置）和 45000292（并发配额不足）。
- **0x9 response**：真实收到 server partial/final 0x9；`0x9` 本身是 server full response，不是一个独立的错误类型。本轮没有观察到“业务错误以 0x9 + 非零 code”返回；非法 `opus` 与非法 format 实际均返回 0xF/45000151，按实帧记录，不猜测。
- 服务端 JSON 的 `result.additions.log_id` 存在，但文档/报告只写脱敏占位；握手后 HTTP header 的 X-Tt-Logid 因无拒绝样本不可见。

## opus 附带探针

`_async` query + `volc.seedasr.sauc.duration` 的 full request 将 `audio.format` 改为 `opus` 后仍 HTTP 101，但收到 0xF/45000151：`[Invalid audio format] ... unsupported format opus`。结论：opus **NO-GO**，增量 1 使用 PCM，不走 MediaRecorder opus 主路径。

## 对增量 1 的锁定输入

- 鉴权 config：从旧版 `appKey + accessKey` 改为单字段 `apiKey`，即 `X_API_KEY`；不实现 STS token。
- 默认 resourceId：`volc.seedasr.sauc.duration`（模型 2.0 小时版，实跑 GO）。`volc.seedasr.sauc.concurrent` 仅在配额明确时使用；`volc.bigasr.sauc.duration` 是旧模型/旧端点兼容对照，不作为默认。
- endpoint：主路径为 `/api/v3/sauc/bigmodel_async`；旧 `/api/v3/sauc/bigmodel` 只保留为低优先级兼容事实，不进入默认实现。
- 帧层：必须支持 0x9 partial/final，final response flags=`0b0011` 的 sequence/payload offset=12；尾包支持已实测的两 variant，并采用 `-(audioFrameCount+2)` 带序列规则。
- 音频：PCM 16 kHz/16-bit/mono；opus 已由实帧否决。

## fixture 清单

本轮 `tests/fixtures/asr/`：19 个运行目录、271 个文件、948,065 bytes。目录包括：

```text
20260819T052613529Z-query-seedasr-duration-202db12e
20260819T052613808Z-query-seedasr-concurrent-40a7884a
20260819T052613997Z-query-bigasr-duration-928a5a65
20260819T052614213Z-header-seedasr-duration-7de38beb
20260819T052614458Z-header-seedasr-concurrent-a626ccba
20260819T052614680Z-header-bigasr-duration-f6e26053
20260819T052614936Z-legacy-query-bigasr-duration-7b9820ed
20260819T052615295Z-query-seedasr-duration-end-variant-neg-no-seq-dc890134
20260819T052615588Z-query-seedasr-duration-opus-55683dc0
20260819T052615838Z-query-seedasr-duration-protocol-error-ce442d2d
20260819T052616082Z-query-seedasr-duration-business-error-ae5f26fc
20260819T052830488Z-query-seedasr-duration-2b7d8bd5
20260819T052830811Z-query-seedasr-duration-end-variant-neg-no-seq-73fd940e
20260819T052831097Z-query-seedasr-duration-opus-b801c5b7
20260819T052831301Z-query-seedasr-duration-protocol-error-de477207
20260819T052831498Z-query-seedasr-duration-business-error-eedaee0e
20260819T052917193Z-header-seedasr-duration-dce0213c
20260819T052917502Z-legacy-query-bigasr-duration-c4f8df13
20260819T052917937Z-legacy-query-bigasr-duration-end-variant-neg-no-seq-50e6b836
```
