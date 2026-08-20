# 任务卡：ASR 增量 4 — 作曲器改为底栏，不再遮挡终端

## 目标

真机反馈：二层语音把 Herdr 正文整屏罩黑，看不见 Agent 上下文。改成 Moshi 那种**贴底胶囊**：终端仍可读、可滚动；默认仍然不弹系统键盘。

用户可感知结果：点气泡后，上面的 herdr 输出还在，作曲器只占底部一薄层；关作曲器回工具栏。

## 非目标

- 不自动 focus 输入框、不默认唤起系统键盘（这是当前做对的，锁死）。
- 不改 ASR 引擎、状态机、sanitize、中断提示语义。
- 不做 Moshi 的 `+` / undo；不把 Send 改成箭头除非现有文案 Send 放不下。
- 不改 combo-picker / drawer 的遮罩。
- 不改 CHANGELOG。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：350
- **Diff-Lines-Hard**：600
- **阶段**：implementing
- **锁定决策**：
  1. 作曲器不是 modal。去掉全屏 `inset:0` + `rgba(0,0,0,0.58)` 遮罩。根节点只包底栏面板，贴 `bottom:0`。
  2. 关掉「点遮罩关闭」。关闭只走 ×。`registerCancel` 不再 `onTap(element)`。
  3. 去掉标题「Voice composer」。× 放进底行动作行：`[×] [mic] [Send]`，输入框在上一行。空状态文案用 `:empty { display:none }`，有错误/中断文案才占高。
  4. 打开仍禁止 `input.focus()`。
  5. 作曲器打开时隐藏 `#wt-toolbar`（`body.wt-composer-open`）。高度管理把底栏高度从 toolbar 换成 composer 的 `offsetHeight`，让 xterm 底边贴着作曲器顶边，Agent 最后几行露在作曲器上面，而不是垫在底下。键盘打开时底栏高度仍为 0（沿用现规则）。
  6. `aria-modal` 改为 `false`（不再是对话框挡全屏）。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：f89d3f09bf36b2e150f65e7fee72b8db2b5200e2（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：kimi（delegate --class frontend，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead

## 修改边界

- **允许**：
  - `src/controls/asr-preview.ts`
  - `styles/base.css`
  - `src/viewport/height.ts`（抽出纯函数 `bottomChromeHeight`，`initHeightManager` 消费它；打开/关闭时要能触发一次重算）
  - `src/index.ts`（仅当要把 composer 打开态接到高度管理）
  - `tests/asr-preview.test.ts`、`tests/height.test.ts`、`tests/mic-controller.test.ts`、`tests/playwright/asr.spec.ts`
- **禁止**：`src/asr/`、`src/serve.ts`、`.github/`、`CHANGELOG.md`、`package.json`
- **Scope-Globs**：src/controls/asr-preview.ts styles/base.css src/viewport/height.ts src/index.ts tests/asr-preview.test.ts tests/height.test.ts tests/mic-controller.test.ts tests/playwright/asr.spec.ts
- **高风险区域**：
  - 高度公式：键盘开 = 底栏 0；作曲器开 = composer.offsetHeight；否则 toolbar。测错会把终端压没或垫到作曲器下面。
  - mic-controller 现有「点 element 当 backdrop 关闭」测试必须改成点 ×，不能删关闭语义。
  - 不要用 `window.dispatchEvent('resize')` 当高度通知如果能从 `initHeightManager` 返回 `scheduleResize`——返回值给 index 在 composer setOpen 后调用。不要新增第三套 overlay 管理器。

## 完成条件

- **产物入库**：提交到 delegate 分配分支；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  - 打开作曲器后 `#wt-asr-composer` 的 background 不是半透明黑罩，也不是 `inset:0` 全屏。
  - Pixel 5 Playwright：作曲器 `boundingBox().y` 在视口下半；终端 `.xterm-rows` 仍可见；输入框未 focus。
  - 打开不弹键盘（输入框不是 activeElement）。
  - × 关闭；点终端区域不会误关（没有全屏 backdrop）。
  - `bottomChromeHeight` 表：键盘开→0；作曲器开→composerH；否则 toolbarH。
- **相关测试**：`pnpm test`（全量）。Playwright `tests/playwright/asr.spec.ts --project=chromium-android` 更新 composer idle 截图。
- **lint / typecheck / build**：`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`
- **截图**：`test-results/voice-composer-idle.png` 必须能看见终端正文，不能是整屏暗罩。
- **提交纪律**：①CSS/DOM 去遮罩+压缩 ②高度管理 ③测试 分次 commit。
- **红验安全**（固定条款，原样保留）：改坏前先 commit 已验证修复；还原只许还原刚改坏的那一处。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象。`bottomChromeHeight` 的第二消费者是 `initHeightManager` 与 `tests/height.test.ts`。
- **执行器自声明 outcome**（固定条款，原样保留）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- origin/main `f89d3f0` 已含二层作曲器。真机截图：全屏 `rgba(0,0,0,.58)` 把 herdr 输出罩住。
- Moshi 对照：底栏胶囊，上面终端完全可读；它会弹键盘，我们不弹。
- **下一步唯一动作**：去掉遮罩并让高度管理给终端让出作曲器高度。
