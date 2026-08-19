# 任务卡：ASR 增量 2 独立 review 第 3 轮（PTT 状态机运行时交错压力）

## 目标

对增量 2（PTT UI 与注入）做第 3 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件与临时目录探针。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 2 轮 0 新增 P1（第 1 个计数轮）。仓 internal + infra 提档，
收敛条件 = 连续 2 轮无新增 P1。**若本轮 0 新增 P1，评审正式收敛。**

**本轮新证据**（前两轮未用作主输入）：运行时交错压力探针结果（你本人生成）。
前两轮是静态正向与反向审查；本轮主武器是运行时攻击。

**本轮视角**：
1. **PTT 状态机交错压力**：用既有 happy-dom 测试环境（vitest + mic-controller 的真实依赖
   fake：engine seam / term seam / preview seam，参考 tests/mic-controller.test.ts 的构造），
   在临时目录写攻击性探针（不进 git）：固定 seed 的确定性伪随机序列，事件集合 =
   pointerdown/pointerup/pointercancel/超时 tick/permission grant/deny/engine partial/
   engine final(各种 seq)/engine error/visibilitychange hidden+visible/WS connect/disconnect/
   用户编辑/确认/取消/重复确认。每条 12 事件、≥400 个排列，每个事件后断言核心不变式
   （见下）。发现违反序列即 P1 候选，附最小复现。
2. **注入面运行时模糊**：向 sanitize + 注入链投喂构造输入（C0/C1/Cf/Zl/Zp/组合字符/超长文本/
   空文本/纯空格），断言进入 sendData 的字节流永远不含 C0/DEL/C1/Cf/Zl/Zp（autoEnter 的
   独立 `\r` 除外且它必须独立成帧）。
3. **多轮会话资源账本**：连续 50 轮「按下→录音→松手→确认/取消」，断言 engine start/stop
   调用次数成对、无 listener 泄漏（handlers 计数回到基线）、appliedSeq 每轮重置。

## 核心不变式（探针断言对象）

- V1：任何事件序列后 state 合法且 transition 不抛（无 Invalid mic transition）。
- V2：任意非 idle 状态 + hidden → cancelled → idle，engine handlers 解绑，timer 清空。
- V3：进入 sendData 的字节永不包含 C0/DEL/C1/Cf/Zl/Zp（除独立 `\r` 帧）。
- V4：终端 WS 非 OPEN 时：无 sendData 调用、无内存队列累积、preview 文本保留。
- V5：final 应用仅在 waiting-final 且 seq > appliedSeq；preview 后任何 final 无效。
- V6：每个事件序列结束后无悬挂 promise（探针能干净结束）、无重复 onError。

## 非目标

- 不修改被审代码；不审 base 存量；不重复前两轮已闭环 findings。
- 探针脚本写临时目录，不进 git、不改被审分支任何文件。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同前两轮（设计文档 v5、inc2 卡轴表、R1/R7/v5 #1/#12）。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：5659515（origin/main；审查范围 = `11e2a7d..bd9aaeb`）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git checkout bd9aaeb`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件 + 临时探针）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`11e2a7d..bd9aaeb`。冻结 SHA，新提交作下一轮输入。

## 修改边界

- **允许**：仅新增 `docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review3-verdict.md`；
  临时目录探针脚本。
- **禁止**：被审分支任何受跟踪文件的修改。
- **Scope-Globs**：docs/sessions/260820-asr-ptt-inc2/**

## 完成条件

- **行为验收**：
  1. 交错压力结果：排列数、不变式断言数、发现（含最小复现序列）；探针路径与复跑命令
     写进 verdict。
  2. V1-V6 逐条结论：未拆穿 / 拆穿（最小序列 + 文件:行）。
  3. 注入面模糊结果表（输入类 × 期望 × 实测）。
  4. 多轮资源账本结果（start/stop 成对、listener 基线、appliedSeq 重置）。
  5. 每条 finding：级别、溯源 spec、证据。P1 过两问。
- **verdict 产出**：`docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review3-verdict.md`
  （只新增），结尾一行收敛判定「本轮新增 P1：0 / N」。
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

- **现场事实（主脑预取）**：被审分支 origin/card/remobi-20260819-14（draft PR #8），
  HEAD bd9aaeb。621 tests 绿、全门禁绿。两份历史 verdict 在 main 的
  docs/sessions/260820-asr-ptt-inc2/reviews/。mic-controller 构造与 seam 用法见
  tests/mic-controller.test.ts。以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git checkout bd9aaeb`，读
  `tests/mic-controller.test.ts` 的 seam 构造，在临时目录搭探针骨架后开跑压力序列。
