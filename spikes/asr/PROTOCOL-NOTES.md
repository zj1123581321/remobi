# SAUC bigmodel 协议备忘（增量 0）

状态：探针代码已完成，但本次执行没有 `VOLC_APP_KEY` / `VOLC_ACCESS_KEY`，未建立 WebSocket，以下“实帧”结论均标记为待实跑；不得把源码推导当成服务端验收证据。

## 端点与鉴权候选

端点 origin/path：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`。

Node 探针按以下顺序单独尝试，并且 stdout 只打印 origin 与 query 参数名：

1. query raw：`api_resource_id`、`api_app_key`、`api_access_key`，最后一个放原始 Access Key。
2. query STS：同三个参数，`api_access_key` 放 `Jwt; <STS token>`；STS 响应只在内存中使用，失败时只输出状态码和 body 的截断 SHA-256。
3. header 对照：`X-Api-App-Key`、`X-Api-Access-Key`、`X-Api-Resource-Id`，不带 query。

Node 的握手拒绝通过 `unexpected-response` 记录 HTTP 状态码和可见的 `X-Tt-Logid`。浏览器 WebSocket 无法读取 upgrade 的 HTTP 状态/响应 header，预期只能得到通用 `error`/`close`，这一区别会写入最终实跑结果。

## Header nibble 与 payload offset

协议头 4 字节，按 SDK 源码的实际编码为：

| byte | 高 4 bit | 低 4 bit | 本探针值 |
| --- | --- | --- | --- |
| 0 | version | header size（4 字节 word 数） | `0b0001` / `0b0001`，即 `0x11` |
| 1 | message type | flags | 见下表 |
| 2 | serialization | compression | JSON=`0b0001`，none=`0b0000` |
| 3 | reserved | — | `0x00` |

| message type | 值 | 含义 |
| --- | --- | --- |
| client full request | `0b0001` | 首帧 JSON 配置 |
| client audio only | `0b0010` | 后续音频 bytes |
| server full response | `0b1001` | 大模型 JSON 响应，业务错误也按此帧型分类 |
| server ack | `0b1011` | 服务端 ack |
| server error | `0b1111` | 协议错误 |

SDK 源码和探针共用的 flags：none=`0b0000`、positive sequence=`0b0001`、negative without sequence=`0b0010`、negative with sequence=`0b0011`。

client full/audio 帧均为：4 字节 header + 4 字节大端 payload 长度 + payload，因此 payload offset 是 8。bigmodel server full response 的实协议需由 fixture 再确认；SDK 的解析路径按 4 字节 sequence + 4 字节 payload 长度处理，因此探针记录的预期 payload offset 是 12。server error 为 4 字节 error code + 4 字节 payload 长度，预期 payload offset 也是 12。每个 fixture 的 `transcript.jsonl` 会记录实际 `header`、`payloadOffset`、`payloadSize`、sequence/errorCode 和 payload SHA-256。

## Full client request 脱敏样例

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

音频为程序生成的 16 kHz、16-bit、mono 440 Hz 正弦 PCM，每 100 ms（3200 bytes）一帧；发送侧不 gzip、不带正序列号，符合 SDK demo 的发送路径。探针会记录所有收发帧的完整 hex，但不会记录 URL、query 值、header 值或 STS body。

## 尾包 variant（必须由实帧锁定）

本次没有密钥，结论为：**未定案**。

探针会在一条已握手链路上分别发送：

- `neg-no-seq`：header flags=`0b0010` + payload length `0`，payload offset 8。
- `neg-with-seq`：header flags=`0b0011` + 4 字节负序列号 + payload length `0`，payload offset 12。

最终采用哪一种、服务端是否返回 final，必须以 `tests/fixtures/asr/<run>/transcript.jsonl` 的收发顺序和服务端响应为准；当前不可提前给增量 1 选型。

## 错误表现记录规则

- 握手拒绝：Node 记录 HTTP 状态码、状态文本、`X-Tt-Logid`（若有）；浏览器侧只记录通用 error/close，无法获得 upgrade 状态和 logid。
- 协议错误：message type `0b1111`（0xF），记录 error code、payload offset 和 payload SHA-256。
- 业务错误：message type `0b1001`（0x9）但 JSON 中 `code` 非零，记录业务 code 和摘要。正常 partial/final 也属于 0x9，需以 JSON 的 `result.is_final` / `result.definite` 区分。

`protocol-error` 模式会在 full request 后追加故意截断的 4 字节帧；`business-error` 模式会发送非法 model/format，二者都只在至少一条鉴权链路握手成功后运行。若服务端返回 close 而非错误帧，仍按真实结果记录，不猜测。

## fixture 约定

每次运行目录形如 `YYYYMMDDTHHMMSSZ-<mode>-<id>/`，每帧一个 `<id>-<send|recv>-<label>.hex`，另有：

- `transcript.jsonl`：方向、label、header nibble、payload offset/size、sequence/error code、payload 摘要；
- `meta.json`：模式、握手结果、HTTP 状态/close code 和不含密钥的说明。

本次没有生成 fixture，因为探针在打开 socket 前因缺少密钥 fail-fast；证据见 `spikes/asr/live-run.log` 和结果文档。

## 对增量 1 的暂时输入

当前没有可供 golden 测试使用的真实帧，不能锁定服务端 response offset、尾包 variant、partial/final JSON、opus 可用性或采样率回退策略。增量 1 应等待本 spike 在密钥就位后重新执行并验收结果。
