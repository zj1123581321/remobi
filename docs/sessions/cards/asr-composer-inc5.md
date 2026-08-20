# 任务卡：ASR 增量 5 — 连续回合：发完不关、多行编辑、同一草稿可再录

## 目标

手机赶 Agent 是连续多轮：看输出 → 说/改一句 → 发出去 → 再看 → 再说。当前作曲器把这当成一次性对话框，长文本和反复输入都别扭。

用户可感知结果：
1. 发送后输入条还在，框被清空，立刻能再说/再打。要打断 Agent 再点 × 出工具栏（C-c）。
2. 长指令能换行、能看见全文，不必横向滑动。
3. 框里已有字时再点麦克风会重录，不必先取消；开始录音不会把整层关掉、不会先清掉草稿（新 partial 到了再覆盖）。

## 非目标

- 不自动 focus、不默认弹系统键盘。
- 不改 ASR 引擎/协议。preview 态点麦 = 重录覆盖，不做「插入光标处」的追加（下一轮再说）。
- 不做 undo / + 附件。
- 不改 CHANGELOG。
- 回车在多行框里是换行，不是发送；发送只走 Send。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：700
- **阶段**：implementing
- **锁定决策**：
  1. 发送成功：把草稿清空，**作曲器保持打开**，状态回 idle。禁止再走 `preview.clear()` + `endAsIdle()` 那条关层路径。× / 用户取消才关层并出工具栏。
  2. 输入控件改成 `textarea`（接口字段可仍叫 `input` 但类型是 `HTMLTextAreaElement`）。随内容增高，约 1–6 行后内部滚动。`font-size: 16px` 保留（防 iOS 缩放）。打开仍不 focus。
  3. `startSession` **禁止** `preview.clear()`（它会关层）。作曲器保持打开；已有草稿保留到第一帧 partial 再覆盖。
  4. `tapToggle`：`preview` 态点麦克风 = 进入新录音（先回到 idle 但不关层，再 startSession）。`error` 态保持现有「取消再开录」。
  5. 拆关层与清空：`clear()` 继续表示关层+清空（× 用）；新增 `resetDraft()`（或等价）只清空文字和状态文案、保持打开。发送走 resetDraft。
  6. textarea 高度变化后必须触发现有 `scheduleResize`（`onOpenChange` 或同等回调），避免长文本把终端底边顶没。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：69fb85a41ac30fd8828bbb53e6d003ea8fdf1309
- **Branch**：继续 `card/remobi-20260820-07`（PR #10）。从 `origin/card/remobi-20260820-07` 检出，**禁止从 origin/main 新开分支**（会丢掉增量 4 底栏）。
- **Worktree**：优先 resume 原 worktree `/home/zlx/projects/oss/remobi-worktrees/remobi-20260820-07`；若新开 worktree 必须基于上述 SHA。
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（resume 或 --class frontend）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead

## 修改边界

- **允许**：`src/controls/asr-preview.ts`、`src/controls/mic-controller.ts`、`styles/base.css`、`src/index.ts`（仅当 textarea 高度要接 scheduleResize）、`tests/asr-preview.test.ts`、`tests/mic-controller.test.ts`、`tests/playwright/asr.spec.ts`、`tests/height.test.ts`（仅当高度公式因 textarea 变）
- **禁止**：`src/asr/`、`.github/`、`CHANGELOG.md`、`package.json`
- **Scope-Globs**：src/controls/asr-preview.ts src/controls/mic-controller.ts styles/base.css src/index.ts tests/asr-preview.test.ts tests/mic-controller.test.ts tests/playwright/asr.spec.ts tests/height.test.ts
- **高风险区域**：
  - `endAsIdle` 现在无条件 `preview.close()`。发送不能走它，或给它「keep composer」会把 × 路径弄混——宁可发送用独立函数，不要一个布尔打穿所有关闭。
  - `openComposer` 现在会清空输入；发送后保持打开时不要再调 `open()`。
  - Playwright 现在断言发送后 composer hidden，必须改成 visible 且输入为空。

## 完成条件

- **产物入库**：提交到 `card/remobi-20260820-07`；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  - 打字发送后 composer 仍开、输入为空、body 仍有 `wt-composer-open`、工具栏仍 hidden。
  - 长字符串（>200 字）textarea `scrollWidth` 不超过 `clientWidth`（不横滑）；高度 > 单行。
  - 打开不 focus。
  - Enter 不发送（文本仍在）；Send 才发送。
  - 打开后先打几个字再点 Mic：作曲器不关，字还在，直到 partial 到达才覆盖。
  - preview 后再点 Mic：进入 connecting/recording，不必先 ×。
- **相关测试**：`pnpm test`（全量，`serve-abuse` 已知并行超时可单跑复验并注明）。`pnpm exec playwright test tests/playwright/asr.spec.ts --project=chromium-android`。
- **lint**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`
- **截图**：更新 `voice-composer-idle.png` / preview；另留一张长文本换行截图。
- **提交纪律**：①textarea+样式 ②发送不关+startSession/preview 重录 ③测试。
- **红验安全**（固定条款，原样保留）：改坏前先 commit；还原只许还原刚改坏的那一处。
- **反熵条款**（固定条款，原样保留）：`resetDraft` 的第二消费者是发送路径与「点麦重录前保草稿」；说不出就不要再拆第三种 clear。
- **执行器自声明 outcome**（固定条款，原样保留）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- 真机/探针：`<input type=text>` 212 字 `scrollW=3055` vs `clientW=343`；Enter 无效果；发送走 `preview.clear()` + `endAsIdle()` 关层；`startSession` 也 `preview.clear()`；preview 点 Mic 无操作。
- 底栏去遮罩在 PR #10（`card/remobi-20260820-07` @ `69fb85a`），本卡叠上去。
- **下一步唯一动作**：发送改为 `resetDraft` 且保持打开。
