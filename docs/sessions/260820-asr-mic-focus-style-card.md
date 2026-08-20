# 修复卡：Mic tap 唤起软键盘 + 位置/样式 moshi 化

## 上下文

接续上一张卡（dispatch `dlg-20260820-024718-d2e019`，commit 1801713 已把 Mic 改为
tap-to-toggle）。工作目录同样是 worktree
`/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14`（分支
`card/remobi-20260819-14`，改动 commit + push 到同一远程分支，PR #8 随之更新）。

真机实测反馈（Android Chrome 151）：

1. **点 Mic 会把已收起的软键盘带起来**。要求：点 Mic 前后键盘状态不变——收着就保持收着，
   开着就保持开着（参考 d-pad 按键的 focus-safe 行为）。
2. **Mic 应该在工具栏右侧**（moshi 的布局：语音入口在输入区右端）。
3. **样式向 moshi 看齐**：moshi 的语音入口是圆形图标按钮，不是文字 pill。

## 已有线索（主脑读码结论，供参考不保证完整）

- `src/controls/mic-controller.ts:376-377`：`suppressSynthesisedMouse(button)` +
  `onTap(button, tapToggle)`。
- `src/util/tap.ts` 头注释记录过：touchend preventDefault 抑制合成 mousedown 后，
  「focus 停在终端 textarea 上」与「Android 重弹键盘」之间有历史纠葛（d40fa46）。
- `src/controls/keyboard-controller.ts` 有 document 级 touchend focus-steal guard
  （探针③）和 `conditionalFocus`/`isKeyboardOpen` 三信号模型。
- d-pad（`src/controls/dpad.ts`）是已验证 focus-safe 的参照实现。

请先定位键盘被带起的真实路径（合成事件焦点转移？document 级 guard？tap 后某处
`term.focus()`？），再做最小修复。修复必须能用测试锁住：新增/更新
`tests/mic-controller.test.ts` 或 keyboard 相关测试，断言 tap Mic 前后
textarea focus 状态不变。

## 改动要求

1. **键盘焦点修复**（核心）：tap Mic 不唤起、不收起软键盘；不破坏现有 11 处
   `isKeyboardOpen`/`conditionalFocus` 语义；d-pad 与其他 toolbar 按钮行为回归无变化。
2. **位置**：worktree 测试配置 `remobi.config.ts` 的 row1 改为
   `(defaults) => [...defaults, micButton]`（Mic 排最右）。
   同时更新 `docs/designs/asr-voice-input.md` 里对 Mic 工具栏位置的推荐描述为「row1 最右」。
3. **样式**：给 voice-input 按钮加专用 class（如 `wt-mic`），圆形、图标化
   （内联 SVG 麦克风图标，不引外部资源；aria-label 保留 "Tap to speak"），
   录音态红色脉动保留并适配圆形。风格参照 moshi：简洁圆形钮，与文字 pill 区分。
   注意 `styles/base.css` 现有 toolbar 按钮样式变量，保持主题变量一致。

## 约束

- 新增行数预算 ≲250 行（含测试与样式）。超限先停手报告。
- 引擎 `src/asr/` 不动；不重构无关代码；fail fast，不新增防御式 try-catch。
- 该 worktree 有运行中的 dev server（7691 端口），不要杀；改完在报告注明需重启。

## 验证

```bash
cd /home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14
pnpm test && pnpm run check && pnpm run lint:ox
pnpm exec playwright test tests/playwright/asr.spec.ts --project=chromium-android
```

## 报告要求

- 键盘问题的根因一句话（哪条路径把焦点/键盘带起来的）
- 改动文件 + git diff --stat
- 验证命令实际结论
- commit sha 与 push 结果
