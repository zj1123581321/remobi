# 任务卡：把三条无约束力的滚动测试换成行为断言

## 目标

生产代码已通过审查（tsc 干净、逻辑正确），本卡只处理**测试的约束力**问题：
本轮 diff 引入的三条测试改坏对应实现也不会变红，等于没写。

判据来自 `core.md` 的 Unknowns 纪律：
「断言本身也要核对约束力——改坏对应实现时它会不会变红，恒真断言等于没写。」

## 修复卡必填

- **root_cause_group**：用「读源码文件做字符串匹配」和「断言一个本来就成立的状态」
  代替行为断言，导致测试报绿但无回归保护力。
- **introduced_by_commit**：`50db71a` 与 `5a039a7`（本增量两轮自身引入）
- **open_findings**：F6 / F7 / F8。修复不得超出这三条。

## 待修 findings

### F6（P2）：`touchcancel does not start fling` 是源码文本断言且冗余

```ts
const source = readFileSync(resolve(import.meta.dirname, '../src/gestures/scroll.ts'), 'utf-8')
const cancelBlock = source.slice(...)
expect(cancelBlock).toContain('engine.stopFling()')
expect(cancelBlock).toContain('stopRaf()')
expect(cancelBlock).not.toContain('onTouchEnd')
```

它断言的是源码长什么样，不是程序怎么跑：把 `engine.stopFling()` 改写成
`const stop = engine.stopFling; stop()` 会假红；反过来，即使 `touchcancel` 监听器
根本没绑上，这条测试照样绿——真正的回归它抓不到。

而且同一行为已被 `touchcancel stops fling and cancels scheduled rAF` 真正锁死
（那条用 rAF 桩断言 `cancelAnimationFrame` 被调用，是好测试，**保留不动**）。

**修法**：直接删掉 `touchcancel does not start fling` 这条测试。做减法，不要改写。

### F7（P2）：`touchstart remeasures cellHeight on every gesture` 零行为约束力

```ts
expect(startBlock).toContain('refreshLayout(t)')
expect(source).not.toContain('layoutValid')
expect(source).not.toContain('invalidateLayout')
```

这是把「上一轮删掉了某个标识符」固化成文本检查，不测任何行为。

**修法**：改写成行为断言。用 spy 包住 `getBoundingClientRect`（或
`measureScrollLayout` 实际依赖的测量入口），连续派发两次完整的
touchstart→touchmove→touchend 手势，断言**每次 touchstart 都重新测量了一次**
（测量调用次数随手势次数增长），而不是只在第一次测量后一直复用。

若两次手势之间终端高度变化，第二次手势必须用新的 cellHeight——这条更能说明意图，
可作为断言的具体形态。

### F8（P2）：`stopFling cancels inertial scroll` 是恒真断言

```ts
engine.onTouchStart(0)
for (let i = 1; i <= 5; i++) engine.onTouchMove(i * 16, 40)
engine.stopFling()
expect(engine.isFlinging).toBe(false)
```

测试全程没有调用 `onTouchEnd`，而 `isFlinging` 只在 `onTouchEnd` 里才可能被置为 true。
所以 `isFlinging` 在 `stopFling()` 之前就已经是 `false`，断言前后都成立——
把 `stopFling()` 整个函数体删空，这条测试依然绿。

**修法**：补齐前置状态，让断言真正跨越一次状态迁移：
1. `onTouchStart` → 若干次 `onTouchMove`（速度足够）→ `onTouchEnd`
2. **先断言 `engine.isFlinging === true`**（证明 fling 确实启动了）
3. 再 `engine.stopFling()`
4. 断言 `engine.isFlinging === false`，且后续 `tick()` 不再因惯性推进 `pendingPx`

## 非目标

- **不碰生产代码** `src/gestures/scroll.ts`——它已通过审查。
- 不动 `touchcancel stops fling and cancels scheduled rAF`、
  `keys strategy emits at most one pageSeq per frame` 等已验证的行为测试。
- 不处理 `origin/main` 上既有的 4 处 `readFileSync` 文本断言（存量问题，已记 backlog）。
- 不新增测试工具函数、fixture 或抽象；就地改这三条。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：80
- **Diff-Lines-Hard**：160
- **阶段**：repairing
- **锁定决策**：
  1. F6 走删除，不改写——同一行为已有真测试。
  2. 不碰生产代码；本卡只改 `tests/gestures.test.ts`。
  3. 不为修这三条新增测试辅助抽象。
- **任务类型**：tests-docs
- **复杂度**：S
- **Base commit**：5a039a7（本分支 HEAD，在其上追加提交）
- **Branch**：沿用 `card/remobi-20260821-04`
- **Worktree**：沿用 `/home/zlx/projects/oss/remobi-worktrees/remobi-20260821-04`
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`tests/gestures.test.ts`
- **禁止**：`src/**` 全部（含 `src/gestures/scroll.ts`）、其余 `tests/**`、
  `styles/**`、`README.md`、`.agents/**`、`.github/workflows/`
- **Scope-Globs**：tests/gestures.test.ts
- **高风险区域**：改完 F7/F8 后，本文件其余测试必须全绿；不要为了让新断言成立
  而放宽既有断言。

## 完成条件

1. `tests/gestures.test.ts` 中本轮 diff 引入的 8 处 `readFileSync` 文本断言，
   降到 4 处以内（即本增量引入的那部分清零；`origin/main` 存量的 4 处不动）。
2. F7 改写后的测试：把 `refreshLayout` 的测量调用改成只在首次 touchstart 执行
   （模拟重新引入缓存），该测试必须变红。**请在报告里贴出这次反证的实际输出。**
3. F8 改写后的测试：把 `stopFling()` 的函数体清空，该测试必须变红。
   **同样在报告里贴出反证输出。**
4. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
   `pnpm run lint:knip` 全绿（`tests/serve-abuse.test.ts` 的超时属本机高负载 flaky，
   单独重跑通过即可，不要去改它）。
5. 生产代码 `git diff` 为空——本卡不允许出现 `src/` 下的改动。

## 提交与 PR

- 在现有分支上追加提交，push 到同一 draft PR（#23）。
- 归因 trailer 由 hook 自动注入，不要手写。
