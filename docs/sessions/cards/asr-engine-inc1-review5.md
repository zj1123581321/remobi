# 任务卡：ASR 增量 1 独立 review 第 5 轮（增量 2 就绪度 + 收敛复验）

## 目标

对增量 1（ASR 引擎核心）做第 5 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 4 轮 0 新增 P1（第 1 个计数轮）。仓 internal + infra 提档，
收敛条件 = 连续 2 轮无新增 P1。**若本轮 0 新增 P1，评审收敛。**

**本轮新证据**（前四轮未用作主输入）：P2 收口 diff `397e3d6..c9ae8ec`
（HTML Cache-Control、CSP/worklet 两态字节级测试、设计文档漂移清理）。

**本轮视角（与前四轮都不同）**：
1. **增量 2 就绪度**：对照设计文档增量 2 节与 PTT 状态机（`docs/designs/asr-voice-input.md`
   增量 2/PTT 状态机/E3/v5 #1-#5），逐条问：mic-controller 需要的东西，引擎/类型/config
   现在有没有——start/stop 语义、onPartial/onFinal/onError 事件面、AsrErrorCode 覆盖度
   （PTT 的每个 error 迁移能否映射到现有错误码）、isSupported 能力检测降级输入、
   会话 epoch 语义是否与 mic-controller 的 generation 兼容。缺口分级：阻塞增量 2 的 = P1/P2；
   增量 2 自己该做的 ≠ finding。
2. **P2 收口核验**：`397e3d6..c9ae8ec` 三项（cache 头、字节级 CSP 测试、文档漂移）是否
   真闭环——cache 头是否覆盖全部 HTML 路由变体（root、base-path、canonical 重定向目标）；
   字节级 CSP 断言的字节串与实现当前输出逐字符一致；文档更新有没有引入新的漂移
   （改文档改错了也是 finding）。
3. **终末全量复验**：在 H0 上完整跑 `pnpm test`、`pnpm run check`、`pnpm run lint:ox`、
   `pnpm run build:dist`，确认收敛点时全绿（记录输出摘要进 verdict）。

## 非目标

- 不修改被审代码；不审 base 存量；不重复前四轮已闭环 findings
  （四份 verdict 在 docs/sessions/260819-asr-engine-inc1/reviews/，仅历史线索）。
- 不要求引擎提供 PTT UI 本身的任何东西（增量 2 范围）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同前轮（设计文档 v5、spike 结果文档、inc1 卡、fix1 收口卡 I1-I6、
  P2-3 接受不修裁决、no-cache 定案）。与文档化契约冲突的意见须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git checkout c9ae8ec`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`c23d8e7..c9ae8ec` 全量。冻结 SHA，新提交作下一轮输入。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review5-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**

## 完成条件

- **行为验收**：
  1. 增量 2 就绪度对照表：PTT 状态机每个状态/迁移 × 引擎现有接口支撑（有/无/增量 2 自建），
     缺口带级别与证据。
  2. P2 收口核验表：三项逐条真闭环/假闭环（证据）。
  3. 终末全量复验输出摘要（四项门禁）。
  4. 每条 finding：级别、溯源 spec、证据。P1 过两问（真实使用触发 + 后果不可接受）。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review5-verdict.md`
  （只新增），结尾必须有一行收敛判定：「本轮新增 P1：0 / N」。
- **相关测试**：可只读运行全量门禁。
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
  HEAD c9ae8ec。主脑抽跑 576 tests 绿、lint:ox 0 errors。四份历史 verdict 在 main。
  增量 2 所需接口面：AsrEngine（src/asr/types.ts）、AsrErrorCode union、
  mic-controller 需求在设计文档 PTT 状态机节。以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git checkout c9ae8ec`，
  读 `src/asr/types.ts` 与设计文档 PTT 状态机节，开始就绪度对照。
