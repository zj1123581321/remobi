# 任务卡：修复首次加载建两个 WebSocket（main 已红）

## 目标

页面**每次加载**都会构造两个 WebSocket：第一个刚进入 `CONNECTING` 就被第二个顶掉。
WebKit 为此打 console error，导致 `main` 分支 CI 从 T3 合并起一直是红的；
Chromium 不打这条日志，所以只是静默多一次握手。

修完之后：普通加载页面**只构造一个 socket**，main 转绿。

## 非目标

- 不改四态状态机、epoch、快照、心跳、退避、新鲜度判据、输入门槛。
- 不删 `pageshow` / `visibilitychange` / `freeze` / `resume` / `online` / `offline` 任何一个监听。
- 不新增连接状态、配置项或第二份事实源。
- 不动 T4 的 composer 提交逻辑。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：90
- **Diff-Lines-Hard**：220
- **阶段**：repairing
- **锁定决策**：

  1. **根因**（主脑已用探针实测坐实，不必重新论证）：
     `src/client-entry.ts` 末尾先注册 `pageshow` 监听、再调用 `connect()`。
     浏览器对**首次加载**同样会派发 `pageshow`（`persisted=false`），
     于是 `onPageShow()` → `queueImmediateConnect(true)`。
     `force=true` 绕过了 `queueImmediateConnect` 里"已 synced/syncing 就跳过"的守卫，
     microtask 里再次 `connect()`，而 `connect()` 会 `previousSocket?.close()` ——
     那个 socket 此刻还在 `CONNECTING`，于是 WebKit 打出
     `WebSocket connection to '…/ws' failed: WebSocket is closed before the connection is established.`
  2. **修法**：在 `queueImmediateConnect()` 里，当前 socket 处于 `WebSocket.CONNECTING` 时**直接返回**。
     ```ts
     function queueImmediateConnect(force = false): void {
         if (pageHidden || immediateAttemptQueued) return
         // 还在 CONNECTING 的 socket 尚未产生任何 snapshot，因此它不是 I2 所说的
         // 「必须被替换的陈旧连接」——让它连完，随后照常走 snapshot 才进 synced。
         // 在这里把它拆掉，正是 WebKit 报 "closed before the connection is established" 的原因。
         if (socket?.readyState === WebSocket.CONNECTING) return
         if (!force && (connectionStatus.state === 'synced' || connectionStatus.state === 'syncing')) return
         …既有逻辑不变…
     }
     ```
  3. **为什么这不违反 I2**（报告里要复述这条论证）：
     I2 要求"任何页面恢复运行的情况都必须建新 epoch 并取完整 snapshot 之后才能回到 synced"。
     一个还在 `CONNECTING` 的 socket **从未进入过 synced、也从未应用过 snapshot**，
     它不是需要被作废的陈旧连接；让它连接完成后照常走 `applySnapshot()` 才进 `synced`，
     I2 完全成立。真正需要 `force` 打断的是**已经 OPEN/synced** 的旧连接，那条路径不受本改动影响。
  4. **卡死风险已排除**（报告里要确认）：若 socket 永远卡在 CONNECTING，浏览器自身的连接超时
     会派发 `error`/`close`，走既有 `failConnection()` → 退避重连；不会因为跳过而永久不重连。
  5. **不要**用"加一个 initialConnectDone 标志"之类的新状态来只修首次加载——
     用 `readyState` 判断同时修好了"连接建立途中又来一个恢复事件"的所有情形，且零新增状态。

- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：`50dd69801b5f95885089787e961b4f0571e7dade`（`card/wnet-t4` 的 HEAD；
  本修复直接落在 T4 分支上，与 T4 一起合并，避免 main 长时间红着）
- **Branch**：`card/wnet-t4`（delegate resume 到 T4 的 dispatch，同一 worktree 续修）
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-t4`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`）
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`。

## 修复卡必填

- **root_cause_group**：把"恢复运行"的强制重连语义套用到了**尚未建立**的连接上——
  `force` 的本意是打断陈旧的已同步连接，却连正在握手的连接一起打断。
- **introduced_by_commit**：T3 的 `918db8c` 一线（`queueImmediateConnect` 的 force 语义与
  末尾的 `pageshow` 注册 + `connect()` 顺序）。
- **open_findings**：只修这一条。

### 实测证据（主脑已取，直接引用即可）

用 Playwright 在 chromium-android 上覆盖 `window.WebSocket` 计数，普通 `page.goto('/')`
加载完成后：

```
socket constructs on plain load = 2
Expected: 1
Received: 2
```

CI 侧对应的 WebKit 失败（`main@1a00a263` 与 `card/wnet-t4@50dd698` 两次完全相同）：

```
[webkit-iphone] › tests/playwright/smoke.spec.ts:10:1 › loads without console errors
  + "WebSocket connection to 'ws://127.0.0.1:17681/ws' failed: WebSocket is closed before the connection is established."
[webkit-iphone] › tests/playwright/proxy.spec.ts:124:1 › reverse-proxied subpath access …
  + 同样一条
```

## 不变式轴表

| 场景 | 当前 socket 状态 | 期望 |
|---|---|---|
| 首次加载（`connect()` 后浏览器派发 `pageshow`） | CONNECTING | **不**再建第二个 socket；构造计数 = 1 |
| `pageshow`（bfcache 恢复），旧 socket 已 OPEN 且 synced | OPEN | 照旧强制建新 epoch（`force` 语义不变） |
| `visible`，旧 socket OPEN 但未 synced（syncing 中） | OPEN | 照旧 `force` 建新 epoch |
| `online`（非 force），已 synced | OPEN | 照旧跳过 |
| 恢复事件到达时正在握手 | CONNECTING | 跳过，让它连完；随后 snapshot 才进 synced |
| socket 永远卡在 CONNECTING | CONNECTING | 浏览器超时派发 error/close → 既有 failConnection → 退避重连（不会永久不重连） |
| `pageHidden` 时任何恢复事件 | 任意 | 照旧不建连接 |

每格都要有断言。**第一行必须用 socket 构造计数断言**，不是只断言状态。

## 完成条件

- **产物入库**：提交到 `card/wnet-t4`；报告贴出 `git log --oneline -1` 与 `git show --stat HEAD`。
- **行为验收**：
  1. 普通加载页面，WebSocket 构造计数 **= 1**。
  2. bfcache/前后台恢复仍然强制建新 epoch（不许为了修这条把 force 语义削掉）。
- **相关测试**：`pnpm test` 全量绿。
  轴表每格有断言（单测用假 WebSocket 计数构造次数即可）。
- **e2e 防回归（必须新增）**：在 `tests/playwright/weak-network.spec.ts` 追加一条——
  覆盖 `window.WebSocket` 统计构造次数，`page.goto('/')` 后断言**恰好 1 次**。
  这条正是主脑的探针，把它固化下来，避免以后再有人重新引入二次连接。
- **概率性验收**：`pnpm exec playwright test tests/playwright/weak-network.spec.ts --project=chromium-android`
  **连续 3 次全绿**，结果贴进报告（这条是时序相关的）。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **WebKit**：本机缺系统库跑不起来，**不要装系统包**；这条修复能否真正让 WebKit 转绿
  由 CI 验证，报告里注明"本机未验证 WebKit，待 CI 确认"。
- **现场还原**：停在 `card/wnet-t4`；不要留 Playwright 进程。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①CONNECTING 守卫 + 单测轴表 ②e2e 防回归 两次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处。
- **反熵条款**（固定条款，原样保留）：本卡是**净减法**——加一个 readyState 判断，
  不新增状态位、不新增标志、不新增配置项。报告须确认这一点。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - `main` 从 `1a00a263`（T3 合并）起 CI 一直红；`card/wnet-t4@50dd698` 同样两条失败。
    T3 的 PR 分支 `55befb6` 当时是绿的——**这是时序竞态，PR 绿只是运气**。
  - `queueImmediateConnect()` 在 `src/client-entry.ts`，
    `pageshow` 注册在 `:797`、初始 `connect()` 在 `:801`。
  - T4 的改动全是加法（bridge 方法、sessionId 跟踪、回执分发），**没有碰连接时序**，
    它的 CI 红是从 main 继承来的。
  - 本机跑不了 WebKit（缺 `libgtk-4-1` 等），跨浏览器差异只能靠 CI 发现。
- **下一步唯一动作**：加 CONNECTING 守卫，并用 socket 构造计数把它锁死。
