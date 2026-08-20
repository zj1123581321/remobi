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

## 证据源 F：资源账本运行时探测

实际命令：

```sh
node --expose-gc --import /home/zlx/projects/oss/remobi-worktrees/wnet-t2-review2/node_modules/tsx/dist/loader.mjs /tmp/wnet-t2-resource.mjs 17884
```

探针仍在 H0 detached worktree 上执行，端口为 `17884`，运行结束显式停止 server、dispose 所有 direct session，并以 `process.exit(0)` 结束探针。实际 server 启停输出：

```text
[server] remobi: building client...
[server] remobi: client ready
[server] remobi: starting command bash (4 args)...
[server] remobi: serving on http://localhost:17884
[server]
remobi: shutting down...
```

实际 stdout（探针对 snapshot 只保留 `dataBytes`，不回显终端正文）：

```text
{"parsePtyWriteFailedReason":null}
{"serverDedup":{"sentUnique":130,"acceptedBeforeResend":130,"mapExpected":128,"oldestOutputBeforeResend":1,"oldestOutputAfterResend":3,"acceptedOldestTotal":2,"outputFrames":140,"seqMin":1,"seqMax":140,"seqStrictlyMonotonic":true},"actionSamples":["{\"type\":\"input-accepted\",\"id\":\"oldest\"}","{\"type\":\"input-accepted\",\"id\":\"id-1\"}","{\"type\":\"input-accepted\",\"id\":\"id-129\"}","{\"type\":\"input-accepted\",\"id\":\"oldest\"}"]}
{"serverHighFrequency":{"outputFrames":430,"seqMin":1,"seqMax":430,"seqCount":430,"seqStrictlyMonotonic":true,"seqContiguous":true,"lastFive":[426,427,428,429,430]}}
{"protocolPtyWriteFailedReason":{"received":[{"type":"snapshot","dataBytes":16494}],"closeCode":1008}}
{"directDedupMap":{"sentUnique":130,"beforeResend":{"size":128,"first":"id-2","last":"id-129"},"afterResend":{"size":128,"first":"id-3","last":"oldest"},"exactCapacity":true,"oldestWasEvicted":true,"oldestResendRewrotePty":2},"ackCount":131}
{"lifecycle":{"beforeFds":29,"records":[{"iteration":1,"pid":1978677,"fdsDuring":30,"fdsAfterDispose":29,"pidAliveAfterDispose":false,"descendantsAfterDispose":[]},{"iteration":2,"pid":1978680,"fdsDuring":30,"fdsAfterDispose":29,"pidAliveAfterDispose":false,"descendantsAfterDispose":[]},{"iteration":3,"pid":1978690,"fdsDuring":30,"fdsAfterDispose":29,"pidAliveAfterDispose":false,"descendantsAfterDispose":[]},{"iteration":4,"pid":1978695,"fdsDuring":30,"fdsAfterDispose":29,"pidAliveAfterDispose":false,"descendantsAfterDispose":[]},{"iteration":5,"pid":1978716,"fdsDuring":30,"fdsAfterDispose":29,"pidAliveAfterDispose":false,"descendantsAfterDispose":[]},{"iteration":6,"pid":1978719,"fdsDuring":30,"fdsAfterDispose":29,"pidAliveAfterDispose":false,"descendantsAfterDispose":[]}],"finalFds":29,"fdDeltas":[0,0,0,0,0,0]}}
{"outputSeq":{"elapsedMs":2385,"finalSeq":117312,"pendingMirrorWriteIsPromise":true,"cpuUserUs":711531,"cpuSystemUs":270290}}
{"syncPtyWriteFailure":{"terminalFailed":true,"inputActionsSize":0,"requestingClientMessages":[{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"fbb53397-9203-4a0a-8412-b4e3ab16e386"},{"type":"input-rejected","id":"sync-fail","reason":"session-unavailable"},{"type":"error","message":"Terminal failed; restart remobi."}],"otherClientMessages":[{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"fbb53397-9203-4a0a-8412-b4e3ab16e386"},{"type":"error","message":"Terminal failed; restart remobi."}],"requestingClientCloseCount":1,"otherClientCloseCount":1,"hasPtyWriteFailedReason":false,"errorMessages":["Terminal failed; restart remobi."]}}
{"mirrorFailure":{"terminalFailed":true,"messages":[{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"59aa6f6d-83b5-4335-a737-b9d8722860b2"},{"type":"output","data":"mirror-marker","seq":1},{"type":"error","message":"Terminal failed; restart remobi."}],"closeCount":1,"errorMessages":["Terminal failed; restart remobi."]}}
{"terminalFailedLongRun":{"elapsedMs":6418,"seqAtFail":904,"seqAfterExit":561756,"seqGrowthAfterFailure":560852,"pendingMirrorWriteIsPromise":true,"memoryBefore":{"rss":269815808,"heapUsed":67405544,"external":11431335},"memoryAtFail":{"rss":270077952,"heapUsed":67162888,"external":10495666},"memoryAfter":{"rss":294457344,"heapUsed":65051400,"external":10882074},"heapDeltaAfterFailure":-2111488,"rssDeltaAfterFailure":24379392,"cpuUserUs":2082942,"cpuSystemUs":914161}}
```

补充的 H0 静态核对命令及实际输出（只用于确认运行时两条注入共用唯一 fail-loud 函数，不替代上面的运行时证据）：

```sh
git show 24a12d3714818bc721763c9b981c196ef0758698:src/session.ts | rg -n 'failTerminal|pty-write-failed'
git show 24a12d3714818bc721763c9b981c196ef0758698:src/session-protocol.ts | rg -n 'InputRejectedReason|pty-write-failed|session-unavailable'
```

```text
128:                    this.failTerminal()
275:            this.failTerminal()
296:    private failTerminal(): void {
72:export type InputRejectedReason = 'id-conflict' | 'session-unavailable'
77:    readonly reason: InputRejectedReason
212:                    (parsed.reason === 'id-conflict' || parsed.reason === 'session-unavailable')
```

运行时判读：

- 真实 server 收到 130 个不同 action（`N=130`），旧 ID 在重送前后相关 output 从 1 增至 3，且旧 ID accepted 总数为 2；direct session 直接读取 `inputActions`，重送前后均为 `size:128`，键首从 `id-2` 到 `id-3`，旧 ID 重送后成为末尾，`oldestResendRewrotePty:2`。这同时确认第 129 个新 ID 淘汰最旧账目，淘汰后重送确实再写 PTY。
- 真实 server 的 430 个高频 output frame 的 seq 为 1..430，`seqStrictlyMonotonic:true`、`seqContiguous:true`；另一次 direct PTY 5 MiB 长输出得到 `finalSeq:117312`。没有观察到跳号。
- `terminalFailedLongRun` 中，注入失败后 `outputSeq` 从 904 增至 561756（增长 560852），说明当前 H0 的 `pty.onData` 监听在粘性失败后仍被调用；但同一长跑的强制垃圾回收后 heap 从 67162888 降至 65051400（`heapDeltaAfterFailure:-2111488`），`pendingMirrorWrite` 仍是单个 Promise，未见 pending 链导致的堆增长。该 20 MiB 输出窗口 CPU 为 user 2.082942s + system 0.914161s，RSS 增加 24379392 字节；这证明失败后仍有可测的 CPU/seq 开销，未证明有无界堆泄漏，留到最终分诊。
- 6 次真实 session 的 attach/detach + `dispose()`：fd 基线 29，每次运行中 30，dispose 后均回到 29；6 个 PTY PID 均不存在，后代进程均为空，最终 fd 仍为 29。
- 同步 `pty.write` 注入将请求方收到 `input-rejected/session-unavailable` 后固定错误 `Terminal failed; restart remobi.`，其他 client 也收到同一固定错误并关闭；`inputActionsSize:0`，没有 `pty-write-failed`。mirror 注入得到相同固定错误和同一 sticky `terminalFailed`。`parsePtyWriteFailedReason:null` 且真实 WebSocket 发送该 reason 关闭 `1008`，协议层已不接受该 reason。

本证据确认不变式 1（accepted 前写入并记账）、2（有界 FIFO 去重）、4（PTY/mirror fail-loud，错误不含终端正文）、7（每 session 一个 sessionId）在上述运行时路径成立；后续只需对失败后仍运行的 onData 开销做最终级别分诊。
