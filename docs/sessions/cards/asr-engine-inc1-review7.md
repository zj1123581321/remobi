# 任务卡：ASR 增量 1 独立 review 第 7 轮（终末收敛：live 证据审计 + decoder 合法域终态）

## 目标

对增量 1（ASR 引擎核心）做第 7 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 6 轮 0 新增 P1（第 1 个计数轮）。仓 internal + infra 提档，
收敛条件 = 连续 2 轮无新增 P1。**若本轮 0 新增 P1，评审正式收敛。**

**本轮新证据**（前六轮未用作主输入）：
- fix3 diff `1db2735..a673fa1`（decoder 接受 flags=1 带序列 partial + 真帧 golden）；
- **live smoke 证据**：shipped engine + 真实语音（OSR_us_000_0010_8k 重采样 16k）+ 真实火山服务，
  修复前 `[error] protocol-error`/0 partial → 修复后 21 partial + 1 final(seq=22) + 0 error，
  成功会话 23 真帧 fixture `tests/fixtures/asr/2026-08-19T1242Z-live-smoke/`。

**本轮视角**：
1. **live 证据审计**：对照成功会话 fixture 的 transcript.jsonl 与帧 hex——23 帧的 flags/sequence/
   offset 分布是否全部被现 decoder 合法域覆盖？有没有在 live 中出现但测试没锁的帧形态
   （比如其它 flags、audio_info-only 帧、多 final）？逐帧核对。
  2. **decoder 合法域终态穷举**：flags=1 放宽后，0x9 合法域 {0,1,3}——「合法 × 误拒」与
  「非法 × 误收」双向矩阵终验（含 flags=1 但截断 sequence、flags=1 payload offset 边界）。
  3. **修复本身**：fix3 是否只放宽了该放宽的（0x9 flags=1），有没有连带放宽 decodeAudio/
  error/full-request 的域；mock server 是否需要也能发 flags=1 partial（若无，引擎的
  flags=1 路径在集成层是否只靠 golden 单测锁——够不够）。
4. **终末全量复验**：H0 上 `pnpm test`、`pnpm run check`、`pnpm run lint:ox`、
   `pnpm run build:dist` 全绿，摘要进 verdict。

## 非目标

- 不修改被审代码；不审 base 存量；不重复前六轮已闭环 findings
  （六份 verdict 在 docs/sessions/260819-asr-engine-inc1/reviews/）。
- 不重跑 live smoke（主脑已终审；你要复跑可用自己的密钥，非必须）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同前轮（设计文档 v5、spike 结果文档、inc1 卡、fix1 收口卡 I1-I6）+
  新增：0x9 合法 flags 域 {0,1,3}（live 实帧定案）。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git checkout a673fa1`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`c23d8e7..a673fa1` 全量，重点 `1db2735..a673fa1` + live fixture 两目录
（`2026-08-19T1230Z-live-smoke`、`2026-08-19T1242Z-live-smoke`）。冻结 SHA。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review7-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**

## 完成条件

- **行为验收**：
  1. live fixture 逐帧审计表（23 帧 × flags/sequence/offset × decoder 覆盖 × 测试锁定）。
  2. decoder 合法域双向矩阵终验表（合法×误拒 / 非法×误收）。
  3. fix3 放宽面结论（是否最小、有无连带放宽）。
  4. 终末全量复验摘要。
  5. 每条 finding：级别、溯源 spec、证据。P1 过两问（真实使用触发 + 后果不可接受）。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review7-verdict.md`
  （只新增），结尾一行收敛判定「本轮新增 P1：0 / N」。
- **相关测试**：可只读运行全量门禁与定点 vitest。
- **跨发布边界不适用**。
- **提交纪律**：verdict 在本卡分支 commit（`docs(sessions):`，归因自动注入）。
- **执行器自声明 outcome**：报告文件（report.md）正文中、首个二级标题之前，恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。

## 当前状态

- **现场事实（主脑预取）**：被审分支 origin/card/remobi-20260819-03（draft PR #7），
  HEAD a673fa1。主脑抽跑 586 tests 绿、lint:ox 0 errors（fix3 后）。
  live smoke 由主脑用 tsx harness（注入 FileCapture + ws adapter）执行，harness 已删，
  证据全部在 fixture 两目录与本卡上文描述。
- **下一步唯一动作**：`git fetch origin && git checkout a673fa1`，
  从 `tests/fixtures/asr/2026-08-19T1242Z-live-smoke/transcript.jsonl` 逐帧审计开始。
