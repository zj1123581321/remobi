# Session 交接：键盘主权 + 终端内容零遮挡（增量 1 实现）

> 新 session 的执行卡。你是一个零上下文的执行会话，本文件包含开工所需的全部信息。
> 仓库：/home/zlx/projects/oss/remobi（main 分支，纯 TypeScript + DOM，xterm.js + Hono/node-pty）。

## 任务一句话

把悬浮在终端右上角的字体控件（`− + ?`）和右边缘的滚动按钮从终端内容上移走：字体/帮助功能搬进命令抽屉（drawer），滚动按钮默认关闭——根治「悬浮按钮遮挡 herdr/zellij TUI 控件」的缺陷。

## 唯一权威设计文档

`docs/designs/keyboard-sovereignty.md`（v3，已进 git）。本卡是它的执行摘要；**任何冲突以设计文档为准**。完整的决策链（CEO + Eng 双评审 + Codex 两轮 outside voice，全部 0 未决）记录在该文档的 Scope Decisions 表。

## 本次只做增量 1（第一个 minor 发布）

增量 2（键盘主权/manual 模式）**不在本 session 范围**——它依赖真机 spike 结论，另开 session。

### 任务清单（含验证方式）

1. **ButtonAction 新增两个成员**（`src/types.ts:2-8`）：
   - `{ type: 'font-size', delta: number }`（带参，复用 `send.data` 先例）
   - `{ type: 'help' }`
   - 同步 `src/config-schema.ts`（valibot strictObject 体系）与 `src/actions/registry.ts` dispatch。
2. **依赖注入**（Codex 实证缺陷，`src/actions/registry.ts:35` 现在 return false 被所有调用方忽略）：
   - `ActionExecutionContext` 扩展携带 `FontConfig` 与 `openHelp` 回调；
   - **未注册/未接 handler 的 action 必须 fail-loud**（console.error + 按钮错误态），禁止静默死按钮。
3. **迁移字体逻辑**：`changeFontSize`（`src/controls/font-size.ts:8-15`）原样迁入 action handler；删除 `#wt-font-controls` 的 DOM 创建（`src/index.ts`）与 `styles/base.css:91-119` 相关 CSS；help overlay 初始化顺序必须先于 drawer（或 lazy 注入）。
4. **drawer 默认按钮**（`src/config.ts`）：新增 font − / font + / Guide 三个默认项。**注意**：已有 `tmux-help` 的 label 是 'Help'（`src/config.ts:193`），新按钮 label 用 **Guide** 避免同名；help overlay 内 "Top-Right Controls" 硬编码文案（`src/controls/help.ts:63`）同步改为 drawer 说明。
5. **scrollButtons**：`enabled` 进 config schema，**默认 false**（手势滚动已覆盖；保留配置可开）。位置配置不做。
6. **safe-area**：`styles/base.css` 补 top/left/right 的 `env(safe-area-inset-*)`（bottom 已有，不重做），覆盖 `.wt-floating-group` 的 top/right 方位类与 `#wt-scroll-buttons`。
7. **回归测试重写（强制，非顺手）**：`#wt-font-controls` 相关测试、helpButton 接线测试、drawer 默认列表断言全部随迁移重写；新增 font-size clamp 边界（sizeRange 上下限）、help fail-loud、scrollButtons enabled true/false、safe-area 样式断言。测试用 happy-dom（既有 `tests/` 模式）。
8. **文档同步**：README config 段落、`.agents/skills/remobi-setup/SKILL.md`（仓规：config shape 变化必须同步 skill）、`remobi init` 模板（`cli.ts:263` 附近）加新配置项注释。
9. **顺手 chore（独立 commit）**：`src/util/tap.ts:20` 注释 "13 call sites" → 11。

### 验证（每个 PR 必跑，全绿才算完）

```bash
pnpm test            # vitest 全量
pnpm run check       # biome lint + format
pnpm run build:dist  # tsdown 发布构建
pnpm run test:pw     # playwright e2e（如环境支持）
```

### 提交纪律

- Conventional Commits：主提交 `feat(controls): ...`（消费者可见 → minor）；tap.ts 注释修正单独 `chore:` commit；**不要**手动改 CHANGELOG.md（semantic-release 自动）。
- feat commit body 注明：`ButtonAction` 新增公开 union 成员，TS 消费者 exhaustive switch 需补分支（已在 T-D/V5 决议按 minor 发布，此注记是承诺的一部分）。
- 小步提交，署名 `[kimi]`；`git add` 只写显式路径。

## 红线（评审中反复确认，不可违反）

- **fail-loud**：任何失败路径禁止静默（无 console-only、无 return false 被忽略、无静默回退）。
- **反过度设计**：不引入配置项/抽象除非本卡列明；无 fallback/重试/防御式 try-catch；新增行数预算 ≲350 行（不含测试）。
- **config-resolve 保持纯函数**：本增量没有逃生入口逻辑（那是增量 2 的），不要提前实现。
- help overlay 的 fail-safe 约定（AGENTS.md）：help 失败不得拖死核心控件。
- 服务端（`src/serve.ts`/`src/session.ts`）零改动——本增量纯浏览器 overlay 层。

## 已确认的代码事实（免去重新探查）

- `ButtonAction` 现 6 成员：`src/types.ts:2-8`；`ControlButton`：`src/types.ts:11-16`。
- `createTermBridge`：`src/client-entry.ts:45-95`（本增量不碰）。
- `changeFontSize`：`src/controls/font-size.ts:8-15`（纯逻辑，直接搬）。
- `createFontControls` 返回的 `helpButton` 在 `src/index.ts:139-145` 被 help 接线——删除时一并处理初始化顺序。
- `#wt-font-controls` CSS：`styles/base.css:91-119`；`#wt-scroll-buttons`：`styles/base.css:378-401`（保留元素，只加 enabled 控制与 safe-area）。
- `client-entry.ts` 被覆盖率排除（`vitest.config.ts:49`）——本增量不依赖它。

## 完成后

报告：改动文件清单、测试/检查命令输出摘要、行数统计、commit 列表。**不要 push、不要开 PR**，由主脑会话验收后决定。
