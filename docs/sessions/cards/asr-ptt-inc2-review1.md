# 任务卡：ASR 增量 2 独立 review 第 1 轮（full-scope：PTT 状态机 × 注入安全）

## 目标

对增量 2（PTT UI 与注入）diff 做独立全量审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

## 非目标

- 不修改被审代码；不审 base 存量（含 src/asr/ 引擎本体——增量 1 已 7 轮收敛，本轮只审其
  新消费方式）。
- 不重复主脑已分诊的 OCR findings（清单随卡附上，见「当前状态」）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：被审对象的 spec 即锁定项（见下「spec 输入」）；与项目文档化契约冲突的意见
  不能直接判 fail，须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：5659515（origin/main；**审查范围 = `11e2a7d..5eeef33`**——分支从
  11e2a7d 长出，main 中间的 5659515 只是任务卡文档提交，与 diff 无关）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git diff 11e2a7d..5eeef33`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`11e2a7d..5eeef33`（22 文件，~1411 行新增）。冻结 SHA，新提交作下一轮输入。

核心：`src/controls/mic-controller.ts`（PTT 状态机）、`src/controls/asr-preview.ts`、
`src/toolbar/`（voice-input 特判）、`src/client-entry.ts`（isConnected 暴露 + 注入链）、
`src/index.ts`（接线）、`src/types.ts`/`src/config-schema.ts`（action union/schema）、
`src/asr/types.ts`（backlog 注释 + stopped 移除）、`tests/`（状态机/sanitize/e2e）。

## spec 输入（意见须溯源，无法溯源默认降一级）

1. `docs/designs/asr-voice-input.md`：增量 2 节、PTT 状态机节、E3/E5/E6/E7、R1/R7、
   v5 #1-#5/#11/#12、错误路径节。
2. `docs/sessions/cards/asr-ptt-inc2.md`：完成条件、两张轴表（PTT 状态×事件、WS 态×注入）、
   锁定决策。
3. 仓 risk-tier：未声明，按 internal；改动核心是 mic-controller 状态机（失败路径/状态迁移）
   → infra 例外提档（收敛：连续 2 轮无新增 P1，上限 8）。
4. **P1 特别关注面**（注入文本 = 终端命令面）：`\r`/C0 经任何路径（含 fail-open hook、
   autoEnter、编辑后的 input 值、partial 累积）进入 sendData 即 P1。

## 修改边界

- **允许**：仅新增 `docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review1-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260820-asr-ptt-inc2/**

## 完成条件

- **行为验收**：
  1. 全量审 diff（不因 OCR 已跑缩小范围）：mic-controller 状态机交错（pointer 生命周期 ×
     engine 回调 × 超时 × generation）、sanitize 字节级完备性（C0 全谱/DEL/C1/零宽/组合字符）、
     注入链路（WS 非 OPEN 各形态、hook 重引入 `\r`、autoEnter 顺序、preview 编辑后值）、
     toolbar 特判对既有按钮零影响、e2e 真实性（routeWebSocket 桥真过协议帧、终端断言真读
     buffer 而非只断 sendData）。
  2. **降层三问**（写进 verdict）：①确认注入前已发生哪些不可逆动作（hooks 副作用/preview
     状态/已发 partial）在 cancel/WS 断开/编辑交错下是否成对？②守卫值（appliedSeq、
     generation、state）在单 controller 多轮会话（反复按-松-取消-再按）下自身一致吗？
     ③保护覆盖的是「写入」还是「行为」——sanitize 拦的是文本内容，但 autoEnter/编辑路径/
     hook 输出有没有绕过同一道 sanitize 的行为面？
  3. 熵增维度：每个新增抽象问「是不是熵 +1」。
  4. 每条 finding：级别（P1/P2/P3）、溯源 spec、证据（文件:行 + 触发路径）。P1 过两问。
- **verdict 产出**：`docs/sessions/260820-asr-ptt-inc2/reviews/asr-ptt-inc2-review1-verdict.md`
  （只新增），结构：verdict、findings 表、降层三问、backlog。
- **相关测试**：可只读运行 `pnpm test` 与定点 vitest/playwright 验证怀疑点。
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
  HEAD 5eeef33。主脑验收已过：scope（src/index.ts 接线为卡外必要集成点，主脑已确认）、
  614 tests 绿、check/lint:ox/lint:knip/build:dist 全绿、e2e 截图核验。
  OCR 前置扫描结果（status=reviewed，18 条，主脑已分诊）：
  - 核实为真、重点关注：sanitize 只剥离 C0/DEL/C1，未按 R1 正向定义剥离零宽/格式/BIDI/
    行分隔符（U+200B/U+2028/U+202A 等 Cf 与 Zl/Zp）——spec 正向定义是「仅保留可打印字符与
    空格」，请判定级别；waiting-final/preview 期用户编辑被迟到 final 覆盖（setPartial/
    setFinal clobber，注意设计 sanction「final 覆盖 preview」与编辑体验的边界）；sendData(text)
    与 autoEnter 的 `\r` 之间未复查 WS 状态（`\r` 可能滑入内存队列，违反 v5 #1）。
  - 核实为真、≤P2：voice-input 在 micController undefined 时被静默丢弃（registry-silent-false
    学习，应 fail-loud）；placement 校验错误路径未定位到具体按钮；onConnectionChange 新订阅者
    不同步当前态；error+close 重复通知。
  - 其余 low（zIndex 魔法数、input 属性、isolated-serve 细节等）按 backlog 处理，不必逐条提。
- **下一步唯一动作**：`git fetch origin && git diff 11e2a7d..5eeef33 --stat`，
  从 `src/controls/mic-controller.ts` 的 transition 表开始审。
