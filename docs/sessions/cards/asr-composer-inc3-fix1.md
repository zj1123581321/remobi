# 任务卡：ASR 增量 3 修复卡 1 — 中断取消必须有提示

## 目标

修独立审查第 1 轮登记的 F1（P1）以及同路径的 F2/F3/F4。用户可感知结果：录音中被来电/Siri/其他 App 抢麦时，二层作曲器**不消失**，给出原因，已识别的 partial 能留下来发或重录。

## 非目标

- 不改 ASR 引擎、不改 schema、不新增 action、不翻案 hold-to-talk。
- 不为 P2/P3 新增状态/包装层。
- 不改 CHANGELOG。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：200
- **Diff-Lines-Hard**：400
- **阶段**：repairing
- **root_cause_group**：composer 关闭被做成 cancelSession 的唯一出口，把「用户主动关」和「系统中断」合成一条静默清空路径
- **introduced_by_commit**：958761d3eb27a705a3cca2bb2936b7dc280f03f3
- **open_findings**：
  - F1 P1：`audio-interrupted` 走 `cancelSession` → `preview.clear()` 关 composer、丢 partial、无提示（`mic-controller.ts:245-248,178-200`；设计 R2 `docs/designs/asr-voice-input.md` 要求 cancelled + 提示）
  - F2 P2：idle 点 ×/backdrop 仍 `stopEngine()`（轴表要求不调 engine）
  - F3 P2：导出无第二消费者的 `voiceComposerButton`
  - F4 P3：`attachVoiceComposerMic` 先 append 再校验 mic 按钮
- **锁定决策**：
  1. F1 不要新状态机。`audio-interrupted` 改走现有 `showError('audio-interrupted')`：composer 保持打开、`ERROR_MESSAGES['audio-interrupted']` 上屏；若已有 partial，沿 showError 的 hadText 路径进入 preview 可发送。禁止再 `cancelSession` 静默清空。
  2. `visibilitychange hidden` 仍取消活动会话，但必须 `showMessage` 说明原因并保持 composer 打开（用户回到前台能看见），不得只 clear 关掉。
  3. 用户点 × / backdrop：活动会话取消并关闭；idle 只关 composer，**不** `stopEngine()`。
  4. F3：去掉 `export`，常量留模块私有。
  5. F4：先 query mic 按钮，缺则 throw，成功再 `appendChild`。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：30833518cf99dae40189cb471387f3518548c58c（`origin/card/remobi-20260820-04` HEAD）
- **Branch**：继续 `card/remobi-20260820-04`（resume 原 worktree），不得另建分支
- **Worktree**：resume 原 worktree `/home/zlx/projects/oss/remobi-worktrees/remobi-20260820-04`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex resume（原 dispatch `dlg-20260820-050533-4aa705`）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead

## 修改边界

- **允许**：`src/controls/mic-controller.ts`、`src/index.ts`、`src/config.ts`、`tests/mic-controller.test.ts`、`tests/config.test.ts`、`docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review1-verdict.md`（若本分支还没有，从 `b692e9b` 带上，不要改 verdict 正文）
- **禁止**：`src/asr/`、`.github/`、`CHANGELOG.md`、`package.json`
- **Scope-Globs**：src/controls/mic-controller.ts src/index.ts src/config.ts tests/mic-controller.test.ts tests/config.test.ts docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review1-verdict.md
- **高风险区域**：不要把用户主动关闭也改成保持打开；showError 的 hadText→preview 不得把中断变成误发送。

## 完成条件

- **产物入库**：提交到 `card/remobi-20260820-04`；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  - recording + `audio-interrupted`：composer 仍打开，文案含 Interrupted，有 partial 则可编辑/发送，无 partial 则为 error 可再点 Mic。
  - visibility hidden：composer 仍打开且有原因文案。
  - idle 打开后点 ×：composer 关，`engine.stops === 0`。
  - `voiceComposerButton` 不再从 `src/config.ts` 导出。
  - `attachVoiceComposerMic` 先校验再挂载。
- **相关测试**：`pnpm test`（全量，禁 `-k`）。新增/改写 `audio-interrupted`、visibility hidden、idle 关闭 stops===0。
- **lint / typecheck / build**：`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`
- **提交纪律**：按 F1 → F2 → F3/F4 分 2–3 次 commit。未提交按未完成。
- **红验安全**（固定条款，原样保留）：改坏前先 commit 已验证修复；还原只许还原刚改坏的那一处。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象。
- **执行器自声明 outcome**（固定条款，原样保留）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- 审查 verdict：`docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review1-verdict.md`（`b692e9b`，在 `card/remobi-20260820-05`）。
- 实现分支：`origin/card/remobi-20260820-04` @ `3083351`；PR https://github.com/zj1123581321/remobi/pull/9
- **下一步唯一动作**：F1 把 `audio-interrupted` 改走 `showError`。
