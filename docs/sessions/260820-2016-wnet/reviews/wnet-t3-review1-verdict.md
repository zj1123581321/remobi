<!-- delegate-outcome: succeeded -->

## 证据源 G：真实 Chromium Android 生命周期

审查对象固定为 `513d3fb89af660c5db549ebb3456b490e0f8c4c6..db6b72e5d3801e05fa13d61c49af987e0b8b96ee`。现场核验命令：

```text
git fetch origin --quiet
git rev-parse origin/card/wnet-t3
=> db6b72e5d3801e05fa13d61c49af987e0b8b96ee
```

H0 临时 detached worktree：`/tmp/remobi-wnet-t3-h0`，实际 `HEAD=db6b72e5d3801e05fa13d61c49af987e0b8b96ee`。未修改 H0 或本卡分支中的任何被审文件。

### 基线 Playwright

命令：

```bash
cd /tmp/remobi-wnet-t3-h0
PATH="$PWD/node_modules/.bin:$PATH" \
  node_modules/.bin/playwright test tests/playwright/weak-network.spec.ts \
  --project=chromium-android --reporter=line
```

实际输出：

```text
Running 2 tests using 1 worker
[1/2] ... offline keyboard input is dropped and recovery requires a fresh synced snapshot
[2/2] ... offline and online recovery converges to the server snapshot
2 passed (8.9s)
```

第一次等价的 `pnpm exec playwright ...` 被 pnpm 的非交互依赖目录校验拒绝（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`），随后用同一 runner 的直接二进制、显式 `PATH` 完成上述测试；不是测试失败。

### 自定义真实浏览器探针

使用真实 Hono server（端口 `17682`）、Playwright `Pixel 5` 设备参数、Chromium，并用 `context.setOffline(true/false)`。探针脚本与原始输出：

```text
/tmp/remobi-wnet-t3-probe.mjs
/tmp/remobi-wnet-t3-probe-headed.log
/tmp/remobi-wnet-t3-probe.log
```

命令核心为：

```bash
PATH="$PWD/node_modules/.bin:$PATH" HOME="$probe_home" \
  PLAYWRIGHT_BROWSERS_PATH=/home/zlx/.cache/ms-playwright \
  T3_HEADFUL=1 timeout --kill-after=5s 60s xvfb-run -a \
  --server-args='-screen 0 1280x1024x24' \
  node --input-type=module < /tmp/remobi-wnet-t3-probe.mjs \
  | tee /tmp/remobi-wnet-t3-probe-headed.log
```

关键实际输出（headed 与 headless Chromium 均一致）：

```json
{
  "markerCount": 1,
  "offlineInputCount": 0,
  "beforeOffline": {"state":"synced"},
  "afterOffline": {"state":"synced"},
  "forcedClose": true,
  "reconnecting": {"state":"reconnecting","lastFailureReason":"socket-closed"},
  "duringRecovery": {"state":"reconnecting","lastFailureReason":"socket-closed"},
  "recovered": {"state":"synced","lastFailureReason":null},
  "ended": {"state":"disconnected","lastFailureReason":"socket-closed"},
  "afterEndedWait": {"state":"disconnected","lastFailureReason":"socket-closed"},
  "socketCountAtEnded": 3,
  "socketCountAfterWait": 3
}
```

`socketRecords` 中可观察到：synced 连接实际发送了两次 `ping` 并收到两次 `pong`；恢复连接先收到 `snapshot`（`outputWatermark:4`），再收 output；离线期间键入的唯一字符串在终端计数为 `0`，服务端 marker 在终端计数为 `1`。会话结束消息为 `exit`，3 秒观察窗内没有第 4 个 socket。

截图路径：

```text
/tmp/remobi-wnet-t3-initial-synced.png
/tmp/remobi-wnet-t3-background.png
/tmp/remobi-wnet-t3-foreground-fresh.png
/tmp/remobi-wnet-t3-offline-reconnecting.png
/tmp/remobi-wnet-t3-recovery-immediate.png
/tmp/remobi-wnet-t3-recovered.png
/tmp/remobi-wnet-t3-session-ended.png
```

### 冻结生命周期交叉证据

命令与原始输出：

```text
/tmp/remobi-wnet-t3-frozen.mjs
/tmp/remobi-wnet-t3-frozen.log
/tmp/remobi-wnet-t3-frozen-output.mjs
/tmp/remobi-wnet-t3-frozen-output.log
```

Chromium 接受 `Page.setWebLifecycleState({state:"frozen"})`，冻结 2500ms 后实际输出为：

```json
{
  "freezeResult":"accepted",
  "activeResult":"accepted",
  "before":{"visibility":"visible","state":{"state":"synced"},"windowSocketState":1,"probedSockets":2},
  "after":{"visibility":"visible","state":{"state":"synced"},"windowSocketState":1,"probedSockets":2,"events":[{"type":"pageshow"}]}
}
```

第二次用两个真实页面交叉验证：第一页面冻结 1200ms，第二页面向同一 PTY 发送 `T3_FROZEN_OUTPUT_1787240978652`。thaw 后第一页面实际输出：

```json
{
  "before":{"state":{"state":"synced"},"socketState":1,"recordCount":2},
  "after":{"state":{"state":"synced"},"socketState":1,"recordCount":2,"markerInTerminal":true}
}
```

这证明冻结期间没有 `visibilitychange/pagehide`，旧 socket 没有关、没有新 epoch；恢复后旧 socket 仍为 `OPEN`，并直接把冻结期间产生的 output 带回旧画面。该观察对应后续 finding F-1。

真实页面抢焦点也已尝试：`other.bringToFront()` 在本机 Chromium 自动化窗口中仍报告原页 `visibilityState=visible`；随后 CDP `state:"hidden"` 返回 `Unidentified lifecycle state`，因此没有把这次失败尝试冒充 hidden 证据。`frozen` 是本轮采用的实际 Chromium 生命周期证据。

WebKit project 未运行：本机缺少任务卡已知的 `libgtk-4-1` 等系统库；没有尝试安装系统包。

### 严格 offline、保留 OPEN socket 的交叉验证

前面的 forced-close 用例不能证明浏览器在 socket 仍 OPEN 时不会缓冲键盘，因此又运行了不主动 close 的探针：

```text
/tmp/remobi-wnet-t3-offline-open.mjs
/tmp/remobi-wnet-t3-offline-open.log
```

命令：

```bash
PATH="$PWD/node_modules/.bin:$PATH" HOME="$probe_home" \
  PLAYWRIGHT_BROWSERS_PATH=/home/zlx/.cache/ms-playwright \
  node --input-type=module < /tmp/remobi-wnet-t3-offline-open.mjs \
  | tee /tmp/remobi-wnet-t3-offline-open.log
```

实际输出要点：

```json
{
  "beforeInput": {"state":{"state":"synced"},"socketState":1,"bufferedAmount":0},
  "whileOffline": {"state":{"state":"synced"},"socketState":1},
  "afterRestore": {"state":{"state":"synced"},"socketState":1,"inputCount":2}
}
```

探针记录的真实发送帧包含 `input`：第一个字符发送时 `bufferedAmountBefore=0`，后续字符为 `27,54,81,...`；恢复后终端实际出现完整输入和 `bash: ... command not found`。这是浏览器 WebSocket 缓冲帧被恢复后执行，不是页面 DOM 的本地回显。

## 证据源 H：从用户可观察画面反推

H 不是从实现推测，而是来自以下真实浏览器命令的 DOM 输出与截图：

```text
PATH="$PWD/node_modules/.bin:$PATH" HOME="$probe_home" \
  PLAYWRIGHT_BROWSERS_PATH=/home/zlx/.cache/ms-playwright \
  node --input-type=module < /tmp/remobi-wnet-t3-probe.mjs \
  | tee /tmp/remobi-wnet-t3-probe-headed.log

PATH="$PWD/node_modules/.bin:$PATH" HOME="$probe_home" \
  PLAYWRIGHT_BROWSERS_PATH=/home/zlx/.cache/ms-playwright \
  node --input-type=module < /tmp/remobi-wnet-t3-syncing-ui.mjs \
  | tee /tmp/remobi-wnet-t3-syncing-ui.log
```

### 用户实际看到的状态

- `reconnecting`：`/tmp/remobi-wnet-t3-probe-headed.log` 的 `offline-reconnecting-before-input` 断言为 `state.state="reconnecting"`；`body.innerText` 实际含 `Reconnecting…\nRetry now`，`#remobi-reconnect-overlay` 是 `display:flex`、fixed、`393×727`，覆盖 `#terminal` 的 `393×671`。此时用户知道不能输入，但看不到终端内容；终端 DOM 仍保留旧 marker，说明遮罩挡住的是旧画面而不是清除它。对应截图：`/tmp/remobi-wnet-t3-offline-reconnecting.png`。
- `syncing`：`/tmp/remobi-wnet-t3-syncing-ui.log` 的实际输出为 `state.state="syncing"`，body 含 `Syncing…\nRetry now`，overlay 为 `display:flex`、`393×727`；用真实浏览器探针把 snapshot 交付延迟 1500ms，仅延迟网络事件交付，没有手工 dispatch visibility 事件。对应截图：`/tmp/remobi-wnet-t3-syncing.png`。
- `synced`：`initial-synced` 与恢复后的 `recovered` DOM 均为 `state.state="synced"`；snapshot 后 `#remobi-reconnect-overlay` 的 `display="none"`、rect 为 `0×0`，body 不含可见 `Synced` 文案。恢复前的 overlay 是全屏的，snapshot 后撤掉遮罩，终端 marker 计数为 1。对应截图：`/tmp/remobi-wnet-t3-initial-synced.png`、`/tmp/remobi-wnet-t3-recovered.png`。
- `disconnected`：socket close 的实际下一次可绘制 DOM 是 `Reconnecting…`，不是 `Disconnected`；`offline-reconnecting-before-input` 的状态为 `reconnecting`，没有 `Disconnected` 文案截图。因断开后立即进入退避重连，用户正常看不到 disconnected 这一瞬态；这是 F-3 的可观察性问题，不是把内部状态误报给用户。
- 会话结束：`session-ended-observed` 的 body 实际含 `Session ended — restart remobi to start a new one.\nRetry now`，overlay fixed 为 `393×727`；可见操作只有 `Retry now`，`Re-authenticate` 不在 body 的可见文本中。随后 3 秒 body 仍为同一会话结束提示，socket 数 `3 → 3`，没有自动重连。这一方向没有发现错误动作指向。对应截图：`/tmp/remobi-wnet-t3-session-ended.png`。

### 提示生命周期与新鲜度

- `Not sent — still syncing.`：`recovery-immediate` DOM 实际含该文本且 overlay 全屏；`recovered` DOM 的 body tail 不再含该文本，说明 snapshot 成功后提示被清掉，没有发现永久悬挂误导。对应截图：`/tmp/remobi-wnet-t3-recovery-immediate.png`、`/tmp/remobi-wnet-t3-recovered.png`。
- 真实断网恢复：`context.setOffline(true)` 后页面实际仍暂时报告 `synced`，这是 Chromium 在已有 WebSocket 上的 2 秒观测；探针随后关闭该实际 socket 以完成服务端断线路径，并明确记录 `forcedClose=true`，不是把“离线开关”伪装成 close。恢复时先看到 `reconnecting` 与 `Not sent`，snapshot 后 marker 计数为 `1`、离线键入字符串计数为 `0`，socket output watermark 先于 output 被记录。没有发现重复字符或断线键重放。
- 连接恢复后的可观察信号只有“全屏 overlay 消失 + 终端画面回到前台”，没有可见的 `Synced` 标识；因此用户能观察到“遮罩撤掉”，但不能从 UI 单独证明这是当前 epoch 的完整 snapshot，而不是旧画面仍在。该缺口列为 F-3（P2），与 G 的冻结 P1 分开计数。

### 熵增逐项核验

- `ConnectionStatus` 不是无消费者抽象：`term` bridge、`reconnect.ts` UI 和 composer/发送门槛分别消费它；它是当前连接唯一事实源，保留合理。
- `remobi-connection-notice` 是 client-entry 到 reconnect UI 的单向可见通知通道，承载 `Not sent`、协议/认证提示、输出溢出和 session ended 等非四态文案；没有第二份连接状态，未单列 finding。
- `reconnect.ts` 的 `notice` 只保存 UI 的优先级文案，`synced` 时清除；H 的 `Not sent` 实测确实消失，不是长期镜像状态，未单列 finding。
- `exitReceived` 是当前 epoch 收到 `exit` 后禁止自动重连所必需的生命周期闩；H 的 socket 数不增长实测锁住了它的语义，未发现无第二消费者的重复状态。

## Findings

### F-1 — P1：浏览器冻结后旧 epoch 仍被当作 synced

- 违反：不变式 3（后台/冻结立即作废 `synced`、关闭 socket、恢复时新建 epoch）；后果命中 personal + infra 状态机的 P1 红线“静默出错/画面新鲜度失真”。
- 位置：`src/client-entry.ts:633-660`（生命周期监听只覆盖 `visibilitychange`、`pagehide`、`pageshow`、`online`），相关旧连接处理在 `src/client-entry.ts:570-615`。
- 触发路径：真实 Chromium CDP `Page.setWebLifecycleState({state:"frozen"})` 接受冻结 2500ms，期间没有 `visibilitychange/pagehide`；恢复 active 后 DOM 仍是 `state="synced"`，`window.__remobiSockets[0].readyState===1`，探针 socket 数不变。第二页面在冻结期间向同一 PTY 写入 `T3_FROZEN_OUTPUT_1787240978652`，thaw 后第一页面在没有新 snapshot、新 socket 的情况下 `markerInTerminal=true`。
- 为什么是 P1：用户返回时看到旧 epoch 直接带回的输出，却没有 fresh snapshot 证明；画面新鲜度被静默误报，可能把旧画面当最新。
- 修复方向：把浏览器实际冻结/恢复边界纳入生命周期失效契约；恢复后无条件走 `suspend → 新 epoch → 完整 snapshot`，不得依赖恰好先收到 `visibilitychange`。修复应继续保持单一 socket/epoch 事实源，不引入第二连接管理器。

### F-2 — P1：offline 时 OPEN socket 让普通键盘进入浏览器发送队列并在恢复后执行

- 违反：不变式 5（非 synced 期间普通输入必须丢弃、不排队、不重放）；后果直接命中 personal + infra 状态机的 P1 红线“静默出错”，因为按键会真实执行命令。
- 位置：`src/client-entry.ts:249-266`（`send()` 只以 `connectionStatus.state==='synced'` 与 `readyState===OPEN` 放行），输入入口为 `src/client-entry.ts:626-629`；当前实现没有在浏览器 `offline` 仍保持 WebSocket OPEN 时使状态失效。
- 触发路径：真实 Chromium `context.setOffline(true)` 2500ms 后，DOM/bridge 仍报告 `synced`、socket `OPEN`。用户用 Playwright 键盘输入 `T3_OFFLINE_OPEN_INPUT_1787241271599`；实际 WebSocket `input` 帧逐字符发送，`bufferedAmount` 递增。恢复网络 5 秒后，终端实际执行该输入并显示 `bash: T3_OFFLINE_OPEN_INPUT_1787241271599: command not found`，探针 `inputCount=2`（终端文本含命令回显与错误路径），不是单纯的本地回显。
- 修复方向：在 transport 已不可达或浏览器 offline 的第一可观察信号上立即失效 `synced` 并关闭/替换该 socket，使普通 input 进入现有丢弃路径；同时保留 resize 的最后值。不能把 WebSocket `send()` 成功返回或 `readyState===OPEN` 当成可达性证明，也不能为普通输入增加队列清空/重放机制。

### F-3 — P2：synced 与 disconnected 没有用户可见的独立文案

- 违反：设计 §1 的恢复可信用户契约（设计文档第 74、80、211、243-249 行要求用户能区分过期/同步中/已同步）；不直接命中 personal P1 红线，故降为 P2。
- 位置：`src/reconnect.ts:112-121`。
- 触发路径与实际观察：真实 `initial-synced`/`recovered` DOM 中 `#remobi-reconnect-overlay` 为 `display:none`、rect `0×0`，body 没有可见 `Synced`；恢复时用户只能看到遮罩消失。真实 socket close 后下一次可绘制 DOM 已经是 `Reconnecting…`，没有 `Disconnected` 画面，因为该状态在退避安排中被立即覆盖。`syncing` 和 `reconnecting` 则分别在 `/tmp/remobi-wnet-t3-syncing-ui.log` 与 headed probe 中显示全屏文案。
- 修复方向：提供非阻塞、明确的当前 snapshot/freshness 指示；若保留全屏遮罩，也应使用户能在遮罩撤掉后确认“当前 epoch snapshot 已应用”，并决定 disconnected 是否需要保留可见的短暂状态。不要通过增加第二份连接状态解决 UI 问题。

## 本轮没有发现问题的方向

- 正常断线路径（socket 被实际关闭）中，非 synced 键盘输入没有出现在恢复终端；marker 恢复计数为 1，snapshot watermark 在 output 之前，未观察到重复字符。注意这不能抵消 F-2 的 OPEN-socket offline 反例。
- `synced` 在正常 WebSocket 恢复中确实由 snapshot 后出现；基线与恢复连接的真实消息顺序包含 `snapshot`，不是仅凭 OPEN 判定。F-1 仅针对浏览器冻结未发生命周期事件的路径。
- 心跳在途约束未见异常：真实记录为一个 ping 后匹配 pong，约 10 秒后下一次 ping；没有并发 ping。
- `exit` 后用户看到正确的会话结束动作，`Re-authenticate` 被隐藏，且 3 秒内 socket 数不增长；不重复报告已知的跨模块 session-ended 字符串耦合。
- `Not sent — still syncing.` 在 snapshot 应用成功后消失；没有发现提示永久悬挂。
- 没有新增 `ConnectionManager`、配置项或第二份连接状态；`ConnectionStatus`、notice 事件、`notice` 和 `exitReceived` 均有实际消费者/生命周期职责，未把必要的桥接状态误报为熵增 finding。

## 前置扫描与环境记录

- OCR 前置命令已实际执行：`ocr-review --repo /home/zlx/projects/oss/remobi-worktrees/wnet-t3-review1 --from 513d3fb89af660c5db549ebb3456b490e0f8c4c6 --to db6b72e5d3801e05fa13d61c49af987e0b8b96ee --audience agent --concurrency 4 --background-file /tmp/remobi-wnet-t3-ocr-bg.md`；背景摘要实际为 6000 bytes。主腿约 3 分钟无 envelope，按有界等待中止，包装器只输出本地 verify funnel 的 `KeyboardInterrupt`，不得表述为 reviewed/clean，也未把它作为 finding。
- WebKit 未运行：本机缺系统库，按任务卡不安装。

## 最终 verdict

`fail`。P1 计数：`2`（F-1、F-2）；P2 计数：`1`（F-3）。
