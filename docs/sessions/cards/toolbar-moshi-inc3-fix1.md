# 修复反馈卡：增量 3 review 第 1 轮 —— 4 条 P3

独立 review（Codex，verdict 在 worktree `docs/sessions/toolbar-moshi-inc3/reviews/inc3-review1-verdict.md`，先读）判 fail：0 P1/P2、4 条 P3。主脑复核全部成立，按下面修。**只修这 4 条**，backlog 项（buttons.ts 注释、pinch 的 setTimeout 轮询）不动。

## P3-1：persisted 字号按当前 sizeRange clamp

`src/index.ts` 的 `applyTermAppearance`（内联后见 P3-4）应用 persisted 值前，以 `config.font.sizeRange` clamp（复用 `src/gestures/pinch.ts` 的 `clampFontSize` 或内联 Math.max/min，不新造工具）。补契约测试：上界（persisted 30 + range [8,20] → 20）、下界、空字符串（`Number('')===0` 的坑）。

## P3-2：pinch 结束持久化

`src/gestures/pinch.ts`：一次 pinch 手势结束（touchend 且 lock 为 pinch）且字号相对 pinchBase 有变化时，写一次 localStorage（move 阶段不写）。沿用批准的窄 try/catch + console.error。测试：move 多次 touchend 只写一次；写抛错 console.error 后继续。

## P3-3：抽共享存储键常量

`'remobi:fontSize'` 字面量（registry 写、index 读、修完 P3-2 后 pinch 第三处）提取为一个内部共享常量（放 `src/` 内合适位置，读写与测试都引用它）。注意 knip：只导出被跨模块引用的，别造未用导出。

## P3-4：内联 applyTermAppearance

`src/index.ts` 的 `applyTermAppearance` 是单调用 4 行 helper（无失败证据、无第二调用方，违红线）——内联回 init；`readPersistedFontSize` 保留（有 iOS 异常边界依据）。

## 边界与纪律

- 只允许改：`src/index.ts`、`src/gestures/pinch.ts`、`src/actions/registry.ts`、`src/controls/keyboard-controller.ts`（如常量放这）、`tests/*.test.ts`。如常量需要新位置自行判断但报告说明。
- 优先减法；不新增配置项/机制。
- 全量验证（CI 完整电池）：`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist`、`pnpm run lint:knip`、`pnpm run lint:publint`、`pnpm run lint:ox`、`pnpm run test:pw`（chromium，flake 单跑复验并注明）。
- 小步 commit（每条一个 `fix:`/`refactor:`），停 card 分支，不 push 不开 PR。
- 报告首行前恰好一行 `<!-- delegate-outcome: succeeded -->` 或 `<!-- delegate-outcome: failed -->`。
