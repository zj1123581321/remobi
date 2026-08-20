# 任务卡：ASR 增量 5 独立 review 第 1 轮（连续回合作曲器）

## 目标

对连续回合作曲器 diff 做独立全量审查，产出 verdict。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

本轮新证据（主脑已核，审查仍须自己读 diff，不因这些缩小范围）：
- 红验：在 `69fb85a` 上只拷入本增量测试，`tests/mic-controller.test.ts` 5 红 / 29 绿，`tests/asr-preview.test.ts` 3 红 / 2 绿。
- Playwright 截图：`test-results/voice-composer-idle.png`、`test-results/voice-composer-long-text.png`（长文本换行，终端正文可见）。
- Draft PR：https://github.com/zj1123581321/remobi/pull/10 HEAD `ac9b30d6b91c97d8ae89f986f2ac32306c39b9e4`

## 非目标

- 不修改被审代码。
- 不审 `src/asr/` 引擎本体。
- 不翻案 tap-to-toggle、不要求自动 focus、不做光标处追加录音。
- 不把「发送后应关闭」当回归——本增量明确改成发完保持打开。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：被审对象的 spec 即锁定项；与项目文档化契约冲突的意见不能直接判 fail，须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：69fb85a41ac30fd8828bbb53e6d003ea8fdf1309
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push。审查范围用 SHA，不用分支名。
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead 拆卡与验收

## 审查对象（H0 冻结）

`69fb85a41ac30fd8828bbb53e6d003ea8fdf1309..ac9b30d6b91c97d8ae89f986f2ac32306c39b9e4`

核心：`src/controls/asr-preview.ts`、`src/controls/mic-controller.ts`、`src/index.ts`、
`styles/base.css`、`tests/asr-preview.test.ts`、`tests/mic-controller.test.ts`、
`tests/playwright/asr.spec.ts`。

## spec 输入（意见须溯源，无法溯源默认降一级）

1. `docs/sessions/cards/asr-composer-inc5.md` 锁定决策 1–6。
2. 仓 `risk-tier: personal`。P1 = 数据丢失 / 静默出错 / 崩溃。本 diff 核心是发送/关闭/重录状态迁移，按 infra 提档：收敛条件为连续 2 轮无新增 P1。
3. **本轮必查（含降层）**：
   - 发送成功不得走 `preview.clear()` + `endAsIdle()`；composer 保持打开，草稿清空，状态 idle，toolbar 仍 hidden。
   - `×` / 用户取消仍关层并出工具栏，不能被「keep open」布尔打穿。
   - `startSession` 不得 `preview.clear()`；已有草稿保留到第一帧 partial 再覆盖。
   - preview 态点 Mic = 重录（先回 idle 不关层，再 startSession），不必先 ×。
   - 打开不 focus；Enter 换行不发送；Send 才发送。
   - 终态写入成功之前已发生哪些不可逆动作（`sendData` / `\r`）？失败回切后草稿是否还在？
   - 守卫用的 generation / wasOpen 在单页单实例下是否足够？
   - 保护覆盖的是「关层」还是「发送行为」——空发送、断线、sanitize 空文本不得静默丢掉用户草稿。
   - 熵增：`resetDraft` 第二消费者；`onHeightChange` 是否必要（onOpenChange 在同 open 态不通知）。

## 修改边界

- **允许**：仅新增 `docs/sessions/260820-asr-composer-inc5/reviews/asr-composer-inc5-review1-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260820-asr-composer-inc5/reviews/asr-composer-inc5-review1-verdict.md

## 完成条件

- **产物入库**：verdict 提交到本卡分支；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  1. 全量审 diff。
  2. 每条 finding：级别、溯源 spec、证据（文件:行 + 触发路径）。P1 过两问。
  3. 熵增维度：每个新增抽象问第二消费者。
  4. 降层三问必须书面回答。
  5. verdict 结构：verdict、findings 表、backlog。
- **相关测试**：可只读运行定点 vitest 验证怀疑点。
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

- 实现已在 `card/remobi-20260820-07` @ `ac9b30d`。
- **下一步唯一动作**：全量审 `69fb85a..ac9b30d` 并写 verdict。
