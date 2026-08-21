# 任务卡：给 momentum 配置补范围校验

## 说明

本卡来自 OCR 前置扫描的一条 finding，经主脑核实成立。同批 OCR 的其余 9 条我已逐条核过：
2 条 high 全是误报（`stopFling()` 是无条件 `velocity = 0`；keys 残量那条 OCR 复核器自己已
refuted），1 条 performance 误报（单帧 payload ≤100 字节），其余为 P3 或存量，均记 backlog
不在本卡范围。**只修下面这一条。**

## 目标

`src/config-schema.ts` 里 `friction` 与 `minVelocity` 只声明为 `finiteNumber`，
没有范围约束。运行时 `scroll.ts` 用它做 `velocity *= friction ** (dt / 16.7)`：
`friction >= 1` 会让惯性**加速而不是衰减**，滚动永不停止；`friction <= 0` 同样破坏衰减语义。
补上范围校验，让非法配置在加载期就报错，而不是变成一次失控的滚动。

## 修复卡必填

- **root_cause_group**：新增配置项时只声明了类型、没声明取值域。
- **introduced_by_commit**：`50db71a`
- **open_findings**：F11。修复不得超出这一条。

## 待修 finding

### F11（P2）：`momentum.friction` / `momentum.minVelocity` 缺范围校验

现状（`src/config-schema.ts:203-213` 附近）：

```ts
const scrollMomentumOverridesSchema = v.strictObject({
	enabled: v.optional(v.boolean()),
	friction: v.optional(finiteNumber),
	minVelocity: v.optional(finiteNumber),
})
```

**修法**：
- `friction`：约束到 `(0, 1)` 开区间——等于 0 会让惯性一帧内消失（虽不失控但无意义），
  等于/大于 1 会让惯性加速。用 Valibot 的 `minValue` / `maxValue` 组合表达，
  并让错误信息说清合法区间。
- `minVelocity`：约束为 `>= 0`。

overrides 与 resolved 两个 schema 都要改（`scrollMomentumResolvedSchema` 同样只有
`finiteNumber`）。不要新增自定义校验函数或工具层，用 Valibot 现成的 pipe 组合即可。

## 非目标

- 不碰 `src/gestures/scroll.ts`。
- 不改默认值（`friction: 0.95`、`minVelocity: 0.02` 已在合法区间内）。
- 不给其他配置项顺手加校验。
- 不新增配置项、不新增工具函数。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：60
- **Diff-Lines-Hard**：140
- **阶段**：repairing
- **锁定决策**：
  1. 用 Valibot 现成组合子表达区间，不写自定义校验函数。
  2. overrides 与 resolved 两个 schema 都改。
  3. 不碰运行时代码。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：eaa9720（本分支 HEAD，在其上追加提交）
- **Branch**：沿用 `card/remobi-20260821-04`
- **Worktree**：沿用 `/home/zlx/projects/oss/remobi-worktrees/remobi-20260821-04`
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`src/config-schema.ts`、`tests/config-validate.test.ts`
- **禁止**：`src/gestures/**`、`src/config.ts`、其余 `src/**`、其余 `tests/**`、
  `styles/**`、`README.md`、`.agents/**`、`.github/workflows/`
- **Scope-Globs**：src/config-schema.ts tests/config-validate.test.ts
- **高风险区域**：`tests/config-validate.test.ts` 里已有一处断言完整 scroll 默认配置对象，
  改 schema 后确认它仍绿。

## 完成条件

1. `assertValidConfigOverrides({ gestures: { scroll: { momentum: { friction: 1 } } } })` 抛错，
   错误信息包含 `config.gestures.scroll.momentum.friction`。
2. 同样地 `friction: 0`、`friction: -0.5`、`friction: 1.5`、`minVelocity: -1` 各自抛错，
   表驱动一条测试覆盖这五个非法值。
3. 合法值 `friction: 0.95`、`friction: 0.5`、`minVelocity: 0` 不抛错。
4. **反证**：把新加的范围约束改回 `finiteNumber`，第 1、2 条测试必须变红。
   **在报告里贴出反证的实际失败输出。**
5. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
   `pnpm run lint:knip` 全绿（`tests/serve-abuse.test.ts` 超时是本机高负载 flaky，
   单独重跑通过即可，不要改它）。

## 提交与 PR

- 在现有分支上追加提交，push 到同一 draft PR（#23）。
- 归因 trailer 由 hook 自动注入，不要手写。
