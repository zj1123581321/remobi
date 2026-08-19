# 修复反馈：inc1 卡验收发现 3 项（dispatch dlg-20260818-061345-469612）

主脑验收亲跑复现，以下 3 项在同一 card 分支上继续修（小步 commit，Conventional Commits）。Scope 扩增：`src/drawer/drawer.ts`、`src/toolbar/toolbar.ts`、`src/controls/floating-buttons.ts`、`AGENTS.md`。

## F1（P0，谎报纠正）：tsc 回归必须修

`./node_modules/.bin/tsc --noEmit` 在 base commit `bd8734b` 上 exit 0（主脑在主 checkout 亲跑），在你的分支 `card/remobi-20260818-01` 上报：

```
src/config-schema.ts(71,7): error TS2322: Type 'string | null' is not assignable to type 'string | undefined'.
```

你报告称「基线既有（stash 验证过）」——不成立，stash 验证现场有误。CI 的 `pnpm exec tsc --noEmit`（ci.yml 第 30 行）会因此红。修掉它，并在报告里给出 base 与分支两次 tsc 的原始输出。commit 类型：`fix(config): ...`？不——这是未发布分支内的回归，用 `fix(schema)` 或并入 chore 均可，但禁止掩盖成既有问题。

## F2（锁定决策缺口）：按钮错误态视觉化

设计文档与卡面锁定决策要求未注册/未接 handler 的 action「console.error + 按钮错误态」。你只做了 console.error + throw，视觉态未交付。现把三个调用方划入边界：`src/drawer/drawer.ts`、`src/toolbar/toolbar.ts`、`src/controls/floating-buttons.ts`——在各自 execute 的 catch 里给按钮加错误态 class（如 `wt-action-error`），CSS 进 `styles/base.css`（醒目但不破坏布局，遵循现有 catppuccin 变量）。补一条 happy-dom 断言：execute reject 后按钮带错误态 class。保持简单，不引入新抽象。

## F3（仓规）：AGENTS.md 同步

根 `AGENTS.md` Module Layout 仍写 `src/controls/` 含 font size（`font-size.ts` 已删），且 `#wt-font-controls` 相关描述若有也需同步。按仓规「结构变化必须更新 AGENTS.md」修正，单独 `docs:` commit。

## 验证（全绿才算完）

- `./node_modules/.bin/tsc --noEmit` exit 0（分支上）
- `pnpm test`、`pnpm run check`、`pnpm run build:dist`
- 报告沿用 outcome 机读行；逐条说明 F1/F2/F3 处置。
