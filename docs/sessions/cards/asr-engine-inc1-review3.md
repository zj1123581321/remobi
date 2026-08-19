# 任务卡：ASR 增量 1 独立 review 第 3 轮（运行时交错压力 + 不变式攻击）

## 目标

对增量 1（ASR 引擎核心）做第 3 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 1 轮 2 P1（已闭环）、第 2 轮 2 P1+1 P2（已收口）。仓 internal + infra 提档，
收敛条件 = 连续 2 轮无新增 P1。你是第 3 轮——若本轮 0 新增 P1，是第 1 个计数轮。

**本轮新证据**（前两轮都没看过）：状态机收口 diff `d74239f..efa5bd7`——引擎生命周期迁移表、
唯一 `transition()` 写入口、epoch + state 双守门、pending 资源分阶段作废、stop rejection 终态、
真实 BrowserPcmCapture port fake seam 测试。

**本轮视角（与前两轮都不同）**：
1. **运行时交错压力**：不写新代码，用既有测试框架（vitest + fake WebSocket/capture seam +
   fake timers）在临时目录写**攻击性探针脚本**（不进 git），随机/系统排列
   start/stop/fail/WS open/WS close/provider error/capture ready/final/timeout 的交错序列，
   跑数百个排列，断言 I1-I6 不变式（见下）在每种排列后成立。发现违反序列即 P1 候选。
2. **不变式逐条攻击**：对 I1-I6 各想一个「如果这条是假成立的，哪个输入拆穿它」，实跑验证。
3. **transition() 唯一写入口的完备性**：grep 全部状态读取点，找出「读 state 做决策但未经
   epoch/isCurrent 守门」的窗口（读-判-用之间的异步穿插）。
4. **迁移表↔实现一致性**：引擎注释里的迁移表（engine.ts:325-342）逐行对照实现与测试，
   找出表里有、实现/测试没有的格子（文档与代码漂移也是 finding）。

## 非目标

- 不修改被审代码；不审 base 存量；不重复前两轮已闭环 findings
  （两份 verdict 在 docs/sessions/260819-asr-engine-inc1/reviews/，仅历史线索）。
- 攻击探针脚本写临时目录，不进 git、不修改被审分支任何文件。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同前两轮（设计文档 v5、inc1 卡、spike 结果文档）+
  收口卡定义的 I1-I6 不变式与迁移表（docs/sessions/cards/asr-engine-inc1-fix1.md）。
  与文档化契约冲突的意见须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git checkout efa5bd7`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件 + 临时目录探针）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`c23d8e7..efa5bd7` 全量，重点 `d74239f..efa5bd7`。冻结 SHA，新提交作下一轮输入。

## 领域不变式（收口卡定义，逐条攻击）

- I1 单代际占有：同一时刻至多一个 WS + 一个采集会话属当前代际。
- I2 停后禁建：stop/fail 后 pending 异步完成必须代际作废 + 立即清理迟到资源。
- I3 成对清理：tracks/context/node/socket/timer/port 恰好清理一次，不漏不重。
- I4 异常必响：畸形帧/JSON 损坏/provider 0xF/WS 错误/采集失败/stop 失败 → 恰好一次 onError；
  唯一显式例外：合法 JSON 无 text 的 0x9 帧静默忽略。
- I5 stop 契约：幂等、可重入、有限时间必 settle、不永久悬挂；stop 后可干净 start 新轮。
- I6 背压三要素：queuedBytes + port 在途 + bufferedAmount 超水位必报 network-too-slow。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review3-verdict.md`；
  临时目录（/tmp 或 worktree 未跟踪目录）探针脚本。
- **禁止**：被审分支任何受跟踪文件的修改。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**

## 完成条件

- **行为验收**：
  1. 交错压力结果：排列数、不变式断言数、发现（含最小复现序列）写进 verdict；
     探针脚本路径（临时目录）与运行命令留档在 verdict 里（可复跑）。
  2. I1-I6 逐条攻击结论表：真成立 / 拆穿（证据：最小触发序列 + 文件:行）。
  3. transition() 完备性：全部状态读取点清单 + 未守门窗口（有/无及穷举依据）。
  4. 迁移表↔实现一致性对照表：每行迁移的实现位置 + 锁死测试，标出漂移格。
  5. 每条 finding：级别、溯源 spec、证据。P1 过两问（真实使用触发 + 后果不可接受）。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review3-verdict.md`
  （只新增）。
- **相关测试**：可只读运行 `pnpm test` / 定点 vitest / 临时探针。
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
  HEAD efa5bd7。主脑抽跑 570 tests 绿、lint:ox 0 errors；迁移表在 engine.ts:325-342，
  `this.state =` 全文件仅 transition() 内 1 处。两份历史 verdict 在 main 的
  docs/sessions/260819-asr-engine-inc1/reviews/。以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git checkout efa5bd7 && git log --oneline d74239f..efa5bd7`，
  从迁移表逐行对照实现开始。
