# 任务卡：把滚轮发送节流到 30Hz，消除惯性阶段的卡顿

## 目标

`src/gestures/scroll.ts` 现在由 rAF 驱动、**每帧发一次**滚轮序列（60Hz 屏上即 60 次/秒）。
实测证明这个频率超过了 herdr 的处理能力，请求被合并，画面更新变得不规则——
真机表现为松手后惯性滚动「一卡一卡」。

把**发送**节流到 30Hz，同时保证累积位移一分不丢。

## 实测依据（三次独立运行一致）

见 `docs/sessions/260821-1053-scroll/wheel-latency-evidence.md`：

- herdr 有效重绘上限 ≈ **56–58 Hz**
- **1:1 映射边界在 40 Hz**：≤40Hz 时每个滚轮事件对应一次 PTY 输出
- >40 Hz 后 herdr 在渲染循环内**合并**请求：120Hz 发送 360 次只产生 169–174 次输出
- 单次滚轮响应延迟 p50 仅 3ms —— **延迟不是瓶颈，吞吐饱和才是**

选 30 Hz 是相对 40 Hz 的 1:1 边界留约 25% 余量：真机链路（WebSocket + Safari +
xterm.js 渲染）比本机 node-pty 直连长得多，贴边界跑很可能越过饱和点。

**注意**：证据文档里各档的间隔标准差 σ 三次运行排序完全不同（第三次 σ 最小的档位
反而是 60Hz），已判定为噪声。**不要用 σ 做任何判断。**

## 核心要求：与旧限流的本质区别

被删掉的旧 `wheelIntervalMs` 限流是：间隔未到就 `break`，**累积的位移被丢弃**——
这正是「手指滑很长、屏幕只动一点」的根因，不许倒退回去。

本卡的节流只推迟**发送时机**，不丢弃任何位移：节流期间 `pendingPx` 继续累积，
下次允许发送时一次性兑现。

## 实现规格

### 配置

`ScrollConfig` 增加一个字段：

```ts
/** 两次滚轮发送的最小间隔(ms)。默认 33 ≈ 30Hz —— herdr 的 1:1 映射边界实测在 40Hz，
 *  留 25% 余量。与已删除的 wheelIntervalMs 不同：间隔未到只推迟发送，不丢弃位移。 */
readonly sendIntervalMs: number
```

默认 `33`。schema 需校验 `>= 0`（0 表示不节流）。

### 引擎改动

- 引擎内部记录 `lastSendAt`
- `tick()` 中：**先照常推进 fling 物理与 `pendingPx` 累积**（这部分仍每帧执行，
  惯性衰减不受节流影响），再判断是否到达发送时机；未到则返回 `null`，
  **`pendingPx` 原样保留**
- 到达发送时机才调用 `redeemPending` 并更新 `lastSendAt`
- 拖动与惯性**走同一条路径**，不要为两者分别写节流逻辑（不留双路径）

### 重命名

`maxLinesPerFrame` 语义已不准确（节流后一次发送承载多帧位移），
重命名为 `maxLinesPerSend`，含义为「单次发送最多滚动的行数」。
这是准确性修正，不是新增配置项——同步改 `types.ts` / `config.ts` / `config-schema.ts`
与所有引用点及文档。

## 非目标

- 不改量化公式、EMA 速度估计、friction 衰减。
- 不改 `linesPerWheel`（已实测校准为 1）。
- 不碰服务端 `src/session.ts` / `src/serve.ts` / `src/session-protocol.ts`。
- 不为节流新增独立的定时器/状态机——复用现有 rAF 循环。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：700
- **阶段**：implementing
- **锁定决策**：
  1. 节流只推迟发送，绝不丢弃 `pendingPx`。
  2. 拖动与惯性共用同一条节流路径。
  3. `maxLinesPerFrame` 重命名为 `maxLinesPerSend`。
  4. 默认 `sendIntervalMs: 33`，不要改成别的值。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：69db19e
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 创建
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`src/gestures/scroll.ts`、`src/types.ts`、`src/config.ts`、
  `src/config-schema.ts`、`src/controls/scroll-buttons.ts`（若引用被重命名字段）、
  `tests/gestures.test.ts`、`tests/config-validate.test.ts`、
  `tests/scroll-buttons.test.ts`、`README.md`、`.agents/skills/remobi-setup/SKILL.md`
- **禁止**：`src/session*.ts`、`src/serve.ts`、`src/client-entry.ts`、`spikes/**`、
  `.github/workflows/`、`tests/playwright/**`
- **Scope-Globs**：src/gestures/scroll.ts src/types.ts src/config.ts src/config-schema.ts src/controls/scroll-buttons.ts tests/gestures.test.ts tests/config-validate.test.ts tests/scroll-buttons.test.ts README.md .agents/skills/remobi-setup/SKILL.md
- **高风险区域**：`tests/config-validate.test.ts` 有一处断言完整 scroll 默认配置对象，
  加字段与重命名都会打穿它。

## 完成条件

每条都要能答出「代码在哪、哪个测试锁死」。

1. **节流生效**：以 60Hz 投喂位移持续 1 秒，实际发送次数约为 30（±1），
   不是 60。
2. **位移零丢失**（最关键）：上述场景下，累计滚动的总行数等于
   `trunc(总位移 × speedMultiplier / cellHeight / linesPerWheel)`，
   与不节流时**完全相同**。节流只改变发送时机，不改变总量。
3. **惯性物理不受节流影响**：fling 的速度衰减仍按帧推进——
   相同初速度下，节流与不节流的 fling 总时长一致（断言 `isFlinging` 转 false 的
   帧数相同）。
4. **拖动与惯性同一路径**：代码中只有一处节流判断（不是拖动一处、惯性一处）。
5. `sendIntervalMs: 0` 时退化为每帧发送（不节流）。
6. `maxLinesPerSend` 重命名完成，全仓无 `maxLinesPerFrame` 残留。
7. **反证**（必做，报告里贴出实际失败输出）：
   - 去掉节流判断（恢复成每帧发送）→ 第 1 条断言必须变红
   - 把节流实现成「间隔未到就丢弃 pendingPx」（即旧限流的错误做法）
     → 第 2 条断言必须变红
8. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
   `pnpm run lint:knip` 全绿。
   注意：`tests/playwright/weak-network.spec.ts` 在 webkit-iphone 上有既有 flaky
   （与本卡无关，已另卡处理），本地不跑 playwright。
9. README 与 skill 文档中的 scroll 配置表已同步新字段与重命名。

## 提交与 PR

- 小步提交，测试绿即 commit；分支即开 draft PR，commit 即 push。
- 归因 trailer 由 hook 自动注入，不要手写。
