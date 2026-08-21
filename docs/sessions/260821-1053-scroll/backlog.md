# Backlog：移动端滚动体验会话（2026-08-21）

本轮审查中判为 P3 或存量、决定**接受不修**的条目。风险等级 personal，
P1 红线为数据丢失 / 静默出错 / 崩溃，以下均未触及。

## 1. 手势进行中的 resize 不会刷新布局缓存（P3）

`refreshLayout()` 只在 `onTouchStart` 执行。手势**进行中**发生 resize
（滑动时转屏、软键盘弹出）时，`cellHeight` / `cell` / `lockThresholdPx` 会陈旧到手指抬起。

**这是主脑判断的盲区，值得记下来**：修复增量1 时我主动删掉了 `layoutValid` 标志和两个
resize 监听器，理由是「每次 touchstart 重测比缓存+失效标志更强地保证新鲜度」。
该判断对**跨手势**成立，对**手势内**不成立——OCR 前置扫描指出了这一点。

不修的理由：触发场景罕见（滑动过程中转屏），后果轻微且自愈（滚动比例暂时不准，
下次触摸即恢复），而重新引入失效机制会把刚删掉的状态加回来。

若将来真机实测发现转屏后手感异常，从这条查起。

## 2. `lockThresholdPx` 的硬编码 `40` 兜底（P3）

`src/gestures/scroll.ts`：

```ts
const threshold = layout?.lockThresholdPx ?? 40
```

`layout` 为 null 时回退到 magic number `40`（旧 `sensitivity` 默认值的残留）。
实际只在「首次手势就是多指」这类边角情形命中，影响仅限手势锁的抢占阈值。

## 3. `attachScrollGesture` 无 teardown 契约（存量）

返回 `void`，不暴露 detach，也不清理 rAF 链；`attach()` 用 `setTimeout` 轮询等待
`.xterm-screen` 出现。这是重写前就有的形态，不是本次 diff 引入，按「只审本次 diff」记此。

## 4. `origin/main` 存量的 4 处源码文本断言测试（存量）

`tests/gestures.test.ts` 中两条测试（`uses natural scroll direction`、
`source uses \x3c instead of literal <`）用 `readFileSync` 读 `src/gestures/scroll.ts`
做字符串匹配，而非断言运行时行为。

本次增量引入的 8 处同类断言已全部换成行为断言（并逐条反证过），但这 4 处存量未动。
**这个坏模式是本仓既有风格，执行器多半在模仿它**——清理存量时一并处理，
可避免后续增量继续复制。

## 5. `ScrollTickResult` 是单字段包装（P3）

`interface ScrollTickResult { readonly data: string }`，所有调用点都是 `result.data`。
熵增审查角度这是无语义的间接层，`string | null` 更直接。改动成本低但收益也低，
下次动这个文件时顺手收掉。

## 6. `typos` linter 对连字符前缀的误报（工具）

`spikes/scrollback/lib.mjs` 里的 `mis-parses` 被 `typos` 判为 `miss`/`mist` 的拼写错误，
CI 硬闸。本次改写成 `misreads` 绕过。若后续再撞到同类误报，考虑给 `typos` 加配置文件
而不是继续改措辞。

## 7. `--repeat-each` 并行下的 snapshot marker 串台（P3，测试隔离）

`tests/playwright/weak-network.spec.ts` 的 `offline and online recovery converges to
the server snapshot` 在 `--repeat-each=10` 并行运行时约 2/10 失败：多个并行实例共享同一
remobi 服务与终端会话，各自写入的 `fresh-snapshot-*` marker 互相污染，
断言 `toContainText(keyboardMarker)` 因此落空。

正常 CI 不使用 `--repeat-each`，故不影响门禁。仅在人工做稳定性验证时会撞到。
根治需要让每个 worker 用独立的服务实例或独立会话名。

发现于 2026-08-21 flaky 修复卡（remobi-20260821-09）的稳定性验证，由执行器主动报告。

## 8. 记分卡必须在派下一张卡之前合并进主干（流程）

派卡闸门 `gated_unaccepted` 读的是**主仓工作区**的 `retro/acceptance-log.jsonl`。
主脑按「main 不直接写」的规矩把记分卡写在 worktree 分支上时，若不先合并，
闸门看不到，下一张卡必被拒。

2026-08-21 实测：连续两次派卡被闸，直到账本 PR #28 合并进主干才放行。
教训：**验收定局 → 记分卡 → 合并进主干 → 再派下一张卡**，不能攒着记。
