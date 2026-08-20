<!-- delegate-outcome: succeeded -->
## 审查范围与本轮新证据

审查对象固定为 `ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb..ad0109bc5174257607f452eeeea620e91e17cc1f`，不随审查期间的新提交变化。本轮没有修改 `src/**` 或 `tests/**`。

本轮新证据是：

- 降层三问：从 `input-action` 收帧、调用 `pty.write`、写入去重 Map 到返回 accepted 的副作用顺序与实际调用方路径。
- 调用方审查：冻结 H0 的 `src/serve.ts`，并用真实 WebSocket 验证协议违规、mirror fail-loud 和外层 payload 边界。
- node-pty 运行时探针：真实 `node-pty@1.1.0` 的 PTY write 失败态。
- 双客户端真实 server 探针：两个 WebSocket 同时 attach、并发 action、同 id 冲突、mirror 故障广播。

## OCR 前置扫描

命令：

```sh
head -c 6000 /home/zlx/projects/oss/remobi/docs/designs/weak-network-experience.md > /tmp/wnet-t2-review1-ocr-bg.md
ocr-review --repo "$(git rev-parse --show-toplevel)" \
  --from ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb \
  --to ad0109bc5174257607f452eeeea620e91e17cc1f \
  --audience agent --concurrency 4 \
  --background-file /tmp/wnet-t2-review1-ocr-bg.md
```

实际结果摘要：`{"status":"reviewed","profile":"minimax","model":"MiniMax-M3","cli_status":"complete","coverage":"complete","verify":{"counts":{"total":10,"verified":10,"confirmed":1,"refuted":9}}}`。唯一 confirmed 是基线旧代码中的退出时二次 close 低级候选，不属于本次 diff，未列入本轮 findings；其余 9 条由复核明确判为引用了冻结对象之外的旧代码。

## 证据源 A：降层三问

命令：

```sh
git show ad0109bc5174257607f452eeeea620e91e17cc1f:src/session.ts \
  | nl -ba | sed -n '206,303p'
git show ad0109bc5174257607f452eeeea620e91e17cc1f:src/serve.ts \
  | nl -ba | sed -n '219,239p;319,412p'
```

实际输出中的关键行：

```text
206  handleClientMessage(client: SessionClient, message: ClientMessage): void {
208    case 'input':
210      this.pty.write(message.data)
223    case 'input-action':
224      this.handleInputAction(client, message.id, message.data)
253  private handleInputAction(client: SessionClient, id: string, data: string): void {
254    if (this.exited || this.mirrorFailed) {
261    const recordedData = this.inputActions.get(id)
271    try {
272      this.pty.write(data)
273    } catch {
274      this.sendInputRejected(client, id, 'pty-write-failed')
278    this.inputActions.set(id, data)
279    if (this.inputActions.size > 128) {
283    client.send({ type: 'input-accepted', id })
295  private failMirror(): void {
298    this.broadcast({ type: 'error', message: TERMINAL_MIRROR_ERROR })
300    client.close()
320  private broadcast(message: ServerMessage): void {
322    client.send(message)
```

回答：

1. `input-action` 的外部副作用顺序是：`pty.write(data)`（先发生，且 `node-pty` 会把真实 fd 写入排队）→ `inputActions.set(id, data)` / 必要时淘汰最老记录 → `client.send(input-accepted)`。成功 action 路径本身没有 mirror 写入或 close；PTY 后续 `onData` 再递增 `outputSeq`、排队 mirror.write，并 broadcast output。`pty.write` 发生在记账之前；本轮 C 证明它的真实底层写可能在调用返回后异步失败，因此会出现“账本已记、accepted 已发，但真实 PTY 未写”的假成功。legacy `input` 在 208–211 仍直接 `pty.write`，明确绕过 action Map，但这是不变式 6 要求保留的旧路径。
2. `inputActions` 是 session 级 Map，而 id 完全由客户端提供；代码没有跨 client 命名空间。两个 client 发送相同 id、不同 data 时，先到者写入并 accepted，后到者收到 `id-conflict`，不再写 PTY。D 的真实并发结果与此一致。这是显式冲突而非静默重复；随机 id 的唯一性不能由服务端证明，但不变式 2 明确规定该冲突结果。
3. Map 保护的是 `input-action` 分支内的再次 `pty.write`，不是所有 PTY 行为。legacy `input` 可以绕过 Map 继续触达 `pty.write`；这保持旧客户端行为不变，不作为本轮问题。A 分析发现的实际缺陷不是绕过 Map，而是 Map/accepted 早于 node-pty 的异步真实写完成。

## 证据源 B：调用方视角

静态命令：

```sh
git show ad0109bc5174257607f452eeeea620e91e17cc1f:src/serve.ts \
  | nl -ba | sed -n '219,239p;319,412p'
```

实际输出中的调用方关键行：

```text
219  function closeForProtocolViolation(
225    try {
226      raw.send(serialiseServerMessage({ type: 'error', message }), () => {
228        raw.close(1008, 'protocol violation')
237    client?.send({ type: 'error', message })
334  wss.options.maxPayload = MAX_CLIENT_MESSAGE_BYTES
357  const client: SessionClient = {
358    send(message) {
359      if (raw.readyState !== 1) return
363      try {
364        raw.send(serialiseServerMessage(message))
365      } catch {
367      }
379  void session.addClient(client).catch((error: unknown) => {
400  const message = parseClientMessage(event.data)
402    closeForProtocolViolation(raw, client, 'invalid client message')
411  session.handleClientMessage(client, message)
```

真实 WebSocket 命令（H0 server 以 `./node_modules/.bin/tsx cli.ts serve --port 17783 -- /bin/sh -c 'sleep 30'` 启动；分别发送缺 id 的 input-action、缺 id 的 ping、data 为 256 KiB 的 input-action）：

```sh
node --input-type=module - <<'NODE'
import WebSocket from 'ws'
// 对每个 payload 建立一个连接，记录 snapshot、error、close(code, reason)
// payloads = [{type:'input-action',data:'x'}, {type:'ping'},
//             {type:'input-action',id:'oversized',data:'x'.repeat(256*1024)}]
NODE
```

实际输出：

```text
[{"label":"invalid-input-action-no-id","opened":true,"messages":[{"type":"snapshot"},{"type":"error","message":"invalid client message"}],"close":{"code":1008,"reason":"protocol violation"}},
 {"label":"invalid-ping-no-id","opened":true,"messages":[{"type":"snapshot"},{"type":"error","message":"invalid client message"}],"close":{"code":1008,"reason":"protocol violation"}},
 {"label":"input-action-data-at-input-limit","opened":true,"messages":[{"type":"snapshot"}],"close":{"code":1009,"reason":""}}]
```

结论：拿不到可靠 id 的畸形帧没有伪造 rejected，统一协议违规关闭，符合不变式 5。新增 accepted/rejected 复用既有 `SessionClient.send`；发送竞态中 socket 已关闭或 `raw.send` 同步失败时 ack 会丢失，这是存量发送语义，但重送仍会命中 session Map。mirror fail-loud 在 session 内部先粘性标记并广播 error/关闭已有 client；`addClient` 在 await snapshot 后检查 `mirrorFailed`，发送终端错误并关闭，通常不会落入 serve 的 catch；非 mirror 的 attach 异常仍由 379–386 的 catch 发送错误并关闭。

外层 `maxPayload` 与 `MAX_CLIENT_MESSAGE_BYTES` 使用同一常量，未形成绕过；但新增 action 的 JSON envelope 使“data 恰为 256 KiB”在 WebSocket 层先以 1009 拒绝，而不是进入 parser。它是可见、fail-closed 的边界拒绝，且没有违反本轮编号不变式，记录为调用方边界观察，不单列 finding。

## 证据源 C：node-pty 真实失败语义

环境：Node `v24.14.0`，`node-pty@1.1.0`，真实 Linux PTY。探针把实际 write stream 的 fd 改为合法但不存在的 fd `999999`，使底层 `fs.write` 进入真实 `EBADF` 异步失败；随后调用 `pty.write()`，并捕获 stderr、onData、onExit、pty error，最后 kill 子进程收尾。

命令：

```sh
node --input-type=module - <<'NODE'
import { spawn } from 'node-pty'
// spawn('/bin/sh', ['-c', 'sleep 0.5'])
// pty._writeStream._fd = 999999
// pty.write('invalid-fd-write')
// 记录同步返回、console.error、pty error、onExit；退出前 pty.kill()
NODE
```

实际输出：

```text
{"event":"write-stream-fd-invalid","originalFd":20,"invalidFd":999999}
{"event":"write-after-invalid-fd","threw":false,"returned":"undefined"}
CAPTURED Unhandled pty write error Error: EBADF: bad file descriptor, write
{"event":"pty-error","error":"Error: read EIO"}
{"event":{"exitCode":0,"signal":0},"errors":["Unhandled pty write error Error: EBADF: bad file descriptor, write"]}
```

补充的真实退出态探针（`/usr/bin/true`，在 onExit 前立即写、在 onExit 后再写）输出：

```text
{"event":"write-immediate","onExitSeen":false,"threw":false,"returned":"undefined"}
{"event":"onData","data":"immediate-write"}
{"event":{"exitCode":0,"signal":0},"dataSeen":"immediate-write"}
{"event":"write-after-onExit","threw":false}
```

该运行时证据证明 `try/catch` 只能捕获同步异常；真实底层写失败不会同步抛出，而是异步打印错误。实现因此会在真实 PTY 未写入时继续写 Map 并发送 accepted，具体 finding 在下一节记录。

## 证据源 D：多客户端并发

标准 H0 server 命令：

```sh
./node_modules/.bin/tsx cli.ts serve --port 17781 -- /bin/sh -c \
  'while IFS= read -r line; do printf "RECV:%s\\n" "$line"; done'
```

两个 WebSocket client 的探针命令：

```sh
node --input-type=module - <<'NODE'
import WebSocket from 'ws'
// 同时连接 A/B；分别等待 snapshot；同时发送 alpha-id/beta-id；
// 再同时发送 same-id + conflict-A\n / same-id + conflict-B\n；
// 收集每个 client 的所有 server message，并统计 A 的 RECV: 标记。
NODE
```

实际输出：

```text
{"phase":"attach","sessionIds":["86de201b-e320-4edb-9912-60cadbb88699","86de201b-e320-4edb-9912-60cadbb88699"],"sameSessionId":true,"snapshots":[{"label":"A","outputWatermark":0,"dataBytes":0},{"label":"B","outputWatermark":0,"dataBytes":0}]}
{"phase":"different-ids","accepted":[{"type":"input-accepted","id":"alpha-id"},{"type":"input-accepted","id":"beta-id"}],"outputMessageCountOnA":2,"childMarkers":{"alpha":1,"beta":1},"outputText":"alpha-marker\\r\\nRECV:alpha-marker\\r\\nbeta-marker\\r\\nRECV:beta-marker\\r\\n"}
{"phase":"same-id-different-data","responses":{"A":{"type":"input-accepted","id":"same-id"},"B":{"type":"input-rejected","id":"same-id","reason":"id-conflict"}},"childMarkers":{"conflictA":1,"conflictB":0},"outputText":"alpha-marker\\r\\nRECV:alpha-marker\\r\\nbeta-marker\\r\\nRECV:beta-marker\\r\\nconflict-A\\r\\nRECV:conflict-A\\r\\n"}
```

镜像 fail-loud 的真实 server 命令（仍为 H0 `serve()`，仅在探针进程运行时把 `@xterm/headless` 的 `Terminal.prototype.write` 注入为抛错；PTY/server/WebSocket 均是真实实现）：

```sh
node --import tsx/esm --input-type=module -e \
  "import XtermHeadless from '@xterm/headless'; const Terminal=XtermHeadless.Terminal; Terminal.prototype.write=function(){throw new Error('probe mirror failure')}; const {serve}=await import('./src/serve.ts'); const {defaultConfig}=await import('./src/config.ts'); await serve(defaultConfig,17782,['/bin/sh','-c','sleep 20; printf trigger-output; sleep 20'])"
```

两个 client 在输出前 attach 的实际输出：

```text
{"phase":"attached-before-failure","snapshots":[{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"5d61eb32-cbbf-413c-ac72-58db67b0bf27"},{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"5d61eb32-cbbf-413c-ac72-58db67b0bf27"}]}
{"phase":"mirror-fail-loud","A":{"messages":[{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"5d61eb32-cbbf-413c-ac72-58db67b0bf27"},{"type":"output","data":"trigger-output","seq":1},{"type":"error","message":"Terminal mirror failed; restart remobi."}],"close":{"code":1005,"reason":""}},"B":{"messages":[{"type":"snapshot","data":"","outputWatermark":0,"sessionId":"5d61eb32-cbbf-413c-ac72-58db67b0bf27"},{"type":"output","data":"trigger-output","seq":1},{"type":"error","message":"Terminal mirror failed; restart remobi."}],"close":{"code":1005,"reason":""}},"bothError":true,"errorHasTerminalBody":false}
```

D 证明：两个 client 获得同一 sessionId；不同 id 各一次 PTY 子进程回显；同 id 不同 data 只写先到者且后者显式冲突；mirror 失败向两个现有连接发送不含终端正文的 error 并关闭，后续 attach 也走同一 fail-loud 错误路径。

## Findings

### P1-1：异步 node-pty 写失败仍会发送假 accepted

- 级别：P1
- 违反：不变式 1（`accepted` 只能在 `pty.write(data)` 成功后发出，且 `{id,data}` 必须先记账）；同时命中 personal/infrastructure 的静默出错红线。
- 位置：`src/session.ts:271-283`（H0 `ad0109bc`）；调用边界为 `src/pty.ts:5-8`。
- 具体触发路径：session 尚未收到 `onExit` 时，客户端发送一个新的 `input-action`。底层 PTY write fd 已关闭或进入 `EBADF` 等失败态，`this.pty.write(data)` 只把写入排队并同步返回 `undefined`，不会进入 271–275 的 catch。代码随即在 278 写入 `inputActions`，283 发送 `input-accepted`。本轮 C 的真实 `node-pty@1.1.0` 输出是同步 `threw:false`、随后异步 `Unhandled pty write error ... EBADF`；因此数据丢失但协议给出 accepted。重送同一 id 只会再次 accepted，不会修复原始丢失。
- 建议修法方向：不要用同步 `try/catch` 代表 node-pty 写成功。需要让底层写入的完成/失败结果可观察，并把 Map 记账与 accepted 放到可证明成功的完成点；失败时发送 `pty-write-failed` 且不记账。若当前 node-pty API 无法提供该证明，应收紧 accepted 的语义或改造最小的写入边界，不要继续声称同步异常分支覆盖了真实失败。

## 未计入 finding 的方向

- 同 id 同 data 重送走 `inputActions.get` 后只再发 accepted，不再写 PTY；同 id 不同 data 的 D 实测是一次 accepted + 一次 `id-conflict`，只写先到者。这符合不变式 2。id 由 client 提供且 Map 是 session 级，确实意味着跨标签页/设备没有服务端生成的命名空间；冲突是显式可见的，不是静默重复，本轮不另升 P1。
- legacy `{type:'input'}` 仍直接写 PTY，确实绕过 action Map，但这是不变式 6 的兼容路径，不能作为本次问题。
- `snapshot()` 的稳定循环在 `await pending` 后先比较 Promise 引用，再 return，return 前没有新的 await；D 的两个初始 snapshot 都是 `outputWatermark:0` 且 `data:""`，sessionId 同值，未发现不变式 3 问题。
- mirror failure 的粘性状态、无终端正文 error、关闭现有连接和拒绝后续 attach 均由 D 实测成立，未发现不变式 4 问题。
- 缺 id 的新 action/ping 在 B 实测统一返回协议 error 并以 1008 关闭，没有伪造 rejected，符合不变式 5。外层 256 KiB `maxPayload` 对带 JSON envelope 的 action 在 data 恰为 256 KiB 时返回可见 1009；这是 fail-closed 的边界观察，不是本轮编号不变式或静默错误 finding。
- `sessionId`、`outputSeq`、`pendingMirrorWrite`、`mirrorFailed`、`inputActions`、`MAX_ACTION_ID_BYTES` 等新增状态/字段都有跨方法或协议生产/消费方，分别直接服务 snapshot、mirror 或 action 不变式；没有发现单消费者转发层、无依据的通用化或额外持久化/TTL/fallback/重试。
- `SessionClient.send` 的发送竞态 `try/catch` 是存量代码。它会同样影响新 ack，但 socket 已关闭时 ack 不可达，重送会命中 Map；本轮问题的独立根因是 accepted 在异步 PTY 写真正完成前被发出，不把该存量 catch 重复计入。

## 最终 verdict

`fail`

P1 计数：`1`

本轮审查工作本身完成（executor outcome 为 `succeeded`），但冻结范围不能通过恢复可信契约，主脑应先处理 P1-1，再进行下一轮增量审查。
