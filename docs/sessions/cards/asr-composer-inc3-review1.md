# 任务卡：ASR 增量 3 独立 review 第 1 轮（二层语音作曲器）

## 目标

对 `feat(asr)` 二层作曲器 diff 做独立全量审查，产出 verdict。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

本轮新证据（主脑已核，审查仍须自己读 diff，不因这些缩小范围）：
- Pixel 5 Playwright 截图：入口 44×44 圆气泡；二层盖住 toolbar；录音粉色 Mic；preview 可编辑。
- 主脑抽跑：`tests/mic-controller.test.ts` 31、`tests/asr-preview.test.ts` 2、`tests/config.test.ts` 40、`tests/integration.test.ts` 33 绿。一次全量 `pnpm test` 撞到既有 `serve-abuse` websocket 超时 flake，与本 diff 无关。
- Draft PR：https://github.com/zj1123581321/remobi/pull/9

## 非目标

- 不修改被审代码。
- 不审 `src/asr/` 引擎本体（增量 1 已收敛）。
- 不翻案 hold-to-talk；不要求 `+`/undo。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：被审对象的 spec 即锁定项；与项目文档化契约冲突的意见不能直接判 fail，须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：5508a6721e654cae15895bca656b40b9faa959d5
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push。审查范围用 SHA，不用分支名。
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead 拆卡与验收

## 审查对象（H0 冻结）

`5508a6721e654cae15895bca656b40b9faa959d5..30833518cf99dae40189cb471387f3518548c58c`

核心：`src/controls/asr-preview.ts`、`src/controls/mic-controller.ts`、`src/toolbar/toolbar.ts`、
`src/index.ts`、`src/config.ts`（`withVoiceComposerEntry`）、`styles/base.css`、对应测试与文档。

## spec 输入（意见须溯源，无法溯源默认降一级）

1. `docs/sessions/cards/asr-composer-inc3.md` 锁定决策 1–10 与轴表。
2. `docs/designs/asr-voice-input.md` 现稿（E6 普通 input、E7 toolbar-only、tap-to-toggle 状态机、sanitize、非 OPEN 不入队）。
3. 仓 `risk-tier: personal`。P1 = 数据丢失 / 静默出错 / 崩溃。本 diff 是 UI 分层，不按 infra 提档。
4. **本轮必查**：
   - toolbar 入口不得 startSession。
   - 打开作曲器不得 `input.focus()`。
   - idle 打字后 Send 必须走同一 sanitize + isConnected 守卫，成功后关闭。
   - 录音中 input readOnly；preview/error/idle 可编辑。
   - ×/backdrop 在活动会话走 cancelSession，idle 只关不启引擎。
   - CSS `#wt-toolbar .wt-row:last-child button.wt-mic` 特异性压过 last-child flex:1。
   - `withVoiceComposerEntry` 不重复注入；asr.enabled=false 不注入。
   - 注入文本仍是终端命令面：任何路径把 `\r`/C0 送进 sendData 仍是 P1。

## 修改边界

- **允许**：仅新增 `docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review1-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review1-verdict.md

## 完成条件

- **产物入库**：verdict 提交到本卡分支；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  1. 全量审 diff。
  2. 每条 finding：级别、溯源 spec、证据（文件:行 + 触发路径）。P1 过两问。
  3. 熵增维度：每个新增抽象问第二消费者。
  4. verdict 结构：verdict、findings 表、backlog。
- **相关测试**：可只读运行 `pnpm test` 与定点 vitest 验证怀疑点。
- **跨发布边界不适用**。
- **提交纪律**：唯一一次 commit 写 verdict。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，改坏前必须先 commit；本卡禁止改生产代码，故不适用。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象。
- **执行器自声明 outcome**（固定条款，原样保留）：该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- 实现卡 `remobi-20260820-04` / dispatch `dlg-20260820-050533-4aa705` 已 succeeded。
- OCR 前置：`status=reviewed`（minimax MiniMax-M3）。16 条 raw findings；复核器只核了 4 条：
  - confirmed：`src/index.ts` `attachVoiceComposerMic` 先 `appendChild` 再 query mic，缺按钮时 DOM 已脏（主脑初判 ≤P3：createAsrPreview 恒有该按钮，抛错路径是编程错误）。
  - refuted×3：无锚点回退 row1（契约+测试锁定）、closeComposerOverlays 迟到赋值、close 双触发。
  - 其余 unverified，不当成已证实。审查自行全量审，不因 OCR 缩小范围。
- **下一步唯一动作**：写 verdict。
