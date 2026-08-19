# 任务卡：ASR 增量 1 独立 review 第 4 轮（安全/配置面 + 跨文档契约一致性）

## 目标

对增量 1（ASR 引擎核心）做第 4 轮独立审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。

**收敛计数背景**：第 1-3 轮共 5 条 P1 全部闭环（最近一条：starting 阶段 opened-WS close 静默吞，
修复 = onclose 补 starting 分支 fail-loud，efa5bd7..397e3d6）。仓 internal + infra 提档，
收敛条件 = 连续 2 轮无新增 P1。**若本轮 0 新增 P1，是第 1 个计数轮。**

**本轮新证据**（前三轮未用作主输入）：
- 修复增量 `efa5bd7..397e3d6`（onclose starting 分支 + stopping 拒绝路径两测试格）；
- 安全/配置面与发布链此前从未作为主视角（第 1 轮全量扫过但未深挖）。

**本轮视角（与前三轮不同——正向 spec / 反向误拒 / 运行时压力都已做过）**：
1. **密钥流全链路**：config 文件 → defineConfig/merge/validate → `__remobiConfig` 内联（build.ts）→
   浏览器 JS → engine query 拼接。逐跳问：哪一跳可能把 apiKey 值打进日志/错误信息/校验输出/
   sourcemap/dist 注释/网络面板以外的持久化？redact 是否覆盖所有 schema 报错路径
   （嵌套、数组、union、父对象替换、merge 冲突）？
2. **CSP/permissions-policy 攻击面**：asr.enabled 两态的 header 字节级正确性；
   enabled 时放开的 `wss://openspeech.bytedance.com` 是否单 origin 无通配；
   worklet 路由 enabled/disabled 语义与 CSP 是否自洽；`?v=` 参数与 cache-control 组合有没有
   缓存投毒或旧版本资产残留窗口。
3. **跨文档契约一致性**：设计文档 v5、spike 结果文档、inc1 卡、fix1 收口卡、实现、测试——
   六者之间找漂移（例：文档说 X，实现做 Y，测试断 Z）。每条漂移注明哪份文档滞后。
4. **发布链**：tsdown 输出（dist/*.mjs + *.d.mts）是否包含 src/asr 全部公共面；
   `files[]` 是否带上 dist/asr-worklet.js；类型导出有没有把浏览器专用类型漏给 Node 消费者
   或反之；`pnpm pack` 内容清单核对。

## 非目标

- 不修改被审代码；不审 base 存量；不重复前三轮已闭环 findings
  （三份 verdict 在 docs/sessions/260819-asr-engine-inc1/reviews/，仅历史线索）。
- 不再做状态机交错压力（第 3 轮 400 序列已覆盖）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：spec 输入同前轮（设计文档 v5、spike 结果文档、inc1 卡、fix1 收口卡 I1-I6）；
  C8 密钥威胁模型已裁决（单人自部署，密钥下发浏览器可接受）——「密钥出现在浏览器 JS」本身
  不是 finding，「密钥出现在不该出现的输出通道」才是。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；被审分支已 push，`git fetch origin && git checkout 397e3d6`
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 审查对象（H0 冻结）

`c23d8e7..397e3d6` 全量。冻结 SHA，新提交作下一轮输入。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review4-verdict.md`
- **禁止**：其它一切写入。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**

## 完成条件

- **行为验收**：
  1. 密钥流逐跳表：每跳的处理 + 会不会泄露 + 证据（文件:行）；
     redact 路径形态穷举（至少：叶子字段、父对象字符串替换、嵌套缺失、merge 后非法类型）。
  2. CSP 两态字节级对照表 + enabled 时放开面评审（单 origin/无通配/最小权限）。
  3. 跨文档漂移表：每条注明文档 A 说 X / 实现做 Y / 处置建议（改文档 or 改代码 or 接受）。
  4. 发布链核对：`pnpm pack --dry-run` 内容清单、dist 类型导出面、worklet 资产在包内。
  5. 每条 finding：级别、溯源 spec、证据。P1 过两问（真实使用触发 + 后果不可接受）。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review4-verdict.md`
  （只新增）。
- **相关测试**：可只读运行 `pnpm test` / `pnpm pack --dry-run` / 定点 vitest。
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
  HEAD 397e3d6。主脑抽跑 573 tests 绿、lint:ox 0 errors。三份历史 verdict 在 main。
  状态机迁移表 engine.ts:325-342；redact 在 config-validate.ts；CSP 在 serve.ts
  buildSecurityHeaders。以上不构成你的结论。
- **下一步唯一动作**：`git fetch origin && git checkout 397e3d6`，
  从 `src/config-validate.ts` 的 redact 路径穷举开始。
