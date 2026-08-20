# 修复卡：ASR preview 面板即时反馈 + error 态可重试

## 上下文

分支 `card/remobi-20260819-14`，工作目录 worktree
`/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14`。Mic 已是 tap-to-toggle
（commit 1801713 + 658a176）。

主脑用真实浏览器（Playwright headless Chromium + `--use-fake-device-for-media-stream` +
`--use-fake-ui-for-media-stream` + 真实 Doubao key）复现了用户真机反馈的两个问题，
**状态机本身全部正确**（tap→recording、tap→waiting-final→preview），问题全在面板可见性：

1. **tap 后面板不显示**：`src/controls/asr-preview.ts` 的 `createAsrPreview` 初始
   `display:none`，只有 `show()`/`setPartial()`/`showMessage()` 才会 `setVisible(true)`。
   而 `src/controls/mic-controller.ts` 的 `permission-requesting`/`connecting`/`recording`
   态**从不调用任何 show***——要等到引擎吐出第一个 partial 面板才出现。建连 1–2 秒 +
   用户没立刻说话 = 用户点了 Mic 什么反馈都没有。
2. **error 态死锁**：出错时 `showError` 弹出错误面板，但 error 态下 tap Mic 无任何效果
   （`tapToggle` 只处理 idle/recording/permission-requesting/connecting），用户不知道必须去
   点面板上的 Cancel 才能重来——「面板唤起来之后没办法开始语音输入」。

## 改动要求

1. `src/controls/mic-controller.ts`：
   - `pointerDown`→`startSession` 进入 `permission-requesting` 时立即
     `preview.showMessage('Requesting microphone…')`；进 `connecting` 时
     `preview.showMessage('Connecting to voice service…')`；进 `recording` 时
     `preview.showMessage('Listening…')`；进 `waiting-final` 时
     `preview.showMessage('Finishing…')`。partial 到达时 `setPartial` 会自然覆盖文案，无需额外处理。
   - `error` 态下 tap Mic = 清掉 error 面板并开始新会话（等价于先 Cancel 再 tap）。
     `preview` 态维持现状（必须先 Send/Cancel，保护已识别文本）。
   - 取消会话（`cancelSession`）时面板文案保留「已取消」类提示后回 idle（现状如此则不动）。
2. 测试：`tests/mic-controller.test.ts` 补断言——tap 后（引擎尚未回调）面板即
   `isVisible()===true` 且文案为 connecting/listening；error 态 tap Mic 开始新会话。
3. **真实浏览器端到端验证（本卡的硬性完成条件，响应「先在真实环境验证再交付」）**：
   worktree 根目录有主脑写好的探针 `mic-verify.mjs`（未跟踪，勿提交 git），它用
   headless Chromium + 虚拟麦克风 + 真实 key 走完整链路并打印每秒钟的
   `data-mic-state` 和面板可见性。修正其中的面板选择器为 `#wt-asr-preview`（当前用的
   class 选择器是错的，元素只有 id），然后运行，要求输出能证明：
   tap1 后 1 秒内面板可见且有连接/监听文案；tap2 后进入 preview 态且面板可见。
   运行命令：`node mic-verify.mjs`（在 worktree 根，server 跑在 7691，base-path /remobi-inc2）。
   **注意：worktree 里正在运行的 7691 serve 是你改代码前启动的旧 bundle，改完代码需要
   让主脑重启或自行 kill 后用
   `nohup pnpm exec tsx cli.ts serve --port 7691 --base-path /remobi-inc2 > /tmp/remobi-serve-7691.log 2>&1 &`
   重启（杀进程用 `ss -tlnp | grep 7691` 拿 pid，禁 pkill -f 以免误杀自己的 shell）。**

## 约束

- 预算 ≲200 行（含测试）。禁无关重构；引擎 `src/asr/` 不动。
- `mic-verify.mjs`、`remobi.config.ts`、`remobi.config.local.ts` 均为本地未跟踪文件，
  **一律不得 commit**（上一轮误提交过 remobi.config.ts）。commit 前 `git status` 确认
  staged 文件清单。

## 验证

```bash
pnpm test && pnpm run check && pnpm run lint:ox
node mic-verify.mjs   # 真实浏览器链路，输出必须体现面板即时可见
```

## 报告要求

- 改动文件 + git diff --stat；commit sha + push 结果
- `mic-verify.mjs` 实际输出（关键行原样贴出）
- 遗留风险
