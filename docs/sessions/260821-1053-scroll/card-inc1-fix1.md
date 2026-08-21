# 任务卡：修复增量1 滚动引擎的类型错误与两处语义缺陷

## 目标

修掉 `card/remobi-20260821-04`（HEAD `50db71a`）上会让 CI 变红的三个类型错误，
以及审查发现的两处语义缺陷。修完 CI 完整漏斗必须能过。

## 修复卡必填

- **root_cause_group**：验证漏斗不完整——上一轮的 Verify-Command 只有
  `pnpm test && pnpm run check`，漏掉了 CI 实际跑的 `tsc --noEmit` 与各 lint 腿，
  于是三个类型错误带着「全绿」的报告交付。
- **introduced_by_commit**：`50db71a`（本增量自身引入，非存量）
- **open_findings**：F1 / F2 / F3 / F4（见下），修复不得超出这四条。

## 待修 findings

### F1（P1）：`tsc --noEmit` 三个错误 → CI 第 30 步必红

实测输出：

```
src/gestures/scroll.ts(240,6): error TS6133: 'layoutValid' is declared but its value is never read.
src/gestures/scroll.ts(256,11): error TS6133: 'stopRaf' is declared but its value is never read.
src/gestures/scroll.ts(296,32): error TS18047: 'layout' is possibly 'null'.
```

### F2（P1，与 F1 同处）：布局失效机制写了但没接线

`layoutValid` 被 `invalidateLayout()` 写、被 `refreshLayout()` 写，**从未被读取**；
两个 resize 监听器因此形同虚设。

**修法（做减法，不要接线）**：删掉 `layoutValid` 与两个 resize 监听器。

理由：`onTouchStart` 每次都调 `refreshLayout()`，而 `touchToCell()` 内部本来就要一次
`getBoundingClientRect()`，`cellHeight` 顺带算出不多花开销。「每次触摸重新测量」比
「缓存 + 失效标志」更强地保证了新鲜度，也更少状态。
touchstart 不是热路径，卡的「热路径零 DOM 查询」约束针对的是 touchmove，不受影响。

### F3（P1，与 F1 同处）：`stopRaf` 定义了但无调用者，rAF 取消路径缺失

**修法（接线，不是删除）**：把 `stopRaf` 接到 touchcancel 上，同时修掉 F4。见下。

### F4（P2）：touchcancel 会启动惯性滚动

`touchcancel`（来电、系统手势打断）当前和 `touchend` 共用同一个 handler，
会走 `engine.onTouchEnd()` 从而启动 fling。手势被系统取消后还继续惯性滚动是错的。

**修法**：拆开两个 handler。
- `touchend` → 现有行为（`engine.onTouchEnd()` + `scheduleRaf()` + `resetLock()`）
- `touchcancel` → 停止惯性 + `stopRaf()` + `resetLock()`，**不**启动 fling

引擎需要一个「取消」入口来清掉 `isFlinging` 与 `velocity`。**优先复用已有的
`stopFling()` 语义**，把它作为 `ScrollEngine` 的公开方法暴露即可，不要新增状态字段。

### F5（P2）：`keys` 策略下 `maxLinesPerFrame` 语义错，安全阀被放大 rows 倍

`redeemPending()` 现在是：

```ts
const maxEvents =
  config.strategy === 'keys' ? config.maxLinesPerFrame : maxWheelEventsPerFrame(config)
```

`keys` 下每个事件是一个 PageUp = **一整页**（rows 行），所以 `maxEvents = 24` 意味着
单帧最多翻 24 页 ≈ 24×rows 行，而 `wheel` 下是 `floor(24/3)=8` 个事件 = 24 行。
同一个配置项在两条策略下相差 rows 倍，安全阀在 keys 下等于没有。

**修法**：`keys` 策略下 `maxEvents = 1`。

理由：翻页本身就是粗粒度操作，一帧翻超过一页必然滚过头；keys 也不需要批量化收益。
这同时去掉了一个分支的语义歧义，是做减法。

## 非目标

- 不改引擎的物理模型（量化公式、EMA 速度估计、friction 衰减）——那部分审查通过。
- 不改 `ScrollConfig` 的字段集合，不新增配置项。
- 不碰 `src/session.ts` / `src/serve.ts` / `src/session-protocol.ts`。
- 不动 `tests/serve-abuse.test.ts`（其超时失败是本机高负载下的 flaky，单跑两次均通过，与本卡无关）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：250
- **阶段**：repairing
- **锁定决策**：
  1. F2 走删除，不走接线（理由已写在 F2）。
  2. F4 的取消入口复用 `stopFling()` 暴露成公开方法，禁止新增状态字段。
  3. F5 在 keys 下固定为 1，不引入新配置项。
- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：50db71a（本分支 HEAD，在其上追加修复提交）
- **Branch**：沿用 `card/remobi-20260821-04`，不要另建分支
- **Worktree**：沿用 `/home/zlx/projects/oss/remobi-worktrees/remobi-20260821-04`
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`src/gestures/scroll.ts`、`src/types.ts`（仅当 F4 需要在 `ScrollEngine`
  接口上暴露取消方法）、`tests/gestures.test.ts`
- **禁止**：其余全部 `src/**`、`styles/**`、`README.md`、`.agents/**`、`.github/workflows/`
- **Scope-Globs**：src/gestures/scroll.ts src/types.ts tests/gestures.test.ts
- **高风险区域**：`redeemPending()` 的量化公式已通过审查，改 F5 时只动 `maxEvents`
  那一行，不要顺手重构公式。

## 完成条件

1. `pnpm exec tsc --noEmit` 零错误。
2. `pnpm test`（除 `tests/serve-abuse.test.ts` 的已知 flaky 外）全绿；
   `pnpm run check`、`pnpm run lint:ox`、`pnpm run lint:knip` 全绿。
3. F4 有回归测试锁死：touchcancel 后 `isFlinging === false` 且不再调度 rAF。
4. F5 有回归测试锁死：`strategy: 'keys'` 下单帧最多产出 1 个 `pageSeq`，余量留在 `pendingPx`。
5. F2 删除后，报告里确认 `cellHeight` 在每次 touchstart 都是新测量的。
6. 上一轮已有的 7 条不变式测试全部仍然绿（不得为了让 tsc 过而删测试）。

## 提交与 PR

- 在现有分支上追加修复提交，push 到同一 draft PR（#23）。
- 归因 trailer 由 hook 自动注入，不要手写。
