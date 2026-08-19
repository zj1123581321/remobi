# 任务卡：增量 3 —— moshi 式单行 toolbar + 字号三件套

## 目标

把两行 18 键的 toolbar 收缩为 moshi 式单行 10 键；默认字号 16→13；字号 localStorage 持久化；drawer 内 font-size 连点不关闭。产出第三个 minor 发布增量。

**背景证据（主脑真机实测反馈）**：手机驱动 CLI agent 的高频键是 Esc/Ctrl/Tab/↑↓/Enter/Paste/⌨/Prefix；字符键（q/Space/⌫/M-␣）由软键盘（manual 模式）与未来 ASR 覆盖；←→ 手机上几乎不用（滑动手势切窗口）。字号默认 16 太大；drawer 里点 font ± 会关 drawer 无法连点；字号刷新后丢失。

**参照**：`docs/designs/keyboard-sovereignty.md` 是本系列的设计文档（本卡是它的后续增量，未逐条进设计文档的决策以本卡为准）。

## 任务清单

1. **toolbar 单行化**（`src/config.ts` defaults）：
   - `defaultRow1` 改为 10 键（顺序即渲染顺序）：Esc(`send \x1b`)、Ctrl(`ctrl-modifier`，机械已存在于 `src/toolbar/toolbar.ts` 的 CtrlState/activateCtrl)、Tab、Prefix、↑、↓、Enter、Paste、⌨(`keyboard-toggle`)、☰More(`drawer-toggle`)。
   - `defaultRow2` 改为空数组；toolbar 渲染跳过空行（现在恒渲染两行）。
   - 砍掉的键（S-Tab/←/→/C-c/C-d/q/M-␣/Space/⌫）进 drawer 默认列表兜底（drawer 已有大部分，补齐缺的，保持用户可达）。
   - **逃生入口注入点改 row1 末尾**（`src/controls/keyboard-controller.ts` 的 `withKeyboardEscapeHatch`，原注 row2 是因 row2 必有内容；现在 row1 是主行）。同步改测试。
   - 横屏规则（`styles/base.css` 的 `@media (orientation: landscape)` 里 `#wt-toolbar.wt-kb-open .wt-row:last-child` 隐藏非 ⌨ 按钮）：单行形态下不得把整个工具行隐藏——改为仅当存在第二行时才隐藏第二行（或等价实现），写 CSS/DOM 断言测试。
   - row2 的 `overflow-x`/`min-width:44px` 规则保留并作用于单行（窄屏可横滑，增量 2 已有，别回退）。
2. **默认字号 13**：`src/config.ts` `mobileSizeDefault: 16 → 13`；全仓搜 16 的相关断言同步。
3. **字号持久化**：font-size action handler 变更后写 `localStorage['remobi:fontSize']`；init 应用字体时 localStorage 值优先于 config 默认（`src/index.ts` 现有 `term.options.fontSize = config.font.mobileSizeDefault` 处）。**批准一个窄 try/catch**：localStorage 读写（iOS 隐私模式抛异常是已知平台行为，属「已发生的失败」），catch 内 console.error 后按无缓存继续，禁止静默。
4. **drawer 连点**：`font-size` 与 `help` 类型 action 执行后不关闭 drawer（调节型/查阅型），其余 action 维持关闭。实现位置 `src/drawer/drawer.ts`。
5. **文档同步**：README（toolbar 默认布局 + 字号默认值 + 持久化行为）、`.agents/skills/remobi-setup/SKILL.md`、`cli.ts` init 模板注释、`AGENTS.md`（conventions/module layout 如有涉及）。

## 非目标

- 可收缩浮动 pill（用户已决：固定单行）。
- ASR 实现；E1 键盘弹起布局稳定化；E2 双指手势。
- 不改 toolbar 的 row1/row2 schema 形状（不删 row2 字段——只改默认值与空行渲染，schema 不变就不是 breaking）。
- 服务端零改动；不改 CHANGELOG。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：500
- **Diff-Lines-Hard**：900
- **阶段**：implementing
- **锁定决策**：单行 10 键名单（用户钦定）；默认字号 13；固定单行；localStorage 键名 `remobi:fontSize`；逃生入口注 row1 末尾；fail-loud 红线同前（未注册 action console.error + 按钮错误态）。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：`81cb468`（origin/main HEAD，含增量 1+2）
- **Branch/Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器角色声明**：本会话就是执行器（implementer），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径。
- **计划者与审查者**：主脑会话（拆卡 + 验收）；review 终审另派

## 修改边界

- **允许**：`src/config.ts`、`src/controls/keyboard-controller.ts`（仅注入点）、`src/toolbar/toolbar.ts`、`src/drawer/drawer.ts`、`src/actions/registry.ts`（仅持久化写入）、`src/index.ts`（仅字体初始化读取）、`styles/base.css`、`cli.ts`（仅 init 模板）、`README.md`、`.agents/skills/remobi-setup/SKILL.md`、`AGENTS.md`、`tests/*.test.ts`、`tests/playwright/*.spec.ts`、`_typos.toml`（如需）。
- **禁止**：`.github/workflows/`、`src/serve.ts`、`src/session.ts`、`src/session-protocol.ts`、`src/client-entry.ts`、`CHANGELOG.md`、`docs/` 下任何文件。
- **高风险区域**：横屏 CSS 规则别把整个单行隐藏；逃生入口注入点改动有三方测试引用（keyboard-mode.test.ts 的注入断言）；drawer 默认列表断言随迁移重写。

## 完成条件

- 任务清单 1-5 全落地；行为验收：单行 10 键渲染、空 row2 不渲染、横屏单行不消失、逃生入口注 row1、默认字号 13、调字号刷新后保持、drawer 内 font ± 连点不关闭。
- **验证（全量，禁子集）**：`pnpm test`、`pnpm run check`、`pnpm run build:dist`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip`、`pnpm run lint:publint`（typos 本机无二进制可跳过但注意别引入拼写词）、`pnpm run test:pw`（chromium；本机资源争用 flake 时单跑复验并在报告注明）。**这是 CI 完整清单，上一增量 knip 红线就是本地漏跑造成的**。
- 新增/重写测试：单行渲染、空行跳过、横屏单行、逃生入口 row1 注入、字号 13 默认、localStorage 写入/读取/优先级、drawer 连点不关闭（font-size/help）与其他 action 照常关闭。
- **提交纪律**（固定条款）：小步 commit（①toolbar 单行化+横屏规则；②逃生入口注入点；③字号默认+持久化；④drawer 连点；⑤测试；⑥文档），Conventional Commits，主提交 `feat(toolbar): ...`，body 注明默认值变化（单行名单/字号 13）对消费者的可见影响。未提交按未完成。不 push、不开 PR、不合 main。
- **红验安全**（固定条款，原样保留）：红验改坏前先 commit 已验证修复，还原只许还原刚改坏的那一处。
- **执行器自声明 outcome**（固定条款）：报告首行前恰好一行 `<!-- delegate-outcome: succeeded -->` 或 `<!-- delegate-outcome: failed -->`。

## 当前状态

- **现场事实（主脑预取）**：`defaultRow1` 现 10 键（`src/config.ts:38-95`：esc/tmux-prefix/tab/shift-tab/left/up/down/right/ctrl-c/enter）；`defaultRow2` 现 8 键（97-135：q/alt-enter/ctrl-d/drawer-toggle/paste/backspace/space/keyboard-toggle）；`mobileSizeDefault: 16`（:17）；ctrl-modifier 机械在 `src/toolbar/toolbar.ts`（CtrlState/activateCtrl）；逃生入口 `withKeyboardEscapeHatch` 在 `src/controls/keyboard-controller.ts`（注 row2 末尾）；changeFontSize 在 `src/actions/registry.ts`；横屏规则在 `styles/base.css` 的 `@media (orientation: landscape)` 块（`wt-kb-open .wt-row:last-child button:not(.wt-keyboard-toggle)`）。
- **已否决**：可收缩 pill；改 schema 形状；ASR 本增量实现。
- **下一步唯一动作**：任务清单 1（toolbar 单行化）。
