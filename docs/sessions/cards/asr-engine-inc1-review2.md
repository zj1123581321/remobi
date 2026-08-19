# 任务卡：ASR 增量 1 独立 review 第 2 轮（反向视角 + 修复闭环核验）

## 目标

对增量 1（ASR 引擎核心）做第 2 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**本轮新证据**（相对第 1 轮，第 1 轮冻结在 `..50a2207`、正向 spec 符合性视角）：
修复增量 `50a2207..d74239f`（5 个 fix commit：binaryType、epoch/stop 串行化、port 在途背压、
mock 真帧驱动、删熵增包装）及其新增的交错时序/红验测试。第 1 轮没看过这些内容。

**本轮视角（与第 1 轮不同，别再走正向 spec 符合性老路）**：
1. **修复闭环核验**：第 1 轮 2 条 P1（binaryType 缺省 Blob、flushWaiter 竞争卡死）与 3 条 P2
   的修复是真闭环还是换形态——逐条构造「如果修复是假闭环，哪个输入能拆穿它」并实际跑测试验证。
2. **反向查误拒**：修复引入的严格化（RangeError 抛掷、malformed 拒绝、epoch 失配丢弃、
   apiKey 必填）会不会误伤合法输入——合法帧/合法配置/合法时序被错误拒绝的路径。
3. **恒真测试红验抽查**：抽 2-3 条修复轮新增测试，在 `50a2207`（修复前）checkout 上仅拷入
   该测试文件运行，必须失败（红）；在 base 上也绿的测试是恒真测试，按缺失测试处理。
4. **epoch 机制本身**：新增的 epoch/stopPromise 状态在单实例多轮 start/stop/fail 交错下的
   一致性——修复 P1 的机制是否引入了新竞态（如 epoch 递增时机、stopPromise 清理时机、
   dispose(epoch) 失配跳过导致的资源泄漏）。

## 非目标

- 不修改被审代码；不审 base（c23d8e7）之前的存量。
- 不重复第 1 轮已修复并核验的 findings（ verdict 见
  `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review1-verdict.md`，
  该文件只是历史线索，不构成你的结论）。
- 不重复主脑已分诊的 OCR findings（同第 1 轮卡清单，docs/sessions/cards/asr-engine-inc1-review1.md）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同第 1 轮（设计文档 v5、inc1 卡、spike 结果文档）；与文档化契约
  冲突的意见须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git diff c23d8e7..d74239f`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收；本卡执行器即审查者

## 审查对象（H0 冻结）

全量范围 `c23d8e7..d74239f`，重点增量 `50a2207..d74239f`。冻结 SHA，后续新提交统一作下一轮输入。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review2-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**

## 完成条件

- **行为验收**：
  1. 修复闭环核验（上述视角 1）逐条给结论：真闭环 / 假闭环（证据：文件:行 + 触发路径）。
  2. 误拒路径穷举（视角 2）：对 protocol 严格校验、pcm RangeError、config 必填、epoch 丢弃
     各给一张「合法输入 × 是否被误拒」表，每格有证据。
  3. 恒真测试红验（视角 3）：至少抽 2 条修复轮新增测试在 `50a2207` 上实跑，结果写进 verdict
     （红 = 有效测试；绿 = 恒真，按 P1 缺失测试提报）。
  4. epoch 机制竞态分析（视角 4）：列出 start/stop/fail 交错时序里 epoch 状态迁移表，
     指出任何不一致窗口（有则给触发路径，无则给穷举依据）。
  5. 每条 finding：级别（P1/P2/P3）、溯源 spec、证据。P1 过两问（真实使用触发 + 后果不可接受）。
     仓 risk-tier internal + infra 提档（收敛：连续 2 轮无新增 P1，上限 8 轮）。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review2-verdict.md`
  （只新增），结构：verdict（pass/fail）、修复闭环核验表、误拒穷举表、红验结果、findings、backlog。
- **相关测试**：可只读运行 `pnpm test` / 定点 vitest / 在 50a2207 的 git worktree 上跑红验
  （worktree 内新建临时目录可以，禁止改被审分支文件）。
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
  HEAD d74239f。主脑 H1..H2 增量审四问已过；559 tests 绿、lint:ox 0 errors（主脑抽跑）。
  第 1 轮 verdict=fail（2 P1 + 3 P2）已全部修复并先红后绿。以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git log --oneline 50a2207..d74239f`，
  从 ad58e92（binaryType）的修复闭环核验开始。
