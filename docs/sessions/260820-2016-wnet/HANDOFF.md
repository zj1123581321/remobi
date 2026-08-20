# 新 session 执行 Prompt

这是给新 Codex session 的执行 Prompt。请直接按下面的边界开始实现，不要重新做产品发散或低影响选择题。

## 2026-08-20 20:16 · Codex

- 分支/提交：`main@ba25ddf`。当前设计文档与本交接文件均未跟踪；不要覆盖或回退它们。
- 本次目标：为个人自部署的 remobi/Herdr 手机端闭合弱网可信链路。真实用户只有我一人，使用 Android 和 iOS，经 Cloudflare Tunnel + Access 访问；我通常布置任务后几十分钟才回来查看，并用语音输入大段长指令。核心目标只有提升弱网体验，禁止为并发、多租户、跨设备或未来需求过度设计。
- 已完成：方案见绝对路径 `/home/zlx/projects/oss/remobi/docs/designs/weak-network-experience.md`，相对路径 `docs/designs/weak-network-experience.md`。CEO review 与 Eng review 均已 CLEAR，无未决产品决策；低影响工程选择按第一性原理和最佳实践自行决定，不要重复提问。
- 进行中：尚未修改应用代码；下一 session 负责按 T0→T4 顺序实现，并在每个独立增量完成测试与小步提交。
- 下一步：先执行“第一批动作”，再按实现顺序落地。每个增量默认新增 ≤200 行；超限先停下来重新审视设计，不要自行扩卡。
- 坑与结论：三个用户可感知不变式必须始终成立：
  1. 返回页面后，用户能证明当前画面是新鲜的，而不是误把旧画面当最新。
  2. 长语音草稿不会静默丢失。
  3. 整条指令有诚实的 `accepted`/`unknown`/`rejected` 状态，且不会重复写入 PTY；`accepted` 只代表 remobi 成功调用 PTY `write(data)`，不代表 Herdr 已执行。

  已锁定的协议与状态机契约如下，不要用更大的抽象替换它们：

  - `client-entry` 是连接状态唯一事实源。`hidden/pagehide` 立即使旧画面过期、停止计时器并关闭 socket；`visible/pageshow` 无条件创建 fresh socket、获取完整 snapshot，即使旧 socket 仍显示 OPEN。每次连接递增 epoch，旧 socket 的事件全部隔离。socket open 后进入 `syncing`；当前 epoch 收到完整 snapshot 前不准输入。snapshot deadline 为 10 秒。
  - `synced` 只由当前 epoch 的 snapshot 产生；`XTerminal.isConnected()` 与 `onConnectionChange()` 的布尔语义收紧为 synced。`reconnect.ts` 只渲染状态，不维护第二份连接真相。`online` 仅是重试提示。
  - heartbeat 使用带 ID 的 `{type:"ping",id}`/`{type:"pong",id}`；同一时间一个 ping。进入 synced 后发送，pong deadline 15 秒；匹配 pong 后等待 10 秒再发下一次。错误或迟到 pong 不续命。重连退避为 1/2/4/8/15 秒，只在 snapshot 应用成功后清零；不设总次数上限。
  - 服务端每个 `SharedTerminalSession` 生成 `sessionId`；PTY output 带 session 内单调 `seq`；snapshot 带 `sessionId` 与 `outputWatermark`。客户端丢弃缓存中 `seq <= outputWatermark` 的 output，只应用更大的 seq。snapshot 前 output prebuffer 按 UTF-8 字节最多 1 MiB，溢出就关闭、可见提示并退避重连。mirror 异常必须 fail-loud：粘性 session error、关闭当前连接，后续 attach 拒绝，禁止静默 `.catch(() => {})`。
  - 非 synced 期间普通 input 不排队、不重放；resize 只合并保留最后一个值，恢复后发送一次。显式语音提交使用独立 `{type:"input-action",id,data}`，响应为 `input-accepted` 或 `input-rejected`；固定 reason 为 `id-conflict`、`pty-write-failed`、`session-unavailable`。旧 `{type:"input",data}` 继续兼容普通逐键输入。
  - 服务端使用容量 128 的 FIFO Map 做 action 去重。同 ID 同 data 只再次 accepted、不重复 `pty.write`；同 ID 不同 data rejected。顺序固定为 `pty.write` 成功 → 写入 Map → 发送 accepted；同步 write 异常只发 `pty-write-failed`，不写 Map。
  - localStorage key 固定为 `remobi:composer:v1:${basePath}`，schema 为 `{version:1,draft,pending}`；`pending` 为 null 或 `{id,sessionId,sourceText,data,status,reason?}`，status 为 `pending|unknown|rejected`。先持久化完整 pending，再发送。`autoEnter` 的 `\r` 必须与正文放在同一个 action data 中。before hook 只首次点击执行一次，并在 await 后重查 generation/synced；after hook 只在首次浏览器发送执行一次，自动重送不再执行 hook。accepted 无条件清 pending，但只有 draft 仍等于 sourceText 才清 draft；存储损坏或写失败必须可见提示并保留 textarea 内容。
  - pending action 的 sessionId 与新 snapshot 不同则变 unknown，禁止自动重送；同 session 新 epoch 最多自动重送一次。发送后 15 秒无响应为 unknown；rejected 保留 reason、停止自动重送。不要声称跨进程 exactly-once。

- 已否决方案：不引入 Web Push/浏览器通知、Mosh 集成或替换、IndexedDB outbox、数据库、generic outbox/message bus、跨进程 exactly-once、普通逐键离线终端输入、多设备同步、多标签页协同或通用 `ConnectionManager`。
- 验证方式：默认 TDD，必须运行并如实报告 `pnpm test`、`pnpm run test:pw`、`pnpm run check`、`pnpm run build:dist`；还要从 Cloudflare Tunnel + Access 真实生产入口在 Android 与 iOS 各验一次切网、锁屏恢复、长草稿和提交状态。跨协议/跨进程边界必须断言 producer 实际发出的 payload（含真实 WebSocket 帧、PTY 写入数据和序列化字段），不能只测同进程函数返回值。当前这些验证均未执行。
- 现场残留：`acceptance-log.jsonl` 与 `GOALS.md` 定向状态为空；worktree-doctor 检查到 1 个 worktree、0 项待处理。无应用代码改动、无测试执行。创建本文件后，预期未跟踪项为本设计文档与本 session 目录。

## 执行边界与顺序

按设计文档的真实文件范围串行实现，不要并行 worktree：

1. T0：在真实 Android/iOS Cloudflare Access 生产入口录弱网基线，记录 lifecycle、WebSocket close/error、画面新鲜度、草稿和提交可判定性。
2. T1：草稿持久化，改 `src/controls/mic-controller.ts`、`src/controls/asr-preview.ts`、`tests/mic-controller.test.ts`。
3. T2：服务端协议与 session，改 `src/session-protocol.ts`、`src/session.ts` 及对应 protocol/session 测试。
4. T3：客户端 fresh reconnect，改 `src/client-entry.ts`、`src/reconnect.ts`、`src/types.ts` 及 reconnect/client 集成测试。
5. T4：composer 原子 action 集成，按需联动上述 client/types/mic-controller/asr-preview，补单测、协议/集成测试和弱网 Playwright e2e。

第一批动作必须是：

1. 先使用 `pickup` skill，读取当前协作现场。
2. 任何写入前按 `AGENTS.md` 完成 fetch、open PR、merged PR、`origin/main` 最近提交检查。
3. 在主仓外用 `/home/zlx/projects/personal/agent-config/scripts/git/worktree-bootstrap.sh` 创建独立 worktree；不要直接在 shared `main` 写代码。
4. 设计文档和本交接文件当前都是未跟踪文件，新 worktree 不会自动包含它们。创建 worktree 后，先从主仓绝对路径读取，再用 `apply_patch` 在 worktree 中有意保留/落盘；不得误删。
5. 所有实质代码、测试、配置写入交给 `implementer`；仓库级或批量只读探索交给 `explorer`。进入 review 循环前必须读取 `review-discipline` skill。
6. 每个增量自带测试并小步 commit；新增抽象必须有第二个消费者或已发生的失败作为依据。可以自主建 draft PR、push、标 ready、处理 CI/review；无权自动合并 `main`、删除远端分支或对外发布，以上动作必须先获用户授权。

执行完成时，逐项回报修改文件、实现、实际运行的验证命令与结果、残余风险和未解决问题；没有运行的命令不得声称通过。
