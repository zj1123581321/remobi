# 任务卡：键盘主权增量 1 —— 控件移入 drawer + scrollButtons 默认关 + safe-area

## 目标

把悬浮在终端右上角的字体控件（`− + ?`）和右边缘滚动按钮从终端内容上移走：字体/帮助功能搬进命令抽屉，滚动按钮默认关闭。根治「悬浮按钮遮挡 herdr/zellij TUI 控件」缺陷，产出本项目的第一个 minor 发布增量。

**权威规格（必读，逐条执行）**：`docs/sessions/260818-1406-keyboard-sovereignty-inc1.md`（已在 git，base 即含）。
冲突时以 `docs/designs/keyboard-sovereignty.md` 的 Scope Decisions 表为准。本卡不重复规格全文，只补边界与验收。

## 非目标

- 增量 2（键盘主权 / keyboardMode / keyboard-toggle / 逃生入口）——一律不做，不要提前实现。
- 增量 0 spike（真机探针）——不做。
- 服务端 `src/serve.ts` / `src/session.ts` / `src/session-protocol.ts` 零改动。
- config-resolve 保持纯函数，不加逃生入口逻辑。
- 不改 CHANGELOG.md（semantic-release 自动）；不 push、不开 PR。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：700
- **Diff-Lines-Hard**：1200
- **阶段**：implementing
- **锁定决策**（不得重开）：
  - fail-loud：任何失败路径禁止静默（无 console-only 之外的静默、无被忽略的 return false、无静默回退）；未注册/未接 handler 的 action 必须 console.error + 按钮错误态。
  - 新 drawer 帮助按钮 label 用 `Guide`（避免与已有 `tmux-help` 的 'Help' 同名）。
  - `scrollButtons.enabled` 默认 `false`，保留配置可开；不做位置配置。
  - `ButtonAction` union 扩展按 minor 发布，feat commit body 注明 TS 消费者 exhaustive switch 需补分支。
  - help overlay fail-safe 约定：help 失败不得拖死核心控件。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：bd8734bba29169602acb46372e9fca0ac5b56a2e（本地 main HEAD；含 3 个未 push 的 docs commit，即设计文档与本规格，属有意基线）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器与模型**：由 delegate 派发（frontend 类，预期 kimi），按 envelope 实际值
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑会话（拆卡 + 验收）；review 终审另派

## 修改边界

- **允许**：
  - `src/types.ts`、`src/config.ts`、`src/config-schema.ts`、`src/actions/registry.ts`
  - `src/controls/font-size.ts`、`src/controls/help.ts`、`src/index.ts`
  - `src/util/tap.ts`（仅注释 chore）
  - `styles/base.css`
  - `cli.ts`（仅 init 模板注释）
  - `README.md`、`.agents/skills/remobi-setup/SKILL.md`
  - `tests/*.test.ts`（含新建测试文件）、`tests/playwright/smoke.spec.ts`、`tests/playwright/touch.spec.ts`
- **禁止**：`.github/workflows/`；`src/serve.ts`、`src/session.ts`、`src/session-protocol.ts`；`CHANGELOG.md`；本卡文件自身与 `docs/sessions/` 下其他文件；任何未列入「允许」的文件。
- **Scope-Globs**：src/types.ts src/config.ts src/config-schema.ts src/actions/registry.ts src/controls/font-size.ts src/controls/help.ts src/index.ts src/util/tap.ts styles/base.css cli.ts README.md .agents/skills/remobi-setup/SKILL.md tests/*.test.ts tests/playwright/smoke.spec.ts tests/playwright/touch.spec.ts
- **高风险区域**：
  - `src/index.ts` 初始化顺序：help overlay 必须先于 drawer 可用（或 lazy 注入），删 `#wt-font-controls` 接线时不得拖死核心控件。
  - `tests/playwright/smoke.spec.ts:53` 与 `tests/playwright/touch.spec.ts:128` 引用 `#wt-font-controls`，必须改为 drawer 路径，否则 e2e 红。
  - 删除 `styles/base.css:91-119` 的 `#wt-font-controls` CSS 与新增 safe-area inset 在同一文件，别误删 `#wt-scroll-buttons`（378-401，保留元素只加控制）。

## 完成条件

- **行为验收**：规格文档「任务清单」1–9 全部落地——ButtonAction 两个新成员 + schema + dispatch DI（fail-loud）；`changeFontSize` 迁入 action handler 且 `#wt-font-controls` DOM/CSS 删除；drawer 默认新增 font − / font + / Guide 三项；help overlay 内 "Top-Right Controls" 文案改为 drawer 说明；`scrollButtons.enabled` 默认 false 可配置；safe-area 补 top/left/right inset 覆盖 `.wt-floating-group` top/right 方位类与 `#wt-scroll-buttons`；README / SKILL.md / `remobi init` 模板同步；`src/util/tap.ts` 注释 chore 单独 commit。
- **相关测试**（全量路径，禁子集过滤）：
  - `pnpm test`（vitest 全量）
  - 回归测试重写为强制项：`#wt-font-controls` 相关、helpButton 接线、drawer 默认列表断言随迁移重写；新增 font-size clamp 上下限、help fail-loud、scrollButtons enabled true/false、safe-area 样式断言。
  - `pnpm run test:pw`（playwright；若本机环境不支持则在报告中如实说明，不谎报）
- **跨发布边界不适用**：纯浏览器 overlay 层，同进程内改动，无 artifact/envelope 发布边界。
- **lint / typecheck / build**：`pnpm run check`（biome）+ `pnpm run build:dist`（tsdown）全绿。
- **截图或探活**：不要求。
- **现场还原**：收工 checkout 停在 delegate 分配的 card 分支，全部工作已 commit；不 push、不开 PR、不合 main。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  - 具体化强化：本卡按规格任务清单分 **至少 5 次**提交——①types+schema+registry DI；②changeFontSize 迁移 + DOM/CSS 删除 + 初始化顺序；③drawer 默认按钮 + help 文案；④scrollButtons + safe-area；⑤测试重写/新增；⑥文档三处；`src/util/tap.ts` 注释修正单独 `chore:` commit。Conventional Commits，主提交 `feat(controls): ...`，body 注明 ButtonAction union 扩展影响。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个二级标题之前，必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，从下面两行中选一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  值域只有 succeeded / failed 两个；描述执行器本次任务是否完成，与 review verdict 正交。

## 当前状态

- **现场事实（主脑预取）**：
  - `gh pr list`（open 与 merged --limit 10）均为空，无在途 PR。
  - 本地 main 领先 origin/main 3 个 commit，均为本任务的 docs（设计文档 + session 交接卡），已 fetch 确认。
  - `ButtonAction` 现 6 成员（`src/types.ts:2-8`）；`changeFontSize` 在 `src/controls/font-size.ts:8-15`；`#wt-font-controls` CSS 在 `styles/base.css:91-119`；`#wt-scroll-buttons` 在 `styles/base.css:378-401`；`tmux-help` label 'Help' 在 `src/config.ts:193`；help 文案 "Top-Right Controls" 在 `src/controls/help.ts:63`；`remobi init` 模板在 `cli.ts:263` 附近；`client-entry.ts` 被覆盖率排除（`vitest.config.ts:49`），本增量不碰它。
- **已完成**：设计文档 v3（双评审 + Codex 两轮 outside voice，0 未决）；session 交接规格。
- **未完成**：增量 1 全部实现。
- **已否决方案**：E3 ⋯ 收拢悬浮（被 T-C 移入 drawer 取代）；fontControls 配置体系；scrollButtons 位置配置；增量 2 一切内容。
- **下一步唯一动作**：按规格文档任务清单 1 开始实现（ButtonAction 两个新成员）。
