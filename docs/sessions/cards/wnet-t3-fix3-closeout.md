# 任务卡：弱网 T3 收口 — 新鲜度靠时间证明，不靠事件到齐

## 为什么是收口卡而不是又一张修复卡

三轮审查的 finding **全部落在同一个边界**上：

| 轮次 | finding | 落点 |
|---|---|---|
| 主脑第 1 轮 | 会话结束（`exit`）后仍无限重连并提示"重新认证" | 页面/会话生命周期 |
| 审查第 3 轮 F-1 | 浏览器冻结后旧 epoch 仍被当作 synced | 页面生命周期 |
| 审查第 3 轮 F-2 | 离线时 `readyState===OPEN` 放行按键进浏览器缓冲 | 链路可达性 |
| 主脑本轮 | `beforeunload` → dispose 移除全部监听（beforeunload 触发 ≠ 页面卸载） | 页面生命周期 |

按 `/home/zlx/projects/personal/agent-config/core-lead.md` 的**补丁追逐熔断**：
finding 反复落在同一状态模型/生命周期边界上时，**禁止继续派单点修复卡**，必须做系统性收口。
本卡就是那次收口。

## 一句话重述用户可感知目标

用户在手机上离开、锁屏、切网、切标签，几十分钟后回来——remobi 必须**重新证明**画面是新鲜的，
并且这段时间里敲下的任何按键**绝不能**被补发进终端。

## 领域不变式（本卡要把它们钉死）

- **I1**：任何使页面停止运行、或使链路不可达的情况，都必须让 `synced` 失效并关闭当前 socket。
- **I2**：任何页面恢复运行的情况，都必须建新 epoch 并取完整 snapshot 之后才能回到 `synced`。
- **I3（本卡新增，也是三轮 finding 的共同根因）**：
  **不得把"我没收到坏消息"当作"状态是好的"的证据。**
  事件（`visibilitychange`/`pagehide`/`freeze`/`offline`…）是**开放集合**——
  规范在演进、各平台行为不同、不保证触发；`readyState===OPEN` 与 `send()` 成功返回同理，
  它们都只是**缺席证据**。`synced` 必须由**在场证据**支撑。

## 根因层级判定

不是单点实现问题，也不是数据归一化问题，而是**状态模型**层：
现有实现把"事件"当成状态转换的唯一触发器，于是每发现一个没监听的事件就补一个监听器——
下一个平台差异出现时同样会漏。

## 目标

加一层**不依赖任何事件**的新鲜度证明，并删掉那个反过来制造风险的 `beforeunload` 绑定。

## 非目标

- **不删** `freeze`/`resume`/`offline`/`visibilitychange`/`pagehide`/`pageshow`/`online` 这些监听——
  它们是**快速**信号，本卡新增的是**兜底**层，两者并存是有意的纵深，不是重复。
- 不新增 `ConnectionManager`、第二份连接状态、输入队列。
- 不改服务端、`src/controls/**`、`src/asr/**`。
- 不改心跳间隔与 deadline。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：260
- **Diff-Lines-Hard**：480
- **阶段**：repairing
- **锁定决策**：

  1. **删掉 `window.addEventListener('beforeunload', dispose)`**（`src/client-entry.ts:714`）。
     理由：`beforeunload` 触发**不代表页面真的卸载**（用户可取消导航；iOS Safari 在某些
     切换/锁屏路径下的触发时机历史上就与桌面不同）。而这个 dispose 会移除**连接状态机的
     全部生命周期监听**——一旦误触发而页面继续存活，页面就永久死掉、再也不会重连。
     页面真正卸载时浏览器会自动回收监听器与 socket，**不需要**手动 dispose。
     `dispose()` 函数本身保留（测试与未来的显式拆卸仍可用），只是不再绑到 `beforeunload`。
     注意 `src/index.ts:165` 那个既有的 `beforeunload`（overlay 的 dispose，`{once:true}`）
     **不在本卡范围**，不要动。
  2. **新增新鲜度证明 `lastProvenFreshAt`**（这是本卡唯一允许新增的状态）：
     - 类型：`number`（`Date.now()` 时间戳），初值 `0`。
     - **只在两处更新**（这两处是仅有的"在场证据"）：
       ①当前 epoch 的 snapshot 应用成功、进入 `synced` 时；
       ②收到当前 epoch 且 id 匹配的 pong 时。
     - 常量 `const FRESHNESS_WINDOW_MS = 25_000`。取值理由写进代码注释：
       心跳间隔 10 秒、deadline 15 秒，正常情况下这个值每 10 秒刷新一次；
       25 秒留出足够余量，正常链路不会误判，而心跳 deadline 会先于它触发。
     - **判据**：在 `send()` 放行普通 input 之前，除现有条件外再加一条——
       `Date.now() - lastProvenFreshAt <= FRESHNESS_WINDOW_MS`。
       不满足时：**立即**失效 `synced`（走既有 `failConnection`，reason 用既有的
       `'heartbeat-timeout'`，**不要**新增 reason）、本次输入走既有丢弃路径与提示、
       并触发既有的重连排程。
  3. **为什么这一条能收口**：页面被浏览器冻结时，`setTimeout` 也一起被冻结，
     所以心跳 deadline **不会**按真实时间触发；而 `Date.now()` 走的是真实时间。
     冻结 30 分钟后恢复，即使一个生命周期事件都没收到、即使 socket 还显示 OPEN，
     第一次要发东西时就会发现"我已经 30 分钟没证明过自己是新鲜的"→ 立即失效重连。
     **这不依赖任何事件到齐。**
  4. **resize 例外保持**：resize 不受新鲜度判据约束（它本来就在非 synced 时只覆盖保存）。
  5. **设计文档**：在 `docs/designs/weak-network-experience.md` 的
     `## Known Limitations` 之后新增 `## Invariants`（或追加到已有章节，不要改动既有正文），
     把 I1 / I2 / I3 三条写进去，每条写明**代码在哪、哪个测试锁死**。
     I3 要写清楚它的由来（三轮 finding 都落在同一边界）。

- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：`card/wnet-t3` 当前 HEAD（`delegate resume`，同一 worktree 续修）
- **Branch**：继续用 `card/wnet-t3`
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-t3`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`）。
  **升档预警**：这是同一执行器的第 3 轮。前两轮各自都收敛了（改对了卡面要求的东西），
  本轮是熔断后的收口而非"同一问题没修好"，所以仍由你来做。
  但**如果本轮之后仍有 finding 落在生命周期/可达性边界上**，主脑会升档换执行器并重新设计，
  不会再派第四张修复卡。
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`，infra/状态机例外，
  收敛条件连续 2 轮无新增 P1。

## 修复卡必填

- **root_cause_group**：状态模型层——把开放集合的「事件」当成状态转换的唯一触发器，
  用缺席证据代替在场证据。
- **introduced_by_commit**：`918db8c`（状态机骨架确立事件驱动模型）；
  `beforeunload` 绑定由本轮 fix2 的 `b46c14f` 引入。
- **open_findings**：只做锁定决策 1、2、5 三件事，不得超出。

## 不变式轴表

### 轴 H：新鲜度证明（本卡核心）

| 场景 | `lastProvenFreshAt` | 敲普通键 | 期望 |
|---|---|---|---|
| 刚应用 snapshot 进入 synced | 刚更新 | 立即敲 | 正常发出 |
| 匹配 pong 刚到 | 刚更新 | 立即敲 | 正常发出 |
| synced 后静默 24 秒（有 pong 续着） | 24 秒内有更新 | 敲 | 正常发出（**不能误伤**） |
| 定时器被冻结、真实时间过去 26 秒、无任何事件 | 26 秒前 | 敲 | 失效 synced、本次输入丢弃并提示、触发重连 |
| 定时器被冻结 30 分钟后恢复、socket 仍 OPEN | 30 分钟前 | 敲 | 同上（**这是 F-1 的兜底**） |
| 失效后重连成功、新 snapshot 应用 | 重新更新 | 敲 | 恢复正常发送 |
| resize（非 input） | 任意 | — | 不受新鲜度判据约束，沿用既有覆盖保存语义 |

测试用 fake timers + 可控的 `Date.now()`（`vi.setSystemTime`）实现"定时器冻结但真实时间流逝"。

### 轴 I：beforeunload 不再致命

| 场景 | 期望 |
|---|---|
| 触发 `beforeunload` 但页面继续存活 | 生命周期监听**仍在**；后续 `visibilitychange`/`online` 仍能触发重连；socket 状态机仍工作 |
| 显式调用 `dispose()` | 监听器被移除、连接被 suspend（函数本身仍可用） |

两张表每一格都要有断言。**轴 H 第三行（24 秒内不误伤）是本卡最容易做坏的地方。**

## 完成条件

- **产物入库**：提交到 `card/wnet-t3`；报告贴出 `git log --oneline -1` 与 `git show --stat HEAD`。
- **降层三问**（本卡必答，写进报告）：
  1. 在 `synced` 被判定失效之前，已经发生了哪些**不可逆**动作？
  2. 守卫用的那个值（现在是 `lastProvenFreshAt`）在实际部署形态下自身可靠吗？
     它会不会也变成一种"缺席证据"？
  3. 保护覆盖的是"状态"还是"真实行为（发帧 / 写屏）"？
- **行为验收**：
  1. 冻结 30 分钟等价场景（fake timers + `setSystemTime`）：不发任何事件，敲键 → 不发帧、走重连。
  2. 正常链路持续使用 5 分钟（心跳正常）：输入全程正常，**零误判**。
  3. `beforeunload` 后页面存活：仍能重连。
- **相关测试**：`pnpm test` 全量绿（禁止 `-k` 子集）。轴 H、轴 I 每格有断言。
- **概率性验收**：`pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`
  **连续 5 次全绿**，结果贴进报告。
- **e2e**：`pnpm exec playwright test tests/playwright/weak-network.spec.ts --project=chromium-android`
  保持全绿（现有 4 个用例不许退化）。WebKit 按已知环境限制跳过并注明。
- **跨发布边界验收**：轴 H 第 4/5 行必须断言**实际发出的 WebSocket 帧数为 0**，
  不是只断言状态变了。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **已知可忽略**：`tests/serve-abuse.test.ts` 的超大帧用例在本机高负载下偶发 10 秒超时，
  非代码缺陷，重跑即过；如实记录即可，不要为它改代码。
- **现场还原**：停在 `card/wnet-t3`；不要留 Playwright 起的 server / 浏览器进程。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①删 beforeunload 绑定 + 轴 I 测试 ②lastProvenFreshAt 与 send 判据
  ③轴 H 测试（含 24 秒不误伤的正向用例） ④设计文档三条不变式 至少 4 次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：本卡**只允许**新增 `lastProvenFreshAt` 一个状态与
  `FRESHNESS_WINDOW_MS` 一个常量，并且**删掉**一个 `beforeunload` 绑定。
  报告须写明：没有新增 reason 枚举值、没有新增连接状态、没有新增输入队列、
  没有为它新建模块或类。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 本轮 fix2 已验收通过的部分（**不要动**）：`freeze`/`resume` 复用 `onPageHide`/`onPageShow`；
    `offline` 复用 `suspendConnection()`；`bufferedAmount` 的 100ms settle 判据
    （实测正常快速输入峰值 840 字节、静置 250ms 归零，单次 `>0` 会误伤，故用 settle）；
    轴 F / 轴 G 测试；4 个弱网 e2e 用例。
  - 全量测试 46 文件 / 732 测试；`client-connection` + `reconnect` 共 61 个用例、5 连跑全绿。
  - 心跳常量：间隔 `HEARTBEAT_INTERVAL_MS = 10_000`、deadline `HEARTBEAT_DEADLINE_MS = 15_000`
    （`src/client-entry.ts:44-45`）。
  - `send()` 在 `:249-266`；`applySnapshot` 进入 synced 在 `:450` 一带；
    `handlePong` 在 `:502` 一带；生命周期监听注册在 `:708-715`。
  - 执行器上一轮如实报告了两件事，主脑已确认并接受：
    ①CDP `Page.setWebLifecycleState` 在本机 Chromium 未稳定派发 DOM `freeze`/`resume`，
    因此 e2e 用直接派发标准事件的等价路径（没有虚报真实冻结覆盖）；
    ②全量测试首轮 731/732，唯一失败是已知的 serve-abuse 本机 flake，重跑即过。
- **已否决方案**（不得重新提起）：给普通输入加队列；新增 `ConnectionManager` 或第二份连接状态；
  删掉 freeze/resume/offline 监听改为纯轮询；把 `navigator.onLine` 当作"可达"的正向证据；
  为新鲜度失效新增一个 `ConnectionFailureReason` 枚举值。
- **下一步唯一动作**：先删 `beforeunload` 绑定并补轴 I 测试——它是当前唯一在生产路径上
  可能让页面永久死掉的东西。
