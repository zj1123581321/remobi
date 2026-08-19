# 任务卡：增量 4 —— moshi 式悬浮 d-pad + drawer 显式关闭按钮

## 目标

1. **悬浮 d-pad**：moshi 式浮窗方向键簇。toolbar 新增 ✥ 切换键，点按弹出/收起浮窗；浮窗键：← ↑ ↓ → ⌫ ⏎。toolbar 默认名单中的 ↑ ↓ 移入浮窗（⏎ 保留在 toolbar——manual 键盘/ASR 时代的第一发送键；浮窗内也放一个 ⏎ 对齐 moshi）。
2. **drawer 显式 × 关闭按钮**：抽屉把手区右侧加一个可见的 × 按钮，点按关闭 drawer（现有 backdrop 点按与把手下滑保留）。

**背景（用户真机实测结论）**：herdr 虽 mouse-first，但手机屏幕小、直点不方便；用户明确要 moshi 式浮窗（参照：moshi 底栏上方的 7 键簇 ⌫↑🧹/←⏎→/↓）。双击 C-c 退 agent 已验证通过（增量 3 的 8 键布局已含 C-c 专用键）。

## 任务清单

1. **新 action 成员** `{ type: 'dpad-toggle' }`：`src/types.ts` ButtonAction union + `src/config-schema.ts` + `src/actions/registry.ts` dispatch（DI 模式同 keyboard-toggle：`context.toggleDpad ?? deps.toggleDpad`，缺失 fail-loud console.error + 按钮错误态）。
2. **d-pad 控件**（新文件 `src/controls/dpad.ts`）：
   - 默认隐藏，toggle 弹出/收起；位置：toolbar 上方居中或右对齐（参照 moshi），z-index 低于 drawer、高于终端。
   - 键位 6 个：←(\x1b[D) ↑(\x1b[A) ↓(\x1b[B) →(\x1b[C) ⌫(\x7f) ⏎(\r)，触摸目标 ≥48px，半透明深色底，圆角簇状排布（上排 ⌫ ↑ 可右补空位，中排 ← ⏎ →，下排 ↓）。
   - **焦点安全（硬要求）**：d-pad 按钮不得抢终端焦点——touchend preventDefault（增量 2 的 `decorateKeyboardToggleButton` 处理的就是同一竞态；复用或提取等价防护，注意它现在带 keyboard-toggle 专属 class，别直接复用 class）。manual 键盘模式下点 d-pad 不得改变键盘锁定状态。
   - 发送走 `sendData(term, ...)`（`term.input` 路径，与键盘锁定语义无冲突）。
3. **toolbar 默认名单**（`src/config.ts` defaultRow1）：Esc / C-c / Tab / ⏎ / ✥(`dpad-toggle`) / ⌨ / ☰More，7 键。↑ ↓ 从 row1 移除——它们现在由 d-pad 提供，**并进 drawer 默认列表兜底**（drawer 已有 left/right，补 up/down——等等，drawer 增量 3 只收了 ← →，↑ ↓ 本来在 row1，这次需新增进 drawer）。
4. **drawer × 关闭按钮**：`src/drawer/drawer.ts` 把手区右侧加可见 ×（≥44px），onTap → close()；`styles/base.css` 配套样式。现有 backdrop 点按与把手下滑关闭保留不动。
5. **文档同步**：README（toolbar 名单、d-pad 说明）、`.agents/skills/remobi-setup/SKILL.md`（键位表、action 表加 dpad-toggle）、`cli.ts` init 模板注释、`AGENTS.md`（如 module layout 涉及）。

## 非目标

- 浮窗拖动换位、位置配置、🧹清屏键——不做。
- E1 键盘弹起布局稳定化、E2 双指手势——Deferred 不动。
- 服务端零改动；不改 CHANGELOG。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：450
- **Diff-Lines-Hard**：800
- **阶段**：implementing
- **锁定决策**：toolbar 7 键名单（Esc/C-c/Tab/⏎/✥/⌨/☰）；d-pad 六键（←↑↓→⌫⏎）；⏎ 同时保留在 toolbar（用户沟通结论：发送键不进二级入口）；d-pad 按钮焦点安全必须 touchend 防抢焦；drawer × 为新增关闭路径不移除现有路径；fail-loud 红线同前。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：origin/main（增量 3 合并后的 HEAD，开工前先 fetch 确认）
- **Branch/Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器角色声明**：本会话就是执行器（implementer），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径。
- **计划者与审查者**：主脑会话（拆卡 + 验收）；review 终审另派

## 修改边界

- **允许**：`src/types.ts`、`src/config.ts`、`src/config-schema.ts`、`src/actions/registry.ts`、`src/controls/dpad.ts`（新建）、`src/controls/keyboard-controller.ts`（仅如需提取防抢焦 helper）、`src/toolbar/toolbar.ts`、`src/drawer/drawer.ts`、`src/index.ts`（接线）、`styles/base.css`、`cli.ts`（仅 init 模板）、`README.md`、`.agents/skills/remobi-setup/SKILL.md`、`AGENTS.md`、`tests/*.test.ts`、`tests/playwright/*.spec.ts`。
- **禁止**：`.github/workflows/`、`src/serve.ts`、`src/session.ts`、`src/session-protocol.ts`、`src/client-entry.ts`、`CHANGELOG.md`、`docs/` 下任何文件。
- **高风险区域**：d-pad 的 touchend 防抢焦与 keyboard-toggle 的竞态修复是同一机理，别引入双路径；横屏规则别误伤 d-pad；`multi-client.spec.ts` 刚迁到 isolated-serve，别动它。

## 完成条件

- 任务清单 1-5 全落地；行为验收：✥ 切换浮窗显隐、六键发送正确字节、点 d-pad 不抢焦点不弹键盘（manual 下锁定不松）、toolbar 7 键渲染、↑↓ 在 drawer 可达、drawer × 可关。
- **验证（CI 完整电池，全量禁子集）**：`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist`、`pnpm run lint:knip`（需先 build:dist）、`pnpm run lint:publint`、`pnpm run lint:ox`、`pnpm run test:pw`（chromium；本机 flake 时单跑复验并注明）。注意 `pnpm test | tail` 会掩盖退出码，用 `pnpm test > log 2>&1; echo $?` 或看 Tests 汇总行。
- 新增/重写测试：dpad-toggle dispatch（含 fail-loud）、浮窗显隐、六键字节、焦点安全（touchend defaultPrevented）、toolbar 7 键名单、drawer ↑↓ 可达、drawer × 关闭。
- **提交纪律**（固定条款）：小步 commit（①action+schema；②dpad 控件+样式+焦点安全；③toolbar 名单+drawer 兜底；④drawer ×；⑤测试；⑥文档），Conventional Commits，主提交 `feat(controls): ...`，body 注明 ButtonAction union 扩展（dpad-toggle）对 TS 消费者 exhaustive switch 的影响与默认名单变化。未提交按未完成。不 push、不开 PR、不合 main。
- **红验安全**（固定条款，原样保留）：红验改坏前先 commit 已验证修复，还原只许还原刚改坏的那一处。
- **执行器自声明 outcome**（固定条款）：报告首行前恰好一行 `<!-- delegate-outcome: succeeded -->` 或 `<!-- delegate-outcome: failed -->`。

## 当前状态

- **现场事实（主脑预取）**：增量 3 已把 toolbar 收成单行（Esc/C-c/Tab/↑/↓/⏎/⌨/☰，row2 默认空）、swipe 默认关、字号 13 + localStorage 持久化（键 `remobi:fontSize`，共享常量 `FONT_SIZE_STORAGE_KEY` 在 `src/actions/registry.ts`）、drawer font-size/help 连点不关。`decorateKeyboardToggleButton`（touchend 防抢焦 + marker class）在 `src/controls/keyboard-controller.ts`，toolbar/drawer/floating 三处调用。e2e 基建：multi-client 已用 `tests/playwright/isolated-serve.ts` 独立 server；prefix spec 走 drawer 路径。
- **已否决**：浮窗拖动/位置配置；🧹清屏键；⏎ 移出 toolbar。
- **下一步唯一动作**：任务清单 1（dpad-toggle action 成员）。
