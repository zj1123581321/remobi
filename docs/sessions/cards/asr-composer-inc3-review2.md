# 任务卡：ASR 增量 3 独立 review 第 2 轮（H0..H1 增量审 + 新 P1 扫描）

## 目标

对修复增量做独立审查，产出 verdict。你是审查者，不是实现者；唯一允许的写入是 verdict 文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`

本轮新证据：H0..H1 修复 diff（不是再读一遍 H0 全文）。H0=`30833518cf99dae40189cb471387f3518548c58c`，H1=`5c270e2c7374a60445e8f260dd01d228e0e2a37a`。主脑已抽跑 `tests/mic-controller.test.ts` 31 绿、`tests/config.test.ts` 40 绿。

## 非目标

- 不修改被审代码。
- 不重开第 1 轮已通过的入口/focus/typed-Send/CSS/注入不变式，除非本增量把它们改坏。
- 不把第 1 轮 F2/F3/F4 再升 P1。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：200
- **Diff-Lines-Hard**：400
- **阶段**：reviewing
- **锁定决策**：第 1 轮 verdict 的 F1–F4 是本轮唯一登记 findings；修复不得超出。
- **任务类型**：review
- **复杂度**：S
- **Base commit**：30833518cf99dae40189cb471387f3518548c58c
- **Branch**：由 delegate 分配；被审代码在 `origin/card/remobi-20260820-04` @ `5c270e2c7374a60445e8f260dd01d228e0e2a37a`
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（仅 verdict）
- **执行器与模型**：codex（delegate --class big）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead

## 审查对象（冻结）

增量审范围：`30833518cf99dae40189cb471387f3518548c58c..5c270e2c7374a60445e8f260dd01d228e0e2a37a`

fetch：`git fetch origin card/remobi-20260820-04` 后 `git diff 30833518cf99dae40189cb471387f3518548c58c..5c270e2c7374a60445e8f260dd01d228e0e2a37a`

第 1 轮 verdict：`docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review1-verdict.md`

## 增量审四问（必须逐条回答）

1. 本轮是否只修登记在案的 F1–F4？
2. 是否新增未经批准的抽象？
3. 状态/事实源/fallback 是否无依据增加？
4. 是否留下双路径？（尤其 `audio-interrupted` 的 if 分支现在与默认 `showError` 相同）

然后扫描：**有没有新的 P1**（数据丢失 / 静默出错 / 崩溃）。仓 `risk-tier: personal`。

F1 闭合判据：recording 中 `audio-interrupted` 后 composer 仍开，有提示；有 partial 则进 preview 可发；无 partial 则为 error 可重试。visibility hidden 后 composer 仍开且有原因文案。

## spec 输入

1. 第 1 轮 verdict findings 表。
2. 修复卡 `docs/sessions/cards/asr-composer-inc3-fix1.md` 锁定决策 1–5。
3. `docs/designs/asr-voice-input.md` R2（中断要提示）。

## 修改边界

- **允许**：仅新增 `docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review2-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260820-asr-composer-inc3/reviews/asr-composer-inc3-review2-verdict.md

## 完成条件

- **产物入库**：verdict 提交到本卡分支；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：四问逐条回答；F1–F4 闭合或未闭合写证据；新 P1 列表（无则写 0）。
- **跨发布边界不适用**。
- **提交纪律**：唯一一次 commit 写 verdict。
- **红验安全**（固定条款，原样保留）：本卡禁止改生产代码，故不适用。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象。
- **执行器自声明 outcome**（固定条款，原样保留）：该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- 实现 PR：https://github.com/zj1123581321/remobi/pull/9
- **下一步唯一动作**：写 review2 verdict。
