<!-- delegate-outcome: succeeded -->

## 证据源 E：真实 WebSocket 协议 fuzzing

审查对象固定为 `ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb..24a12d3714818bc721763c9b981c196ef0758698`；本证据在 H0 `24a12d3` 的 detached worktree `/tmp/remobi-wnet-t2-h0` 上执行。临时探针为 `/tmp/wnet-t2-probe.mjs`，不是仓库文件。OCR 前置扫描已实际调用，但 minimax、qwen、glm 均 `input_config_error`，返回 `status=skipped`，不作为干净审查证据。

实际命令：

```sh
node /tmp/wnet-t2-probe.mjs 17881 fuzz
```

探针启动真实 server（`tsx cli.ts serve --port 17881 -- bash --norc --noprofile -lc cat`），通过 `ws` 连接 `ws://127.0.0.1:17881/ws`，逐例等待 snapshot 后发送帧；每例收集收到的文本帧与 close code/reason。实际 server 启停输出：

```text
[server] remobi: building client...
[server] remobi: client ready
[server] remobi: starting command bash (4 args)...
[server] remobi: serving on http://localhost:17881
...
[server] 
remobi: shutting down...
```

以下是每个 fuzz 类别的实际 JSON 输出（`received` 是实际收到的帧，`close` 是实际 close 事件；`ack`/`leaked` 是探针从实际收到帧中过滤出的结果）：

```text
{"case":"non-json","payloadBytes":8,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"array","payloadBytes":2,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"null","payloadBytes":4,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"deep-json","payloadBytes":2200,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"missing-type","payloadBytes":2,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"type-number","payloadBytes":10,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"type-unknown","payloadBytes":18,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"action-id-number","payloadBytes":59,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"action-id-object","payloadBytes":60,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"action-id-array","payloadBytes":59,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"action-id-null","payloadBytes":60,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"action-data-number","payloadBytes":55,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"action-data-object","payloadBytes":56,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"ping-id-bool","payloadBytes":25,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"id-empty","payloadBytes":23,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"id-128-bytes","payloadBytes":151,"received":["{\"type\":\"pong\",\"id\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}"],"close":null,"ack":[],"leaked":[]}
{"case":"id-129-bytes","payloadBytes":152,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"id-emoji-32-128bytes","payloadBytes":151,"received":["{\"type\":\"pong\",\"id\":\"😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀\"}"],"close":null,"ack":[],"leaked":[]}
{"case":"id-emoji-33-132bytes","payloadBytes":155,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"id-combining-64chars-128bytes","payloadBytes":215,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"id-combining-65chars-130bytes","payloadBytes":218,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"data-256k-legacy","payloadBytes":262170,"received":[],"close":{"code":1009,"reason":""},"ack":[],"leaked":[]}
{"case":"data-over-256k-action","payloadBytes":262195,"received":[],"close":{"code":1009,"reason":""},"ack":[],"leaked":[]}
{"case":"service-snapshot","payloadBytes":44,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"service-output","payloadBytes":40,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"service-input-accepted","payloadBytes":39,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"service-input-rejected","payloadBytes":62,"received":["{\"type\":\"error\",\"message\":\"invalid client message\"}"],"close":{"code":1008,"reason":"protocol violation"},"ack":[],"leaked":[]}
{"case":"replay-5-identical","received":["{\"type\":\"input-accepted\",\"id\":\"replay-1\"}","{\"type\":\"input-accepted\",\"id\":\"replay-1\"}","{\"type\":\"input-accepted\",\"id\":\"replay-1\"}","{\"type\":\"input-accepted\",\"id\":\"replay-1\"}","{\"type\":\"input-accepted\",\"id\":\"replay-1\"}","{\"type\":\"output\",\"data\":\"replay-marker\",\"seq\":1}"],"acceptedCount":5}
{"case":"ping-action-interleave-160","received":231,"pongs":80,"accepted":80,"rejected":0}
```

判读：结构畸形、字段错配、空/过长 ID、服务端消息类型均 fail-closed 为 `1008`；超过 WebSocket `maxPayload` 的两帧在应用层前由 `ws` 关闭为 `1009`，无错误正文和无 ack。128 字节 ASCII ID 与 32 个 emoji（每个 4 字节，合计 128 字节）都得到正常 `pong`；129 字节 ASCII 与 33 个 emoji（132 字节）均违规关闭。组合字符样例的 UTF-8 字节数大于字符数，均未越过字节上限。所有错误文案仅为固定的 `invalid client message`，没有终端正文或探针设置的 `secret-*` 输入回显。5 次同 ID 同 data 重放收到 5 个 accepted 但只收到一次 PTY output；160 帧交错收到 80 个 pong、80 个 accepted、0 个 rejected，连接未因合法乱序关闭。

本证据未发现违反不变式 5（拿不到可靠 ID 不伪造 rejected、畸形帧协议违规关闭）或不变式 2（同 ID 同 data 不产生第二次 PTY write）的新问题。
