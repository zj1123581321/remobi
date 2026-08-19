# 修复卡：增量 4 —— Codex 终审 round1 findings 修复

**执行器角色声明**：本会话就是执行器（implementer），直接落盘修复，不再向下委派。修复提交在你自己之前的分支 `card/remobi-20260819-01`（worktree `/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-01`）上继续，HEAD 当前为 `bea80cc`。

## 修复清单（只允许这三项，逐项一个 commit）

### F1（P2-1）：× 关闭按钮抢终端焦点

- 现象（Codex 真机探针证据）：Pixel 5/Chromium 下，触摸 `#wt-drawer-close` 前 `document.activeElement` 是 `.xterm-helper-textarea`，触摸后变成 `BUTTON#wt-drawer-close`——`onTap` 的 touchend 里跑完 `conditionalFocus` 后，浏览器合成的 mousedown 又把焦点交给了原生 button。
- 修法：`src/drawer/drawer.ts` 的 × 按钮套用本增量已抽出的 `suppressSynthesisedMouse(closeButton)`（`src/controls/keyboard-controller.ts`），与 d-pad 六键同一防护路径。不引入新机制。
- 回归测试：`tests/drawer.test.ts` 加用例——对 × 派发 touchend 事件断言 `defaultPrevented === true`（与 `tests/dpad.test.ts` 的焦点安全用例同构）。

### F2（P3-1）：backdrop 与 × 的关闭 handler 去重

- `src/drawer/drawer.ts:123-136` 两段 onTap 回调完全相同（isKeyboardOpen → haptic → close → conditionalFocus）。提取为同一函数作用域内的局部函数（如 `dismissDrawer`），两处挂接。不新增状态/配置/导出。

### F3（P2-2）：d-pad 删除镜像状态与单实现接口

- `src/controls/dpad.ts`：删除 `open` 局部变量与 `isOpen()`（与 `element.classList.contains('open')` 镜像，且唯一消费者是测试）；`toggle()` 直接 `element.classList.toggle('open')`。删除私有 `Dpad` interface（单实现接口，`createDpad` 返回类型用内联字面量类型 `{ readonly element: HTMLDivElement; readonly toggle: () => void }`）。
- `tests/dpad.test.ts`：改用 `element.classList.contains('open')` 断言显隐（用户可观察状态），删掉 `isOpen()` 调用。

## 明确不修（已裁决）

- P3-2（自定义 row2 时 d-pad 覆盖第二行）：接受进 backlog，本轮不动——修复需要布局测量机制，违反 shrink-only。
- d-pad 按钮不加 `type="button"`（仓内 toolbar/drawer 按钮均无此属性，overlay 不在 form 内）。

## 约束

- 允许改：`src/drawer/drawer.ts`、`src/controls/dpad.ts`、`tests/drawer.test.ts`、`tests/dpad.test.ts`。其余文件禁动。
- 完成后跑全量电池：`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run test:pw:chromium`（flake 单跑复验并注明）。注意 `pnpm test | tail` 掩盖退出码，用 `> log 2>&1; echo $?`。
- Conventional Commits（`fix(controls): ...` / `refactor(...)` 按性质选），带 Dispatch-Id trailer 与 [kimi] 署名，不 push。
- 报告首行前恰好一行 `<!-- delegate-outcome: succeeded -->` 或 `<!-- delegate-outcome: failed -->`。该值描述任务是否完成，与 review verdict 正交。
