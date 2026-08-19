# 任务卡：键盘主权增量 2 —— keyboardMode manual + keyboard-toggle + 逃生入口

## 目标

实现 moshi 式键盘主权：新增 `mobile.keyboardMode: 'auto' | 'manual'`（默认 `auto`），manual 下点终端任何位置不弹软键盘，只有显式的 ⌨ keyboard-toggle 按钮能唤起/收起键盘。产出本项目的第二个 minor 发布增量。

**权威规格（必读）**：
- `docs/designs/keyboard-sovereignty.md`（v3，在 git）——「增量 2」节与 Scope Decisions 表（T-A/T-B/T-E/V1/V2/V3/V6）逐条执行，冲突以它为准。
- `docs/sessions/260818-kb-spike-results.md`（主仓绝对路径 `/home/zlx/projects/oss/remobi/docs/sessions/260818-kb-spike-results.md`，未进 git，worktree 里用绝对路径读）——增量 0 spike 定案，**机制与时序结论以此为准**。

## Spike 定案摘要（实现硬依据，不得偏离）

1. **机制 = `inputmode="none"`**（Android Chrome 实证：程序 focus 与真实触摸均不弹键盘；textarea 保持可编辑）。不做 readonly，不做运行时探测回退。
2. **锁定时序：先 `blur()` 再设抑制属性**（仅改属性收不掉已弹键盘，实证）。解锁：清属性后在用户手势内 `term.focus()`。
3. **键盘可见性检测**：`window.innerHeight - visualViewport.height > 150`，只驱动指示器。
4. iOS Safari / 实体键盘未验证（无设备）——按设计文档标 known-unknown，代码不为它们写分支。

## 非目标

- 服务端 `src/serve.ts` / `src/session.ts` / `src/session-protocol.ts` 零改动。
- E1 键盘弹起布局稳定化、E2 双指手势层、scrollButtons 位置配置——设计文档 Deferred 项，一律不做。
- keyboardMode 暴露为 hook（设计文档显式否决）。
- 不改 CHANGELOG.md；不 push、不开 PR。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：900
- **Diff-Lines-Hard**：1600
- **阶段**：implementing
- **锁定决策**（不得重开）：
  - 机制 inputmode="none" 单点封装在 `src/client-entry.ts` 的 term bridge（Eng-2：XTerminal 语义扩展 `setKeyboardSuppressed(suppressed)` + `onFocusChange(cb)`，不暴露裸 textarea）。
  - 三信号状态模型（T-B）：`inputPermission` 唯一事实源；`textareaFocus` 事件跟踪；`keyboardVisible` 只驱动指示器。系统手势收键盘 → permission 不变（锁从未松开，无「重新上锁」迁移）。
  - `keyboardMode` 默认 `'auto'`；auto 下 ⌨ = 瞬时控制（focus/blur），无 permission 概念；指示器 auto 跟 keyboardVisible、manual 跟 inputPermission（V1）。
  - keyboard-toggle 默认挂 toolbar row2 最右；横屏 `wt-kb-open` 隐藏 row2 规则对其豁免。
  - 逃生入口（V2）：init 渲染前检查解析后按钮全集，manual 且无 keyboard-toggle → 注入 toolbar row2；**config-resolve 保持纯函数**。
  - 共享状态控制器（T-E#4）：单一 controller + 订阅，ActionRegistry 不碰 DOM。
  - 连点 ~300ms 防抖；fail-loud：机制不可用 → 按钮错误态 + reconnect 式 overlay，禁止静默退回 auto。
  - `ButtonAction` union 扩展按 minor 发布，feat commit body 注明 TS 消费者 exhaustive switch 需补分支。
  - row2 窄屏修复（V2 附带）：row2 加 min-width/overflow-x auto，320px 下按钮 ≥44px 或可横滑。
- **任务类型**：frontend-ui
- **复杂度**：L
- **Base commit**：e8b9ba6（origin/main HEAD，含增量 1 合并；本地 main 落后是有意的，以 origin/main 为准）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器与模型**：由 delegate 派发（frontend 类，预期 kimi），按 envelope 实际值
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑会话（拆卡 + 验收）；review 终审另派

## 修改边界

- **允许**：
  - `src/types.ts`、`src/config.ts`、`src/config-schema.ts`、`src/config-validate.ts`、`src/config-resolve.ts`（只读参考，保持纯函数，不删逃生入口禁令）
  - `src/actions/registry.ts`、`src/client-entry.ts`、`src/index.ts`
  - `src/controls/`（可新建 keyboard-toggle 控制器文件）、`src/toolbar/toolbar.ts`
  - `src/hooks/registry.ts`（仅在确需扩展 hook payload 时，需报告理由）
  - `styles/base.css`
  - `cli.ts`（仅 init 模板注释）
  - `README.md`、`.agents/skills/remobi-setup/SKILL.md`、`AGENTS.md`（module layout/conventions 同步）
  - `tests/*.test.ts`（含新建）、`tests/playwright/*.spec.ts`（含新建契约测试）
- **禁止**：`.github/workflows/`；`src/serve.ts`、`src/session.ts`、`src/session-protocol.ts`；`CHANGELOG.md`；本卡文件自身与 `docs/` 下任何文件；任何未列入「允许」的文件。
- **高风险区域**：
  - `src/client-entry.ts` 被覆盖率排除（`vitest.config.ts`）——bridge 的 inputmode 封装**必须**有 Playwright 契约测试（V6#8）：断言真实 textarea 的 suppressed 属性、focus/blur 事件、按钮发送产生 WS input payload；mock 测试不构成接线证据。
  - `src/index.ts` 初始化顺序：keyboard controller 必须在 toolbar/drawer 创建前可用（action dispatch 依赖）；逃生入口注入发生在渲染前。
  - 横屏豁免：`styles/base.css` 里 `wt-kb-open` 隐藏 row2 的既有规则，keyboard-toggle 按钮要豁免，别误伤其他 row2 按钮的横屏行为。
  - 增量 1 刚把 font-size/help action 接进 registry 并加了按钮错误态（`c5afff9`），keyboard-toggle 复用同一 DI 与 fail-loud 模式，别另起炉灶。

## 完成条件

- **行为验收**（对照设计文档「增量 2」节逐条）：
  1. `mobile.keyboardMode: 'auto' | 'manual'` 进 types + valibot schema + defaults，默认 `'auto'`。
  2. `ButtonAction` 新增 `{ type: 'keyboard-toggle' }` + schema + registry dispatch（DI 模式同 font-size/help）。
  3. XTerminal 语义扩展（`setKeyboardSuppressed` + `onFocusChange`），client-entry bridge 单点实现 inputmode="none" 机制；锁定时序 blur→设属性。
  4. 三信号状态模型 + 单一 controller + 订阅；manual 下 inputPermission=false 时 textarea 恒不可输入；系统手势收键盘不改变 permission。
  5. keyboard-toggle 默认按钮挂 toolbar row2 最右；auto 瞬时控制 / manual 许可切换；指示器按 V1 分叉；300ms 防抖；横屏豁免。
  6. 逃生入口：manual 且无 keyboard-toggle → init 注入 row2；config-resolve 纯函数不破。
  7. row2 窄屏修复（min-width / overflow-x auto，320px 验收）。
  8. fail-loud：机制不可用 → 按钮错误态 + overlay；无静默回退。
  9. README / SKILL.md / `remobi init` 模板 / AGENTS.md 同步。
- **相关测试**（全量路径，禁子集过滤）：
  - `pnpm test`：schema（keyboardMode）、action dispatch、三信号迁移穷举（**含★系统收键盘 permission 不变★**）、auto/manual 指示器分叉、逃生入口注入 row2、横屏豁免、防抖。
  - `pnpm run test:pw`：既有 e2e 不红 + 新增 client-entry 契约测试（suppressed 属性 / focus/blur / WS input payload）。本机环境不支持就报告如实说明，不谎报。
  - 模拟器真机冒烟（如 delegate 环境可用 AVD `remobi`，启动命令见 spike 文档 §增量 2 复用要点）：manual 全迁移 + auto 瞬时控制 + 系统手势后锁定保持。不可用则留待主脑验收。
- **lint / typecheck / build**：`pnpm run check` + `pnpm run build:dist` + `pnpm exec tsc --noEmit`（如仓库有该 script 用 script）全绿。
- **现场还原**：收工 checkout 停在 card 分支，全部工作已 commit；不 push、不开 PR、不合 main。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  - 具体化强化：按 ①types+schema+defaults；②XTerminal 扩展 + client-entry 机制；③状态 controller + registry dispatch；④toolbar 按钮 + 指示器 + 横屏豁免 + row2 窄屏；⑤逃生入口；⑥测试（happy-dom + pw 契约）；⑦文档同步 分**至少 6 次**提交。Conventional Commits，主提交 `feat(mobile): ...`，body 注明 ButtonAction union 扩展影响。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个二级标题之前，必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，从下面两行中选一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  值域只有 succeeded / failed 两个；描述执行器本次任务是否完成，与 review verdict 正交。

## 当前状态

- **现场事实（主脑预取）**：
  - origin/main = `e8b9ba6`（PR #1 已合并，增量 1 全量在 main；CI 绿）。
  - 增量 1 落地物：`ButtonAction` 现有 8 成员（含 `font-size`/`help`）；registry 有 DI（`ActionExecutionContext` 带 FontConfig/openHelp）与按钮错误态；`scrollButtons.enabled` 默认 false；safe-area 已补。
  - `MobileConfig` 现两字段（`src/types.ts:94-99`：initData/widthThreshold）；toolbar 现 row1+row2 结构（`src/toolbar/toolbar.ts:190-226`）；XTerminal 接口在 `src/types.ts:201` 附近有 `focus()`；term bridge 在 `src/client-entry.ts:45-95`。
  - 增量 1 的 12 个 commit 在 main 上可查（`git log e8b9ba6 --oneline -15`），DI/错误态模式直接抄。
- **已完成**：设计文档 v3（0 未决）；增量 1 合并；增量 0 spike（机制定案 inputmode=none + 时序结论）。
- **未完成**：增量 2 全部实现。
- **已否决方案**：readonly 回退（spike 实证不需要）；inputmode 运行时探测（V3）；keyboardMode 暴露 hook；三信号之外的状态机。
- **下一步唯一动作**：按「完成条件」①开始实现（`mobile.keyboardMode` 进 types + schema + defaults）。
