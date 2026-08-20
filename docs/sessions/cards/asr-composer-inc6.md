# 任务卡：ASR 增量 6 — 中断后再录追加，不覆盖已有草稿

## 目标

真机：说了一段 → 中途停（再点麦克风结束本段）→ 框里已有字 → 再点麦克风继续说，新识别把原稿整段盖掉。连续口授被打断后无法接着说。

用户可感知结果：框里已有字时再点麦克风继续说，原稿还在，新说的接在后面；空框开录行为不变。

## 非目标

- 不自动 focus、不默认弹系统键盘。
- 不改 ASR 引擎/协议。
- 不做光标处插入、不做 undo、不新增「覆盖/追加」开关。未聚焦时选择点不可靠（打开不 focus），一律接在草稿末尾。
- 不改发送后保持打开、textarea 增高、× 关层。
- 不改 CHANGELOG。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：250
- **Diff-Lines-Hard**：450
- **阶段**：implementing
- **锁定决策**：
  1. 本次录音开始时快照 `baseDraft = preview.getText()`（当前框里的全部已提交草稿）。引擎 partial/final 是**本段 utterance 的全量文本**，不是增量；展示与定稿必须是 `join(baseDraft, utterance)`，禁止 `preview.show(utterance)` / `setPartial(utterance)` 直接盖掉。
  2. `join`：utterance 空则仍是 baseDraft；baseDraft 空则仍是 utterance；两段都有内容时，若 base 已以空白结尾则直接拼接，否则中间加一个空格。不要每帧 partial 再往末尾叠字（会变成 hello hello world）。
  3. `startSession` / preview 态再点麦：仍不关层、不 `clear()`。快照在进入本段录音时取一次；连接中的状态文案（Requesting / Connecting / Listening）不得清掉输入框。
  4. 空框开录：baseDraft 为空，行为与现在一致（框里只有本段识别）。
  5. 发送成功 `resetDraft` 后 baseDraft 失效（框已空）；下一轮开录是新句子。× / `cancelSession` 仍关层清空，不在取消路径上追加。
  6. 录音中 input 仍 readOnly；用户要改字等 preview/idle。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：ac9b30d6b91c97d8ae89f986f2ac32306c39b9e4
- **Branch**：继续 `card/remobi-20260820-07`（PR #10）。从该分支 HEAD 继续，**禁止从 origin/main 新开分支**。
- **Worktree**：优先 resume `/home/zlx/projects/oss/remobi-worktrees/remobi-20260820-07`。
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（resume dlg-20260820-071116-f0f825 或 --class frontend）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead

## 修改边界

- **允许**：`src/controls/mic-controller.ts`、`src/controls/asr-preview.ts`（仅当 join 放预览层；默认放 mic-controller，能不改 asr-preview 就不改）、`tests/mic-controller.test.ts`、`tests/asr-preview.test.ts`、`tests/playwright/asr.spec.ts`
- **禁止**：`src/asr/`、`.github/`、`CHANGELOG.md`、`package.json`、`src/viewport/`
- **Scope-Globs**：src/controls/mic-controller.ts src/controls/asr-preview.ts tests/mic-controller.test.ts tests/asr-preview.test.ts tests/playwright/asr.spec.ts
- **高风险区域**：
  - Doubao/测试引擎的 partial 是当前 utterance 全量。`join(base, partial)` 必须用最新 partial 替换上一帧 utterance，不能 `base + p1 + p2`。
  - 现有测试 `keeps a typed draft until a new recording partial replaces it` 和 `preview Mic tap starts a replacement recording` 断言的是覆盖，必须改成追加。
  - `onFinal` 现为 `preview.show(text)`，漏改则停录后仍覆盖。
  - 快照必须在本段 `startSession` 时取；若在第一帧 partial 才取，那时 `show` 可能已经改过框。

## 完成条件

- **产物入库**：提交到 `card/remobi-20260820-07`；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  - 空框录音：partial/final 只有本段字。
  - 先打/先说得到 `keep this`，再点 Mic 录到 `new spoken`：框为 `keep this new spoken`（中间一个空格），作曲器仍开。
  - preview 后再点 Mic：作曲器不关；第一帧 partial 到来后原稿仍在前，新字在后。
  - 连续两段：`aaa` 停录再录 `bbb` → `aaa bbb`。
  - 发送清空后再录：只有新段，不拼上已发送内容。
  - 打开仍不 focus。
- **相关测试**：`pnpm exec vitest run tests/mic-controller.test.ts tests/asr-preview.test.ts`。能跑则 `pnpm exec playwright test tests/playwright/asr.spec.ts --project=chromium-android`。`pnpm test` 全量；`serve-abuse` 并行超时可单跑复验并注明。
- **lint**：`pnpm run check`、`pnpm exec tsc --noEmit`
- **提交纪律**：①join + startSession 快照 + onFinal/setPartial 改拼接 ②测试（含改掉覆盖断言）。
- **红验安全**（固定条款，原样保留）：改坏前先 commit；还原只许还原刚改坏的那一处。
- **反熵条款**（固定条款，原样保留）：`join`/`baseDraft` 的第二消费者是 setPartial 路径与 onFinal 路径；不要再加覆盖模式配置。
- **执行器自声明 outcome**（固定条款，原样保留）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- 真机：中断后再按麦克风，新 partial/final 走 `preview.setPartial` / `preview.show(text)` 整框替换。
- `startSession` 已不再 `clear()`，但第一帧 partial 仍覆盖。
- **下一步唯一动作**：`startSession` 快照 baseDraft，partial/final 用 join 展示。
