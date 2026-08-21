# 任务卡：重写移动端滚动手势为跟手引擎（rAF + 按行量化 + 批量发送 + 惯性）

## 目标

把 `src/gestures/scroll.ts` 从「同步累积 + 固定间隔限流 + 逐个发送转义序列」重写为
「rAF 驱动 + 按真实行高量化 + 单帧批量拼接发送 + 惯性 fling」的滚动引擎，消除两个
用户可感知症状：滑动卡顿、以及「手指移动很长距离但内容只滚动一点点」。

完整诊断与设计见 `docs/designs/mobile-scroll-experience.md`（本 worktree 内，**动手前必读**），
本卡实现的是其中的「增量 1」。

## 非目标

- 不做「跟手」（消除网络往返延迟）——那是增量 2/3 的事，本卡不碰服务端。
- 不改 `src/session.ts`、`src/serve.ts`、`src/session-protocol.ts`。
- 不改 pinch / swipe / double-tap 三个手势的行为。
- 不新增 UI 元素。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check
- **Diff-Lines-Target**：600
- **Diff-Lines-Hard**：900
- **阶段**：implementing
- **锁定决策**：
  1. 删除 `sensitivity` 与 `wheelIntervalMs` 两个配置项，不保留向后兼容别名
     （personal 风险等级、fork 未发布 npm，破坏性配置变更可接受）。
  2. 滚动引擎必须与 DOM 解耦成纯逻辑，DOM 只做薄适配层——这是本卡全部不变式可单测的前提。
  3. `strategy: 'keys'` 保持旧语义（按页发 PageUp、不做惯性），只享受批量化。
  4. 终端区域 `touch-action` 改为 `none`，不再是 `manipulation`。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：e39b206
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 创建
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：按 envelope 实际值回填
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：
  - `src/gestures/scroll.ts`（重写）
  - `src/types.ts`（`ScrollConfig` 形状）
  - `src/config.ts`（默认值）
  - `src/config-schema.ts`（Valibot 校验）
  - `src/index.ts`（手势装配，如需传新参数）
  - `src/controls/scroll-buttons.ts`（依赖 `ScrollConfig` 与 `scrollSeq`，需跟随）
  - `src/controls/help.ts`（帮助文案引用 scroll 配置，需跟随）
  - `styles/base.css`（`touch-action`）
  - `tests/gestures.test.ts`、`tests/scroll-buttons.test.ts`、
    `tests/config-validate.test.ts`、`tests/cli-config-validation.test.ts`
  - `README.md`、`.agents/skills/remobi-setup/SKILL.md`（config 形状变了必须同步）
- **禁止**：`src/session.ts` `src/serve.ts` `src/session-protocol.ts` `src/client-entry.ts`
  `.github/workflows/`；不得修改 `docs/designs/mobile-scroll-experience.md`（主脑产物）。
- **Scope-Globs**：src/gestures/scroll.ts src/types.ts src/config.ts src/config-schema.ts src/index.ts src/controls/scroll-buttons.ts src/controls/help.ts styles/base.css tests/gestures.test.ts tests/scroll-buttons.test.ts tests/config-validate.test.ts tests/cli-config-validation.test.ts README.md .agents/skills/remobi-setup/SKILL.md
- **高风险区域**：`tests/config-validate.test.ts:567` 直接断言了完整的 scroll 默认配置对象，
  改配置形状必然打穿它；`src/controls/scroll-buttons.ts` 复用 `scrollSeq`/`pageSeq` 两个导出，
  重写时不要删掉这两个函数的导出。

## 实现规格

### 新的 ScrollConfig

```ts
export interface ScrollMomentumConfig {
	readonly enabled: boolean
	/** 每帧速度衰减系数，(0,1)，建议 0.95 */
	readonly friction: number
	/** 低于此速度(px/ms)停止惯性，建议 0.02 */
	readonly minVelocity: number
}

export interface ScrollConfig {
	readonly enabled: boolean
	readonly strategy: ScrollStrategy   // 'wheel' | 'keys' 不变
	/** 跟手倍率：1 = 手指位移与内容位移 1:1 */
	readonly speedMultiplier: number
	/** herdr/tmux 收到一个滚轮事件实际滚动的行数 */
	readonly linesPerWheel: number
	readonly momentum: ScrollMomentumConfig
	/** 单帧滚动行数安全阀 */
	readonly maxLinesPerFrame: number
}
```

默认值：
```ts
scroll: {
  enabled: true,
  strategy: 'wheel',
  speedMultiplier: 1,
  linesPerWheel: 3,
  momentum: { enabled: true, friction: 0.95, minVelocity: 0.02 },
  maxLinesPerFrame: 24,
}
```

### 引擎核心（纯逻辑，不依赖 DOM）

把引擎抽成一个可单测的模块（建议 `createScrollEngine(config)` 返回带
`onTouchStart/onTouchMove/onTouchEnd/tick` 方法的对象，`tick(nowMs, cellHeight)`
返回 `{ data: string } | null`，由 DOM 适配层负责实际 `sendData`）。

每帧兑现逻辑：

```
pxPerWheel = cellHeight * linesPerWheel / speedMultiplier
wheels = trunc(pendingPx / pxPerWheel)
if wheels != 0:
  n = min(abs(wheels), floor(maxLinesPerFrame / linesPerWheel)) , 至少 1
  pendingPx -= sign(wheels) * n * pxPerWheel
  dir = pendingPx方向对应的 'up' / 'down'（保持现有方向语义：手指下拖 = 'up'）
  return { data: scrollSeq(dir, cell.x, cell.y).repeat(n) }   ← 一次发送
```

惯性：
- `onTouchMove` 用指数移动平均估计速度：`v = 0.7*v + 0.3*(dy/dt)`（dt 取事件时间差，
  下限钳到 1ms 防除零）
- `onTouchEnd` 时若 `momentum.enabled && abs(v) > minVelocity` → 进入 fling
- fling 每帧：`pendingPx += v * dt; v *= friction ** (dt / 16.7)`
- `abs(v) <= minVelocity` 或 `onTouchStart` → 停止 fling
- **`onTouchStart` 只停止 fling，不清零 `pendingPx`**（现行 `scroll.ts:138` 的清零是丢位移的根因）

### DOM 适配层

- `cellHeight` 与 SGR 目标格 `cell` 在 `touchstart` 计算一次并缓存；
  监听 `window.resize` 与 `visualViewport.resize` 使缓存失效。
  **touchmove 热路径内禁止出现 `getBoundingClientRect` / `querySelector`。**
- `cellHeight = screenRect.height / term.rows`（rows 无效时回退到现有
  `.xterm-char-measure-element` 测量路径，但只在缓存失效时走）。
- rAF 循环只在「有未兑现位移或正在 fling」时运行，空闲时必须停掉，不得常驻空转。

### CSS

`styles/base.css:30-33` 的 `.xterm-screen` 规则：`touch-action: manipulation` → `touch-action: none`。

## 完成条件

以下每条都必须能答出「代码在哪、哪个测试锁死」，答不上按未完成处理。

1. **量化无累积漂移**：连续投喂 N 个小于一行的位移，累计滚动行数
   == `trunc(总位移 * speedMultiplier / cellHeight)`，误差 0 行。
2. **touchstart 保留余量**：一次手势结束后残留 `pendingPx`，下一次 `touchstart` 后
   该余量仍参与兑现（断言未兑现位移不被丢弃）。
3. **单帧单次发送**：一帧内需要 n 个滚轮序列时，适配层只调用一次 `sendData`，
   且其参数等于单个序列重复 n 次的拼接结果。断言必须校验**调用次数**与**拼接内容**两者。
4. **fling 有限步收敛**：给定初速度，fling 在有限帧内速度降到 `minVelocity` 以下并停止；
   且 rAF 循环随之停掉（断言 raf 调度次数不再增长）。
5. **maxLinesPerFrame 钳制**：投喂一个超大位移，单帧发出的序列数不超过
   `floor(maxLinesPerFrame / linesPerWheel)`，余量留在 `pendingPx` 下一帧继续。
6. **keys 策略回归**：`strategy: 'keys'` 下仍按页发 `pageSeq`，不产生惯性。
7. **热路径无强制布局**：touchmove 处理路径中不出现 `getBoundingClientRect`
   与 `querySelector`（可用间谍/桩断言调用次数为 0）。
8. `pnpm test` 全绿、`pnpm run check` 全绿。
9. `README.md` 与 `.agents/skills/remobi-setup/SKILL.md` 中的 scroll 配置文档已同步到新形状。

## 需要在完工报告里回答的问题

- **`linesPerWheel` 实测值**：herdr 收到一个 SGR 滚轮转义序列（`\x1b[<64;x;yM` / `65`）
  实际滚动几行？默认值填了 3（tmux 惯例），请说明你是否实测过、怎么测的、实测值是多少。
  测不了就明说「未实测，沿用 3」，不要编。
- 重写后 touchmove 单次处理的最坏耗时估计（有无同步布局）。

## 提交与 PR

- 小步提交，测试绿即 commit。
- 分支即开 draft PR，commit 即 push。
- 归因 trailer 由 hook 自动注入，不要手写。
