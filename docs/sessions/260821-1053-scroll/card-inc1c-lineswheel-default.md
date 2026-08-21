# 任务卡：把 linesPerWheel 默认值从 3 改为 1（实测校准）

## 目标

`src/config.ts` 里 `gestures.scroll.linesPerWheel` 默认值是 `3`，来自 tmux 惯例。
**真机实测证明 herdr 每个 SGR 滚轮事件只滚 1 行**：默认值 3 时手指位移与内容位移
呈 3:1（手指滑 3 屏幕只滚 1），改成 1 后比例正常。

本 fork 的定位是专攻 herdr（见 `docs/decisions/2026-08-20-fork-herdr-focus.md`），
默认值应当按 herdr 的真实行为设定，而不是继承 tmux 惯例。

## 非目标

- 不改 `src/gestures/scroll.ts` 的任何逻辑。
- 不改其他配置项的默认值。
- 不引入「按复用器类型切换默认值」这类机制——本 fork 只服务 herdr，加分支是熵增。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：60
- **Diff-Lines-Hard**：140
- **阶段**：implementing
- **锁定决策**：
  1. 默认值直接改成 `1`，不加复用器判别分支。
  2. 同步更新文档中出现该默认值的所有位置。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：bdfa7e4
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 创建
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`src/config.ts`、`tests/config-validate.test.ts`、`README.md`、
  `.agents/skills/remobi-setup/SKILL.md`、`docs/designs/mobile-scroll-experience.md`
- **禁止**：`src/gestures/**`、`src/config-schema.ts`、`src/types.ts`、其余 `src/**`、
  `styles/**`、`.github/workflows/`
- **Scope-Globs**：src/config.ts tests/config-validate.test.ts README.md .agents/skills/remobi-setup/SKILL.md docs/designs/mobile-scroll-experience.md
- **高风险区域**：`tests/config-validate.test.ts` 有一处断言完整 scroll 默认配置对象，
  改默认值必然打穿它，需同步更新。

## 完成条件

1. `defaultConfig.gestures.scroll.linesPerWheel === 1`，有测试断言。
2. 全仓 `grep -rn "linesPerWheel" --include='*.ts' --include='*.md'` 的结果里，
   凡提到默认值的地方都是 1，没有残留的 3。
   **注意** `docs/designs/mobile-scroll-experience.md` 里有两处提到默认值 3
   （增量1 设计节的默认值代码块、以及「已知未知」段落）——设计文档记录的是
   当时的决策，请**追加**一行说明实测结论，不要抹掉原始记录。
3. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
   `pnpm run lint:knip` 全绿。
4. **反证**：把默认值改回 3，第 1 条的断言必须变红。在报告里贴出反证输出。

## 提交与 PR

- 分支即开 draft PR，commit 即 push。
- 归因 trailer 由 hook 自动注入，不要手写。
