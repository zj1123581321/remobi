# 修复卡：录音中直接点 Send 应停止并发送（Cancel 同理）

## 上下文

分支 `card/remobi-20260819-14`，工作目录 worktree
`/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14`。

主脑用真实浏览器探针（headless Chromium + 虚拟麦克风喂 TTS 真人声 + 真实 Doubao key）
复现了用户反馈：录音中 preview 面板已显示（流式文字 + Send/Cancel 按钮都可见），
**但点 Send 静默无效**——`src/controls/mic-controller.ts` 的 `confirmPreview` 开头
`if (currentState !== 'preview') return`，录音态直接吞掉。用户必须先点 Mic 停止录音、
等 preview 态，才能 Send。反直觉。

同理，`cancelPreview` 只在 preview/error 态生效，录音中点 Cancel 也被静默吞掉。

## 目标行为

- `recording` 态点 Send = 停止录音并发送：等同「点 Mic 停止 → final 到达进 preview →
  自动确认发送」，全流程无需用户再点。若 `waiting-final` 超时，用最新 partial 文本发送；
  完全没有识别到文字则走现有「No speech was recognized.」提示（不发送）。
- `recording` 态点 Cancel = 取消本次录音并丢弃（现有 `cancelSession` 语义）。
- `waiting-final`/`stopping` 态点 Send：等 final 到达后自动发送（与 recording 点 Send
  同一 pending 意图）；点 Cancel = 取消丢弃。
- preview 态行为不变（Send 发送 / Cancel 丢弃）。

## 实现提示（非强制）

可在 controller 里加一个 `pendingAction: 'send' | 'cancel' | undefined` 记录录音/收尾期间
的面板按钮意图，`onFinal`/`finishPreview` 进入 preview 时若 `pendingAction==='send'` 且
有文本则直接走 confirm 发送路径。注意 generation/cleanup 语义与现有代码一致，
`transition()` 仍是唯一状态写入口。

## 硬性完成条件：真实浏览器端到端验证

worktree 根目录有主脑写的探针 `send-verify.mjs`（未跟踪，勿提交）：场景 A 录音中点
Send、场景 B preview 点 Send。把它修好并扩展为断言**发送后 xterm 屏幕上出现识别文本**
（读 `.xterm-rows` 文本，注意 7691 连的是本机 tmux `main` 会话，发送前先在宿主跑
`tmux send-keys -t main -X cancel` 兜底退出 copy-mode——本次用户 Bug 之一就是窗格卡在
copy-mode 吃掉输入）。要求输出证明：录音中点 Send 后文本到达屏幕且状态回 idle。

改完代码需重启 7691 再跑探针（`ss -tlnp | grep 7691` 拿 pid 杀掉，
`nohup pnpm exec tsx cli.ts serve --port 7691 --base-path /remobi-inc2 > /tmp/remobi-serve-7691.log 2>&1 &`；
杀进程禁 pkill -f，会误杀自己的 shell）。

## 约束

- 预算 ≲200 行（含测试）。引擎 `src/asr/` 不动；不做无关重构。
- `mic-verify.mjs`、`send-verify.mjs`、`remobi.config.ts`、`remobi.config.local.ts`
  均为本地未跟踪文件，**一律不得 commit**；commit 前 `git status` 确认 staged 清单。

## 验证

```bash
pnpm test && pnpm run check && pnpm run lint:ox
node send-verify.mjs   # 必须断言文本到达 xterm 屏幕
```

## 报告要求

- 改动文件 + git diff --stat；commit sha + push 结果
- send-verify.mjs 实际输出关键行（原样）
- 单测中锁死新语义的用例清单
