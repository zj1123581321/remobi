# 任务卡：弱网 T3 修复 2 — 冻结恢复要重新证明，离线时 OPEN socket 不算可达

## 目标

修掉第 3 轮独立审查在**真实 Chromium** 里抓到的两条 P1。两条同源：
**把"浏览器还没告诉我坏消息"当成了"链路是好的"**。

状态机主体（epoch、snapshot、心跳、退避、缓冲、resize 合并）已经三轮核对通过，**不要动**。

## 非目标

- 不新增 `ConnectionManager` / 第二份连接状态 / 第二个 socket 管理器。
- 不给普通输入加队列、清空或重放机制——**恰恰相反**，本卡要堵住的就是"输入被别人代为排队"。
- 不改服务端、`src/controls/**`、`src/asr/**`、`src/config.ts`。
- 不为 F-3 加常驻 UI 指示器（理由见「已否决」）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：200
- **Diff-Lines-Hard**：420
- **阶段**：repairing
- **锁定决策**：

  1. **F-1 修法：把 Page Lifecycle 的 `freeze` / `resume` 纳入同一条失效契约。**
     现在只监听了 `visibilitychange` / `pagehide` / `pageshow` / `online`
     （`src/client-entry.ts:633-660`）。浏览器冻结页面时**不保证**先发这四个里的任何一个，
     而 `freeze`/`resume` 正是 Page Lifecycle API 为这个场景定义的标准事件。
     - `document` 的 `freeze` → 走与 `pagehide` **完全相同**的 `suspendConnection()`；
     - `document` 的 `resume` → 走与 `pageshow` **完全相同**的 `queueImmediateConnect(true)`；
     - 复用现有函数，**不要**为它们写第二套逻辑；
     - 两个监听在 dispose 时一并移除。
     修完之后，"恢复后必须走 suspend → 新 epoch → 完整 snapshot"这条对**所有**恢复路径成立，
     不再依赖"恰好先收到 visibilitychange"。
  2. **F-2 修法：`readyState === OPEN` 不再等于可达。** 分两层，都要做：
     - **第一层（事件）**：监听 `window` 的 `offline` 事件（现在只监听了 `online`）。
       收到 `offline` 立即失效 `synced` 并关闭当前 socket——直接复用
       `suspendConnection()` 或 `failConnection()` 的既有路径，不要新写一条。
     - **第二层（真凭据）**：`send()` 成功返回不证明数据出去了。在放行普通 input 之前，
       检查当前 socket 的 `bufferedAmount`：**如果上一帧还没排空（`bufferedAmount > 0`），
       说明链路已经不通**，立即失效 `synced` 并关闭 socket，本次输入走既有丢弃路径。
       请先用探针实测正常网络下敲键时 `bufferedAmount` 是否稳定为 0
       （普通按键只有几字节，正常应当立即排空），把实测结果写进报告；
       如果实测发现正常路径下它也会短暂非 0，就改用"连续 N 次仍非 0"或换一个等价的
       可达性凭据，并在报告里说明你的判据和实测数据。
     - **resize 例外保持不变**：非 synced 时仍然只覆盖保存最后一组值，synced 后发一次。
     - **不要**降低心跳 deadline 来"顺便"缩小窗口——心跳是兜底，本卡要的是第一可观察信号。
  3. **F-3 判为不成立，不修**（reviewer 提出 synced/disconnected 缺独立可见文案）。
     设计文档 §1 的原话是「旧画面可以暂时保留，但必须明确标记为**过期或同步中**」——
     过期（`Disconnected`/`Reconnecting…`）与同步中（`Syncing…`）都有全屏文案；
     "已同步"由**遮罩消失 + 终端可输入**构成可观察信号，设计没有要求它再有独立文案。
     手机屏幕本就局促，加常驻角标是净增 UI 熵。**降为 P3、接受不修**，本卡不处理。

- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：`db6b72e5d3801e05fa13d61c49af987e0b8b96ee`（`card/wnet-t3` 当前 HEAD）
- **Branch**：继续用 `card/wnet-t3`（`delegate resume`，同一 worktree 续修）
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-t3`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`，同一执行器**第 2 轮**修复；再不收敛主脑会升档换执行器）
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`，
  infra/状态机例外，收敛条件连续 2 轮无新增 P1。

## 修复卡必填

- **root_cause_group**：把"浏览器还没报坏消息"当成"链路是好的"——
  F-1 依赖生命周期事件恰好触发，F-2 依赖 `readyState` 与 `send()` 返回值。两者都是**缺席证据**，
  不是**在场证据**。
- **introduced_by_commit**：`918db8c`（连接状态机骨架，确立了 `readyState===OPEN` 放行与
  四事件生命周期监听）及其后续。
- **open_findings**：只修 F-1、F-2，不得超出。

### F-1（P1）浏览器冻结后旧 epoch 仍被当作 synced

- 违反不变式 3。位置 `src/client-entry.ts:633-660`、`:570-615`。
- 审查实测（真实 Chromium，CDP `Page.setWebLifecycleState({state:"frozen"})` 冻结 2500ms）：
  期间**没有** `visibilitychange`/`pagehide`；恢复 active 后 DOM 仍 `state="synced"`、
  `window.__remobiSockets[0].readyState===1`、socket 数不变。冻结期间由第二个页面向同一 PTY
  写入 marker，thaw 后第一个页面在**没有新 snapshot、没有新 socket**的情况下就显示了该 marker。
- 为什么是 P1：用户回来看到的画面**碰巧**是新的，但客户端**无法证明**它是新的。
  一旦冻结期间真的丢了帧或 socket 被系统悄悄回收，客户端会把旧画面当最新——
  这正是整个设计第一条不变式要消灭的东西。

### F-2（P1）离线时 OPEN socket 让按键进浏览器发送队列，恢复后真的执行

- 违反不变式 5。位置 `src/client-entry.ts:249-266`（`send()` 的放行条件）、`:626-629`（输入入口）。
- 审查实测（真实 Chromium，`context.setOffline(true)` 2500ms）：
  DOM/bridge 仍报 `synced`、socket `OPEN`；用键盘输入 marker 后，
  WebSocket `input` 帧逐字符发出、**`bufferedAmount` 递增**；恢复网络 5 秒后终端**真的执行**了
  该输入，显示 `bash: <marker>: command not found`。
- 为什么是最严重的一条：T3 删掉应用层 `queuedMessages` 就是为了根除"断线按键被重放"，
  但**浏览器 WebSocket 自己有发送缓冲**——队列换了个地方存在，危害一模一样：
  重放的按键会真的执行到 herdr 里去。

## 不变式轴表

### 轴 F：生命周期恢复的完整边界

| 触发 | 期望 |
|---|---|
| `document` `freeze` | 与 `pagehide` 同路径：立即离开 synced、清 timer、关 socket |
| `document` `resume` | 与 `pageshow` 同路径：建**新** epoch、取完整 snapshot |
| `freeze` → `resume`（无 visibilitychange） | 恢复后 `state !== 'synced'` 直到新 snapshot 应用；socket 是**新**的 |
| `freeze` 期间服务端有输出 | thaw 后这些输出**只能**通过新 snapshot / 新 epoch 的 output 到达，不得由旧 socket 直接写屏 |
| `resume` 与 `pageshow`/`visible` 同时到达 | 仍然只建**一个** socket（沿用既有事件合并） |
| dispose | `freeze`/`resume` 监听一并移除 |

### 轴 G：可达性凭据

| 场景 | 期望 |
|---|---|
| `window` `offline` 事件 | 立即离开 synced 并关闭当前 socket |
| offline 期间敲普通键 | **零** WebSocket 帧发出；走既有丢弃路径与 `Not sent — still syncing.` |
| offline 期间 resize | 只覆盖保存最后一组值，不发帧 |
| 恢复 `online` | 建新 epoch、取新 snapshot；**离线期间敲的键绝不出现在终端里** |
| `bufferedAmount > 0`（上一帧未排空）时再敲键 | 判定链路不通：离开 synced、关 socket、本次输入丢弃 |
| 正常网络连续敲键 | `bufferedAmount` 稳定排空，输入照常发出（**不能误伤正常输入**，必须有测试锁死） |
| offline 事件未触发的网络黑洞 | 心跳 15 秒兜底（既有行为，不改） |

两张表每一格都要有断言。**轴 G 倒数第二行（不误伤正常输入）是本卡最容易做坏的地方**，
必须有正向测试。

## 完成条件

- **产物入库**：提交到 `card/wnet-t3`；报告贴出 `git log --oneline -1` 与 `git show --stat HEAD`。
- **行为验收**：
  1. 真实 Chromium 冻结 → 恢复：新 socket、新 snapshot 之后才回到 synced。
  2. 真实 Chromium offline → 敲键 → 恢复：**终端里没有那些按键**（这是本卡的核心验收）。
  3. 正常网络下连续快速敲键，输入全部正常送达，无误伤。
- **相关测试**：`pnpm test` 全量绿（禁止 `-k` 子集）。轴 F、轴 G 每格有断言。
- **e2e（本卡必须新增，happy-dom 测不出这两条）**：
  在 `tests/playwright/weak-network.spec.ts` 追加：
  - `context.setOffline(true)` → 键盘输入 → `setOffline(false)` → 断言终端里**不含**该输入；
  - 冻结/恢复用例：若 Playwright 能稳定驱动 CDP `Page.setWebLifecycleState`，就实测；
    驱动不稳定则在报告里写明并改用可靠的等价路径（例如断言 `resume` 事件处理器确实走了
    新 epoch），**不要**声称测了实际没测的东西。
  只跑 `--project=chromium-android`；WebKit 本机缺系统库，按已知环境限制跳过并注明。
- **概率性验收**：`pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`
  **连续 5 次全绿**，结果贴进报告。
- **跨发布边界验收**：offline 场景必须断言**实际发出的 WebSocket 帧数为 0**
  （不是"状态变了"），恢复后再断言终端文本不含 marker。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **现场还原**：停在 `card/wnet-t3`；不要留 Playwright 起的 server / 浏览器进程。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①freeze/resume 接入 ②offline 事件失效 ③bufferedAmount 可达性判据（含正向不误伤测试）
  ④轴 F 测试 ⑤轴 G 测试 ⑥弱网 e2e 至少 6 次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：F-1 与 F-2 都必须**复用既有函数**
  （`suspendConnection` / `queueImmediateConnect` / `failConnection` / 既有丢弃路径）。
  报告须写明没有新增第二套生命周期逻辑、没有新增连接状态、没有给输入加任何队列。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 第 3 轮 verdict `fail`，P1=2（F-1、F-2）、P2=1（F-3，主脑判不成立已降 P3 不修）。
    verdict 全文：`docs/sessions/260820-2016-wnet/reviews/wnet-t3-review1-verdict.md`。
  - 第 3 轮**没有**发现问题的方向（本卡不要动、也不要重新验证）：正常断线路径的输入丢弃、
    snapshot 先于 output、心跳单在途、`exit` 后的会话结束动作与 `Re-authenticate` 隐藏、
    `Not sent — still syncing.` 会在 snapshot 后消失、无新增 `ConnectionManager`/配置项/第二份状态。
  - 现有生命周期监听在 `src/client-entry.ts:633-660`：只有 `visibilitychange`、`pagehide`、
    `pageshow`、`online` 四个；`suspendConnection()` 在 `:563`，
    `queueImmediateConnect(force)` 在 `:545`。
  - `send()` 在 `:249-266`，放行条件是 `state === 'synced' && socket?.readyState === OPEN`。
  - 已知环境限制：Playwright WebKit 在本机缺系统库跑不起来，**不要装系统包**；
    `tests/serve-abuse.test.ts` 的超大帧测试在本机高负载下偶发 10 秒超时，非代码缺陷。
- **已否决方案**（不得重新提起）：给普通输入加队列/清空/重放；新增 `ConnectionManager`
  或第二份连接状态；靠降低心跳 deadline 缩小窗口；为 F-3 增加常驻 UI 指示器；
  用 `navigator.onLine` 作为"可达"的正向证据（它只反映网卡状态，不反映真实可达性——
  只能用它的 `offline` 事件作为"不可达"的**负向**信号）。
- **下一步唯一动作**：先做 F-2 的第一层（`offline` 事件失效 synced），它直接堵住那条
  "按键被浏览器缓冲后真的执行"的路径。
