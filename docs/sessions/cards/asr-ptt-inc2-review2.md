# 任务卡：ASR 增量 2 独立 review 第 2 轮（修复闭环核验 + 反向误拒 + 红验抽查）

## 目标

对增量 2（PTT UI 与注入）做第 2 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 1 轮 2 P1 + 6 P2（全部登记修复）。仓 internal + infra 提档
（mic-controller 状态机核心），收敛条件 = 连续 2 轮无新增 P1。本轮若 0 新增 P1，是第 1 个计数轮。

**本轮新证据**（第 1 轮未见过）：修复增量 `5eeef33..bd9aaeb`（8 条 finding 的修复 +
红绿测试）、修复后 e2e 的 PTY 输出断言与协议帧计数。

**本轮视角（与第 1 轮不同——第 1 轮是正向 spec 全量）**：
1. **修复闭环核验**：8 条 finding 逐条构造「假闭环拆穿输入」实跑验证——
   F1：preview/error 两态 visibilitychange 是否真不抛且资源收口；error 态无文本时的提示保留语义。
   F2：after hook 期间断线 → `\r` 是否真的既不发也不入队；守卫失败时 preview 文本是否保留可手动发。
   F3：U+200B/U+202A/U+2028/U+2029/U+FEFF/C0/DEL/C1 全谱字节级过一遍；组合字符（e+́）是否保留。
   F4：超时→编辑→迟到 final 不覆盖；waiting-final 内 seq 去重仍生效（别修过头把合法 final 也丢了）。
   F5：e2e 断言真读 xterm buffer 输出标记；协议帧计数（full-request/audio/end）是否真被断言。
   F6/F7：订阅初值回放、error+close 去重。
   F8：多按钮非法路径逐项定位。
2. **反向查误拒**：修复引入的严格化（preview 后 final 全弃、Cf/Zl/Zp 剥离、写入双守卫）会不会
   误伤合法行为——合法 final（waiting-final 内 seq 更大）、合法组合字符文本（中文/emoji/带重音）、
   WS OPEN 下的 autoEnter、cancel 后再按的正常新轮。逐格给证据。
3. **恒真测试红验抽查**：抽 2-3 条修复轮新增测试，在 `5eeef33`（修复前）checkout 上仅拷入
   该测试文件运行，必须红；绿 = 恒真按缺失测试提报。
4. **F1 修复的迁移完备性**：「任意状态 → cancelled」的新合法来源集合是否覆盖全部非 idle 状态
   （含 error），还有没有第三个状态会抛 Invalid mic transition——穷举 state × visibilitychange。

## 非目标

- 不修改被审代码；不审 base 存量；不重复第 1 轮已修复 findings（verdict 在
  docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review1-verdict.md，仅历史线索）。
- 不审 src/asr/ 引擎本体（增量 1 已收敛）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同第 1 轮（设计文档 v5、inc2 卡轴表）；与文档化契约冲突的意见须
  先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：5659515（origin/main；审查范围 = `11e2a7d..bd9aaeb`，重点 `5eeef33..bd9aaeb`）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`11e2a7d..bd9aaeb` 全量，重点 `5eeef33..bd9aaeb`。冻结 SHA，新提交作下一轮输入。

## 修改边界

- **允许**：仅新增 `docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review2-verdict.md`；
  红验用临时 worktree/目录（不进 git、不改被审分支）。
- **禁止**：被审分支任何受跟踪文件的修改。
- **Scope-Globs**：docs/sessions/260820-asr-ptt-inc2/**

## 完成条件

- **行为验收**：上述四视角逐项给结论表（拆穿输入 × 实测 × 证据文件:行）；
  误拒穷举表（合法输入 × 是否被误拒）；红验结果表；F1 迁移完备性穷举。
  每条 finding：级别、溯源 spec、证据。P1 过两问。
- **verdict 产出**：`docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review2-verdict.md`
  （只新增），结尾一行收敛判定「本轮新增 P1：0 / N」。
- **相关测试**：可只读运行 `pnpm test` / 定点 vitest / playwright chromium 项目。
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
  HEAD bd9aaeb。主脑 H0..H1 增量审四问已过；抽跑 621 tests 绿、check/lint:ox/lint:knip 全绿。
  修复报告（8 条闭环 + 红绿证据）在 delegate state，主脑已核对要点。以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git log --oneline 5eeef33..bd9aaeb`，
  从 F1 的 `src/controls/mic-controller.ts` cancelSession 新迁移表开始核验。
