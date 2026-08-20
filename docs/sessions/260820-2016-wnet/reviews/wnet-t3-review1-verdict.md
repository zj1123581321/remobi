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
