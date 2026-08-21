# 设计：移动端滚动体验

**状态**：设计定稿，待实现
**日期**：2026-08-21
**Base**：e39b206

## 问题

在手机上用 herdr 的 remobi WebUI 时，上下滑动体验有三个症状：

1. **卡顿** —— 滑动过程掉帧
2. **不跟手** —— 手指动了，画面延迟才动
3. **慢** —— 手指移动很长距离，内容只滚动一点点

## 诊断

### 现行实现

`src/gestures/scroll.ts` 把触摸位移累积成 `accDelta`，每超过 `sensitivity`（默认 40px）
就往 PTY 发一个 SGR 鼠标滚轮转义序列，并用 `wheelIntervalMs`（默认 24ms）限流。

一次滚动的完整链路：

```
touchmove → sendData → WebSocket → PTY → herdr 回滚并重绘整屏
          → 整屏 ANSI 回传 → WebSocket → xterm 解析 → 渲染
```

**滚动的每一小步都是一次完整网络往返 + 整屏重绘。**

### 症状 ③「慢」的根因：限流器吞掉位移

关键数字对撞：

| 量 | 值 |
|---|---|
| touchmove 事件间隔 | 16.7ms（60Hz）/ 8.3ms（120Hz） |
| `wheelIntervalMs` 限流 | 24ms |

限流周期长于触摸事件周期，所以 **60Hz 下平均每 1.4 帧、120Hz 下平均每 2.9 帧
才允许发出一个滚轮事件**。

快速滑动（约 3000px/s）时：

- 位移以 3000px/s 累积进 `accDelta`
- 最多消耗 `40px × (1000/24) ≈ 1667px/s`
- **净堆积 ≈ 1300px/s**

而堆积的余量最终会被丢弃：`drainScrollDelta` 在限流命中时 `break`
（`scroll.ts:114`），`onTouchEnd` 不做排空，下一次 `onTouchStart` 直接
`state.accDelta = 0`（`scroll.ts:138`）。

连续快滑几次，丢弃量累积 —— 这就是「手指走了很长、屏幕只动一点」。

### 症状 ①「卡顿」的根因

- **消息风暴**：每秒最多 41 条 WebSocket 消息，每条触发 herdr 全屏重绘 + 回传 +
  xterm 全量解析。手机 GPU 扛不住这个频率的全屏刷新。
- **热路径强制布局**：`touchToCell()` 在 touchmove 里每次调
  `getBoundingClientRect()`，未命中 `term.cols/rows` 时还会 `querySelector`
  （`scroll.ts:48-62`）。
- **浏览器与 JS 抢手势**：`.xterm-screen` 是 `touch-action: manipulation`
  （`styles/base.css:32`），**未**禁用浏览器平移手势。浏览器先在合成器线程启动滚动预测，
  JS 的 `preventDefault()` 再取消它 —— 每帧双重工作。
- **四路手势串行**：swipe / pinch / scroll / double-tap 都挂在同一批 touch 事件上。

### 症状 ②「不跟手」的根因：滚动跨了网络

跟手意味着输入到像素的延迟在一帧内（<16ms）。只要滚动要过网络，就做不到。

这是架构问题，不是调参问题。

## 第一性原理

> 滚动的本质是「在一段**已经存在**的历史文本上移动视窗」。
> 这段历史存放在哪里，决定了滚动能不能本地化。

现在的**历史所有权错位**：herdr 是全屏 TUI，使用 alternate screen；滚出屏幕的内容
归 herdr 所有。而按 VT 规范与 xterm.js 实现，**alternate buffer 不保留 scrollback**，
所以浏览器端 xterm 那 5000 行 scrollback（`client-entry.ts:224`）是空的。

浏览器「没得可滚」，只能求 herdr —— 于是每一步都要过网。

### 已排除的路径

**改 herdr**：不现实（本仓是独立 fork，不跨仓改代码）。

实测 herdr 现有能力也不够：

```
$ herdr pane read w15:p2 --source visible  → 78 行
$ herdr pane read w15:p2 --source recent   → 78 行   （= 当前屏高）
$ herdr pane read w15:p2 --source recent --lines 20000 → 78 行
```

`--source recent` 并不返回深度 scrollback，herdr 不提供历史导出。

**本地预测平移**：在 touchmove 时用 CSS `transform` 先平移画布、等服务端内容回来再校正。
对地图/图片成立，对终端不成立 —— 平移会露出空白，且无法预测露出的内容。**方案不成立。**

## 方案

分三个增量，第一个治「慢+卡」，后两个治「不跟手」。

### 增量 1：跟手滚动引擎（重写手势层）

把「同步、限流、逐个发」改成「rAF 驱动、按行量化、批量发」。

**核心变换**

```
每帧（requestAnimationFrame）：
  lines = trunc(pendingPx * speedMultiplier / cellHeight / linesPerWheel)
  if lines != 0:
    n = clamp(|lines|, 0, maxLinesPerFrame)
    pendingPx -= sign(lines) * n * linesPerWheel * cellHeight / speedMultiplier
    sendData(term, scrollSeq(dir, x, y).repeat(n))     ← 一次发送，不是 n 次
```

要点：

1. **删除 `wheelIntervalMs` 限流**，改用 rAF 天然节流（每帧至多一次发送）。
2. **按真实行高换算**：`cellHeight = screenRect.height / term.rows`，
   做到 1:1 跟手，取代拍脑袋的 `sensitivity: 40`。
3. **批量拼接**：一帧内的 N 行滚动拼成**一个字符串一次发送**，
   WebSocket 消息数从 N 降到 1。
4. **余量不丢**：`pendingPx` 只在兑现时按整行扣减，`touchstart` 保留余量
   （仅停止 fling），不清零。
5. **惯性 fling**：touchend 时按速度继续滚动。
   - 速度用指数移动平均估计：`v = 0.7·v + 0.3·(dy/dt)`
   - 每帧 `pendingPx += v·dt; v *= friction^(dt/16.7)`
   - `|v| < minVelocity` 或用户再次触摸 → 停止
6. **热路径零 DOM 查询**：`cellHeight` 与 SGR 目标格在 touchstart 缓存一次，
   `resize` / `visualViewport.resize` 时失效。
7. **`touch-action: none`**：终端区域交给 JS 独占，浏览器不再做无用的滚动预测。

**配置迁移**

```ts
interface ScrollConfig {
  enabled: boolean
  strategy: 'wheel' | 'keys'
  /** 跟手倍率：1 = 手指位移与内容位移 1:1 */
  speedMultiplier: number
  /** herdr/tmux 收到一个滚轮事件滚动的行数（tmux 默认 3，herdr 需实测校准） */
  linesPerWheel: number
  momentum: { enabled: boolean; friction: number; minVelocity: number }
  /** 单帧滚动行数安全阀，防止一帧把 PTY 打爆 */
  maxLinesPerFrame: number
}
```

- 删除 `sensitivity`、`wheelIntervalMs`
- `strategy: 'keys'` 保持旧语义（按页发 PageUp、不做惯性），只享受批量化

**已知未知：`linesPerWheel`**

herdr 收到一个 SGR 滚轮事件实际滚几行，决定跟手比例是否准确。tmux 默认 3。
herdr 需实测校准，实测值写进默认配置与报告。

**设计约束：引擎与 DOM 解耦**

滚动引擎抽成不依赖 DOM 的纯逻辑 —— 输入是「时间戳 + 位移」事件序列，输出是
「待发送序列」列表；DOM 只做薄适配。这样全部不变式都能纯函数单测。

**不变式与测试锚点**

| 不变式 | 测试 |
|---|---|
| 像素→行量化无累积漂移：连续小位移的总行数 == `trunc(总位移/行高)` | `tests/gestures.test.ts` |
| `touchstart` 保留余量，不丢弃未兑现位移 | 同上 |
| 一帧 N 行只产生 1 次 `sendData`，内容是 N 个序列拼接 | 同上 |
| fling 速度单调衰减且有限步终止 | 同上 |
| `maxLinesPerFrame` 钳制生效 | 同上 |
| `strategy: 'keys'` 行为回归不变 | 同上 |

**预期收益**：症状 ③ 与 ① 基本消除。症状 ②（跟手）仍在，需增量 2/3。

### 增量 2：服务端 scrollback 影子历史（spike 先行）— **已证伪，NO-GO**

> 2026-08-21 spike 结论：**不可行**。证据见
> `docs/sessions/260821-1053-scroll/spike-scrollback-evidence.md`，探针见 `spikes/scrollback/`。
> 下面保留原始设计以说明失败原因；实际路线见文末「实施结果与路线更新」。

要真正跟手，历史必须搬到浏览器。既然 herdr 不导出历史，只剩一条路：
**在服务端被动观察，自己重建历史。**

`src/session.ts` 已有一个 `HeadlessTerminal` mirror（`session.ts:102`）看到 herdr 的完整
ANSI 流。alternate buffer 虽无 scrollback，但每一行内容在被滚出屏幕之前，**一定在屏幕上
出现过**。于是可以做**帧差分重建**：

```
每次 PTY 输出后：
  当前帧 = 读 mirror alternate buffer 全部行
  与上一帧做对齐：若 当前帧[0..k] == 上一帧[n..n+k]（n>0）
    → 判定向上滚动了 n 行
    → 把 上一帧[0..n-1] 追加进影子历史 ring buffer
  否则（对不齐）→ 判定为非滚动重绘，不追加
```

这个方案是**被动观察**：不向 herdr 注入任何按键、不进 copy-mode、不污染用户会话状态。
代价是只能积累 remobi 服务端运行期间看到的历史。

**保守原则**：对不齐就不追加。宁可漏历史，不可插入错误内容。

**这是本设计里唯一的高不确定性环节，必须先 spike 取证，不直接派实现卡。**

spike 要回答：

1. herdr 是否确实使用 alternate screen（抓 `\x1b[?1049h`）
2. agent 输出滚动时，帧间是否呈现「内容整体上移 N 行」的稳定模式
3. 帧差分对齐算法在真实会话上的准确率
4. 误判场景清单：切 tab、开弹窗、resize、pane split、全屏重绘

**GO / NO-GO 判据**

- **GO**：≥10 分钟真实 agent 输出会话中，重建历史与 herdr 自身回滚所见内容
  一致率 ≥95%，且**零错误插入**
- **NO-GO**：降级到方案 B（下节）

**NO-GO 降级方案 B：翻页式滚动**

不重建历史，改变往返粒度以匹配信道特性：手指滑动时本地不滚、只给橡皮筋视觉反馈；
手指抬起时按总位移一次性发送 N 行滚动请求，herdr 一次重绘回传一屏。

消除卡顿与消息风暴，但放弃跟手。这是「每帧一个 RTT」信道下的诚实交互模型
（同远程桌面、电子墨水屏的取舍）。

### 增量 3：客户端原生滚动层（依赖增量 2 的 GO）— **随增量 2 一同搁置**

服务端把影子历史推给客户端，客户端渲染成一个**独立的可滚动 DOM 层**，用浏览器
**原生滚动** —— 完美跟手、有惯性、有回弹、零 JS 参与。

- 进入滚动态：请求历史（一次 RTT），渲染滚动层覆盖在终端上
- 滚动中：纯本地，零网络
- 退出：回到 live 终端

这是移动端终端（Blink、Termius）的通行做法，也是唯一能真正跟手的路。

协议扩展（`src/session-protocol.ts`）在 spike 判 GO 后随增量 2 一并定稿。

## 落地顺序

| 增量 | 内容 | 状态 |
|---|---|---|
| 1 | 跟手滚动引擎 | **已合并**（PR #23，`f73de34`） |
| 2-spike | 帧差分重建取证 | **已完成，判 NO-GO**（PR #24，`623ab05`） |
| 2 | 影子历史 + 协议 | **搁置**——前提被证伪 |
| 3 | 客户端原生滚动层 | **搁置**——依赖增量 2 |

## 实施结果与路线更新（2026-08-21）

### 增量 1 已交付

`src/gestures/scroll.ts` 重写为 rAF 驱动的跟手引擎，五轮交付（首轮 + 四轮修复）后合并。
关键不变式各有一条经**反证验证**的行为测试锁死——反证做法是把对应实现改坏，确认测试变红：

| 不变式 | 反证动作 | 反证结果 |
|---|---|---|
| keys 策略单帧至多一页 | 回退到修复前实现 | 红（旧实现发 3 个 `\x1b[5~`） |
| `stopFling()` 真的停止惯性 | 清空其函数体 | 红（`expected true to be false`） |
| 每次 touchstart 重新测量行高 | 重新引入布局缓存 | 红（`expected 2 to be greater than 2`） |
| 单帧只调用一次 `sendData` | 改成逐字符循环发送 | 红（`expected 55 to be 1`） |
| 热路径零布局查询 | 插入一次**间接**布局调用 | 红（`expected 12 to be 2`） |

### 增量 2 为什么不可行

spike 证明瓶颈不在对齐算法，而在**信息源头就已丢失**：herdr 作为 TUI 有自己的渲染循环，
两个渲染 tick 之间滚过屏幕的行从未被画出，PTY 流里根本不存在，下游任何算法都无法重建。

捕获率完全由内容生产速率决定，且呈悬崖式：

| 输入形态 | 捕获率 |
|---|---|
| paced 流式（10ms/行，类似 agent 逐字输出） | 99.0% |
| `seq 1 5000` 突发 | 1 / 5000 |
| 真实负载（92.7 万行连续滚屏，302 秒） | 0.11% |

这份结论自洽：同一探针在流式下 99%、突发下近 0，说明差分算法本身工作正常，
差别只在输入节奏。全场景零错误插入——保守原则生效，失败模式全是漏记。

### 下一步：先实测，再决定

原降级方案 B（翻页式滚动）相对增量 1 是**体验取舍而非纯改进**：它把往返从每帧一次降到
每次手势一次，但放弃连续滚动感。是否值得，取决于增量 1 落地后的实际手感。

因此**先在真机上实测增量 1**，同时校准 `linesPerWheel`（当前默认 3 来自 tmux 惯例，
执行器如实报告未实测），再决定：

- 手感够用 → 增量 2/3 不做，收工
- 仍卡顿 → 说明瓶颈确实在每帧一次的网络往返上，此时再权衡方案 B 的取舍

若未来 herdr 提供历史导出 API（事件流或 pane buffer 查询），增量 2 可免于本信道限制，
届时可用 `spikes/scrollback/` 的探针重开验证。
