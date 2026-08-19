# 任务卡：ASR 增量 1 独立 review 第 6 轮（F1-F3 修复闭环核验 + 接口契约终态）

## 目标

对增量 1（ASR 引擎核心）做第 6 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 4 轮 0 P1、第 5 轮 2 P1（计数重置）。仓 internal + infra 提档，
收敛条件 = 连续 2 轮无新增 P1。**若本轮 0 新增 P1，是第 1 个计数轮。**

**本轮新证据**（前五轮未用作主输入）：修复增量 `c9ae8ec..4d9087c`
（onFinal sequence 事件契约、audio-interrupted 中断消费面、worklet fail-loud 分流，
及其与 P2 收口的 merge）。

**本轮视角**：
1. **F1/F2/F3 修复闭环核验**：逐条构造「假闭环拆穿输入」并实跑——
   F1：带序号 final 穿过 engine 后 handler 收到 (text, sequence)；旧单参数消费函数兼容；
   flags=0 无序号响应不受影响。
   F2：v5 #4 逐条对照——onended 即报、onmute 观察/onunmute 恢复/5s 超时取消、
   statechange 仅 interrupted/非主动 suspended、主动 stop/close 不误报、
   清理路径解绑全部信号（stop 后迟到 mute/ended 不诈尸）。
   F3：processorerror 与 {type:'error'} 控制消息各自恰好一次 onError，不落入 PCM 分支。
2. **接口契约终态**：`AsrFinalHandler = (text, sequence?) => void` 与新增 `audio-interrupted`
   错误码就是增量 2 的接入面——以「增量 2 实现者只能看 types.ts 注释和这些事件」的立场，
   问契约是否自足（注释是否说清 sequence 用途、interrupted 语义、各错误码触发条件）；
   契约缺口分级（阻塞增量 2 = P1/P2）。
3. **merge 正确性**：`c9ae8ec..4d9087c` 的 merge 是否完整保留 P2 收口三项
   （cache 头、CSP 字节测试、文档漂移），有没有 merge 引入的语义丢失（diff 对照两边父提交）。
4. **终末全量复验**：H0 上 `pnpm test`、`pnpm run check`、`pnpm run lint:ox`、
   `pnpm run build:dist` 全绿，摘要进 verdict。

## 非目标

- 不修改被审代码；不审 base 存量；不重复前五轮已闭环 findings
  （五份 verdict 在 docs/sessions/260819-asr-engine-inc1/reviews/）。
- 不要求引擎做 final 去重（已裁决：增量 2 mic-controller 职责）或 visibilitychange（同）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同前轮（设计文档 v5 含 v5 #3/#4、spike 结果文档、inc1 卡、
  fix1 收口卡 I1-I6、P2-3 接受不修、no-cache 定案、final 去重属增量 2）。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git checkout 4d9087c`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`c23d8e7..4d9087c` 全量，重点 `c9ae8ec..4d9087c`。冻结 SHA，新提交作下一轮输入。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review6-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**

## 完成条件

- **行为验收**：
  1. F1/F2/F3 闭环核验表（拆穿输入 × 实测结果 × 证据文件:行）。
  2. v5 #4 中断语义逐条对照表（onended/onmute/onunmute/5s 超时/statechange 四信号 × 期望 × 实测）。
  3. 接口契约自足性结论（types.ts 注释 × 事件面 × 错误码表）。
  4. merge 完整性对照（P2 三项在 merge 后仍存在且语义未变）。
  5. 终末全量复验摘要。
  6. 每条 finding：级别、溯源 spec、证据。P1 过两问。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review6-verdict.md`
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
  HEAD 4d9087c（merge commit，两父 = c9ae8ec P2 收口 + c8f9b3f F1-F3 修复）。
  主脑抽跑 583 tests 绿、lint:ox 0 errors、biome check 绿。
  修复实现锚点：types.ts（AsrFinalHandler、audio-interrupted）、
  engine.ts:272-301（信号注册）、204-230（控制信道分流+onprocessorerror）。
  以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git checkout 4d9087c && git log --oneline c9ae8ec..HEAD`，
  从 F1 的 `src/asr/types.ts` 契约变化开始核验。
