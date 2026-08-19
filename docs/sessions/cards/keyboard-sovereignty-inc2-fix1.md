# 修复反馈卡：增量 2 review 第 1 轮 —— 4 条 P2

独立 review（Codex，verdict 在 `docs/sessions/kb-sovereignty-inc2/reviews/inc2-review1-verdict.md`，先读它）判 fail：0 P1、4 条 P2。主脑已逐条复核，四条全部成立，按下面修。**只修这 4 条**； verdict 里 P3 与 backlog 其他项一律不动。

## P2-1：controller 未纳入 init dispose

`src/index.ts` 的 `dispose()` 闭包不消费 `keyboard.dispose()`。修：把 `keyboard.dispose()` 接入现有 dispose 路径。补测试：同页重复 init（或直接 dispose 后触发 visualViewport resize / focus 事件）旧 controller 不再收到事件。

## P2-2：auto 迁移读 keyboardVisible，违反 T-B

`src/controls/keyboard-controller.ts` auto 分支用 `keyboardVisible || textareaFocused` 决定 blur/focus。T-B：keyboardVisible 只驱动指示器、不参与迁移。修：auto 的迁移决策只依赖 textareaFocused（blur ↔ focus 瞬时切换），keyboardVisible 仅用于 `indicatorOn()`。补事件乱序测试（viewport resize 延迟到达不影响迁移选择）。

## P2-3：touchend 竞态修复只覆盖 toolbar

`keyboard-toggle` 配置进 drawer 或 floatingButtons 时：无 `touchend preventDefault`（解锁 focus 被合成 mousedown 抢走，permission 翻了键盘不弹），无 `wt-keyboard-toggle` class（指示器与 fail-loud 错误态都接不上）。修：
- touchend 防护与 `wt-keyboard-toggle` class 覆盖三处 renderer（`src/toolbar/toolbar.ts`、`src/drawer/drawer.ts`、`src/controls/floating-buttons.ts`）。现在有三个调用方，抽共享 helper 正当（放 `keyboard-controller.ts` 或 `util/`）。
- 指示器同步覆盖全部 `.wt-keyboard-toggle`（不限 toolbar 子树）；`reportKeyboardUnavailable` 的错误态标记同理。
- 补测试：drawer 内 ⌨ 的 touchend `defaultPrevented === true`；指示器/错误态同步到 drawer/floating 按钮。

## P2-4：逃生入口「存在 ≠ 可达」

`withKeyboardEscapeHatch` 把 drawer 里的 ⌨ 视为已有入口，但 drawer 初态隐藏、需 drawer-toggle 打开；用户删掉 drawer-toggle 且 ⌨ 只在 drawer 时永久锁死。修：可达性规则改为——toolbar row1/row2 与 floatingButtons 内的 ⌨ 算直接可达；drawer 内的 ⌨ 仅当 toolbar/floating 中存在 drawer-toggle（可达的打开路径）时才算可达；否则注入 toolbar row2。保持纯函数。补测试：⌨ 只在 drawer + 无 drawer-toggle → 注入；⌨ 只在 drawer + 有 drawer-toggle → 不注入。

## 边界与纪律

- 只允许改：`src/index.ts`、`src/controls/keyboard-controller.ts`、`src/toolbar/toolbar.ts`、`src/drawer/drawer.ts`、`src/controls/floating-buttons.ts`、`tests/*.test.ts`、`tests/playwright/*.spec.ts`。禁 docs、禁服务端、禁重构顺手活。
- 修复纪律：优先减法；不得为修复新增配置项/状态机/机制（P2 修复不允许新机制）；共享 helper 是唯一批准的新抽象（三调用方实证）。
- 全漏斗必须绿：`pnpm exec tsc --noEmit`、`pnpm run check`、`pnpm test`、`pnpm run build:dist`、`pnpm run test:pw`（chromium；webkit 缺系统库属已知环境限制，如实报告）。
- 小步 commit（每条 P2 一个 commit，`fix(mobile): ...`），停在 card 分支，不 push 不开 PR。
- 报告首行前恰好一行 `<!-- delegate-outcome: succeeded -->` 或 `<!-- delegate-outcome: failed -->`。
