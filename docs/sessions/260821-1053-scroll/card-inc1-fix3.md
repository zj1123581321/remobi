# 任务卡：把最后两条源码文本断言换成运行时行为断言

## 说明（先读这段）

这**不是**前两轮同一问题的第三次返工。前两轮点名的 findings 你都改对了，
F7/F8 的改写我已用独立反证验过（清空 `stopFling()` 函数体、给 `refreshLayout`
重新加缓存，两条测试各自如期变红）。

本卡是**新 findings**：我上一轮只抽查了部分测试就下结论，没扫全文件里全部 8 处
`readFileSync` 文本断言，漏掉了下面两条。漏审责任在拆卡方，不是你没修好。

## 目标

把 `tests/gestures.test.ts` 里最后两条「读源码做字符串匹配」的测试，
换成运行时行为断言。改完本增量引入的文本断言清零。

## 修复卡必填

- **root_cause_group**：同前两轮——用源码文本匹配代替行为断言。
- **introduced_by_commit**：`50db71a`
- **open_findings**：F9 / F10。修复不得超出这两条。

## 待修 findings

### F9（P2）：`adapter calls sendData once per animation frame` 数的是源码文本

```ts
const frameBlock = source.slice(source.indexOf('function onFrame'), source.indexOf('function onTouchStart'))
expect(frameBlock.match(/sendData\(/g)?.length).toBe(1)
```

它断言的是「`onFrame` 的源码里写了一次 `sendData(`」，不是「运行时调用了一次」。
在 `onFrame` 里写 `for (const s of chunks) sendData(term, s)`，源码文本仍然只有一次
`sendData(`，测试照样绿——而这恰恰是本增量最核心的那条不变式
（单帧批量拼接、只发一次）在适配层的回归。

**修法**：改成运行时断言。基础设施已经现成——
参考同文件 `touchstart remeasures cellHeight on every gesture` 里的写法：
用 `mockTerminal()` 覆写 `input(data)` 把实际发送推进一个 `sent: string[]`，
用 `vi.stubGlobal('requestAnimationFrame', cb => { cb(16); return 1 })` 驱动帧。

构造一次「单帧需要发出 n>1 个滚轮序列」的手势，然后断言两件事：
1. `sent.length === 1`（一帧只发一次）
2. `sent[0] === scrollSeq(dir, x, y).repeat(n)`（内容是 n 个序列的拼接）

### F10（P2）：`touchmove hot path does not call layout APIs` 抓不到间接调用

```ts
const moveBlock = source.slice(source.indexOf('function onTouchMove'), source.indexOf('function onTouchEnd'))
expect(moveBlock).not.toContain('getBoundingClientRect')
expect(moveBlock).not.toContain('querySelector')
```

只检查 `onTouchMove` 函数体的**字面文本**。若 touchmove 路径里调用了某个内部函数，
而那个函数内部做 `getBoundingClientRect()`，这条测试完全抓不到——
「热路径零强制布局」这条性能不变式实际没有被锁死。

**修法**：改成运行时断言。用 `makeScreen(getHeight)` 返回的 `measureSpy`
（它已经是 `getBoundingClientRect` 的间谍）：
1. 派发一次 `touchstart`，记录此时 `measureSpy.mock.calls.length`
2. 连续派发**多次** `touchmove`（至少 5 次，位移足够触发滚动）
3. 断言 `measureSpy` 的调用次数**相对第 1 步没有增长**

这样无论直接调用还是间接调用，只要热路径碰了布局 API 就会红。

## 非目标

- **不碰生产代码** `src/gestures/scroll.ts`。
- 不动 `origin/main` 存量的两条文本断言测试
  （`uses natural scroll direction`、`source uses \x3c instead of literal <`）——
  那是存量问题，已记 backlog，不在本卡范围。
- 不动其余已验证的行为测试。
- 不新增测试辅助抽象；复用同文件已有的 `makeScreen` / `dispatchGesture` / `mockTerminal`。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：90
- **Diff-Lines-Hard**：180
- **阶段**：repairing
- **锁定决策**：
  1. 两条都改写成运行时断言，不删除（它们锁的不变式是真的，只是断言方式错了）。
  2. 不碰生产代码。
  3. 复用现有测试辅助函数，不新增抽象。
- **任务类型**：tests-docs
- **复杂度**：S
- **Base commit**：4e35bfe（本分支 HEAD，在其上追加提交）
- **Branch**：沿用 `card/remobi-20260821-04`
- **Worktree**：沿用 `/home/zlx/projects/oss/remobi-worktrees/remobi-20260821-04`
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`tests/gestures.test.ts`
- **禁止**：`src/**` 全部、其余 `tests/**`、`styles/**`、`README.md`、
  `.agents/**`、`.github/workflows/`
- **Scope-Globs**：tests/gestures.test.ts
- **高风险区域**：改完后本文件其余测试必须全绿，不得放宽既有断言。

## 完成条件

1. `grep -c readFileSync tests/gestures.test.ts` 结果为 **4**
   （只剩 `origin/main` 存量那两条测试各自的一处 import + 一处调用）。
2. **F9 反证**：在 `onFrame` 里把单次 `sendData(term, result.data)` 改成
   逐字符循环发送（源码文本里 `sendData(` 仍只出现一次），改写后的测试必须变红。
   **在报告里贴出这次反证的实际失败输出。**
3. **F10 反证**：在 `onTouchMove` 里插入一次对 `refreshLayout(t)` 的调用
   （间接触发 `getBoundingClientRect`，而 `onTouchMove` 的字面文本里
   并不出现 `getBoundingClientRect`），改写后的测试必须变红。
   **在报告里贴出这次反证的实际失败输出。**
4. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
   `pnpm run lint:knip` 全绿（`tests/serve-abuse.test.ts` 超时是本机高负载 flaky，
   单独重跑通过即可，不要改它）。
5. 生产代码 `git diff` 为空——反证用的临时改动必须在提交前完全恢复
   （提交后 `git status --porcelain` 干净）。

## 提交与 PR

- 在现有分支上追加提交，push 到同一 draft PR（#23）。
- 归因 trailer 由 hook 自动注入，不要手写。
