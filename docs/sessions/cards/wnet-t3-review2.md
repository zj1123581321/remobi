# 任务卡：弱网 T3 独立审查（第 2 次独立轮 · 状态转移矩阵穷举 + 重入竞态）

## 目标

对收口后的冻结范围做**最后一轮**独立审查。前一轮的 finding 全部落在状态模型层，
主脑已按补丁追逐熔断做过系统性收口；本轮要回答的是：**收口收干净了吗**。

**先做一件事**：读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。本仓 `risk-tier: personal`；本次 diff 核心是失败路径与状态迁移，
按 infra/状态机例外，收敛条件提一档（连续 2 轮无新增 P1）。

## 审查对象（H0 冻结，禁止改用分支名）

```
仓库：/home/zlx/projects/oss/remobi
范围：513d3fb89af660c5db549ebb3456b490e0f8c4c6..84c3ce2c906ec6cf33c4ecb75eb9149bc4cb3fe5
```

审查进行中若出现新提交，**不改变本轮审查对象**。

## 本轮新证据源

前面已经用过、**不算**新证据、不要重复：

1. 主脑逐行读 diff（4 条 finding）
2. 红验 + 修复增量四问审（三次）
3. **真实浏览器生命周期**（CDP 冻结、`setOffline`）→ 抓到 2 条 P1
4. **从用户可观察画面反推**
5. 全量测试 + 时序 5 连跑 + 轴表逐格核对

**本轮必须换到下面两个证据源**：

### 证据源 J：状态转移矩阵穷举（针对根因所在的状态模型层）

把连接状态机画成 **(当前状态 × 输入)** 的完整矩阵，**每一格**都要填上实际行为
（读代码定位 + 关键格子实测），不许留空。

- 状态（4）：`disconnected` / `reconnecting` / `syncing` / `synced`
- 输入（至少覆盖这些）：
  - socket 事件：`open` / `close` / `error` / `message`（每种 server 消息类型分开：
    snapshot / output / exit / error / pong / 无法解析）
  - 生命周期：`visibilitychange(hidden)` / `visibilitychange(visible)` / `pagehide` /
    `pageshow` / `freeze` / `resume` / `online` / `offline`
  - 用户动作：普通 input / resize / `requestReconnect()`
  - 计时器到期：snapshot deadline / heartbeat deadline / heartbeat next /
    reconnect backoff / bufferedAmount settle
  - 时间流逝：新鲜度窗口过期（`Date.now()` 推进但无任何事件）

**要找的是这三类格子**：
1. **未定义**：代码里没有对应处理，行为取决于巧合；
2. **违反不变式**：与下方 I1/I2/I3 冲突；
3. **卡死**：某个状态在某个输入序列后再也回不到 `synced`，且没有用户可见出路。

矩阵请以表格形式写进 verdict（可按状态分成 4 张表）。

### 证据源 K：重入与竞态

用 fake timers 与手工事件构造下列情形，实测状态机是否自洽：

- 在事件处理器内部再次触发同类事件（例如 `visibilitychange` 处理中又来一次）
- 多个计时器在同一 tick 到期（snapshot deadline 与 heartbeat deadline 同时）
- `failConnection` 在 `applySnapshot` 的 `term.write` 回调**执行期间**被触发
- `connect()` 尚未完成（socket 还在 CONNECTING）时收到 `pagehide` / `offline`
- `requestReconnect()` 连续快速点击多次
- 新鲜度判据触发 `failConnection` 的同一 tick 内又收到旧 epoch 的 pong

每条都要给出实际断言或观察输出。

## 规格与不变式（判据来源）

设计文档 `docs/designs/weak-network-experience.md` 的 §1 与新增的 `## Invariants`：

- **I1**：任何使页面停止运行、或使链路不可达的情况，都必须让 `synced` 失效并关闭当前 socket。
- **I2**：任何页面恢复运行的情况，都必须建新 epoch 并取完整 snapshot 之后才能回到 `synced`。
- **I3**：不得把"没收到坏消息"当作"状态良好"的证据；`synced` 必须由在场证据支撑
  （只有当前 epoch 的 snapshot 应用成功、以及 ID 匹配的 pong，才更新 `lastProvenFreshAt`）。

另有既有不变式：epoch 隔离旧连接；非 synced 期间普通输入丢弃且不排队；
resize 只保留最后一组、synced 后发一次；退避 1/2/4/8/15 秒封顶不设次数上限；
snapshot 后丢弃 `seq <= outputWatermark`；缓冲超 1 MiB 关闭重连；解析失败按 `protocol-error`；
收到 `exit` 后不自动重连；不新增 `ConnectionManager` / 配置项 / 第二份连接状态 / 输入队列。

## 判定纪律

- 每条意见必须注明违反哪条不变式或哪条 P1 红线；溯源不到的降一级。
- P1 红线（personal + infra 例外按 internal 档）：数据丢失 / 静默出错 / 崩溃 / 越权。
  **断线期间的按键被补发进终端并执行，属于 P1。**
- 只审冻结范围。存量问题记 backlog 标"存量"。
- **已知且已接受、不要重复报**：
  - `tests/serve-abuse.test.ts` 超大帧用例在本机高负载下偶发 10 秒超时（非代码缺陷，CI 未复现）。
  - `'Session ended — …'` 字面量在两模块比较使用（P3，已判接受不修）。
  - synced/disconnected 没有独立全屏文案（主脑已判不成立：设计只要求可分辨"过期或同步中"，
    已同步由遮罩消失 + 可输入构成信号）。
  - Playwright WebKit 本机缺系统库跑不起来，iOS 覆盖由真机验收承担。
  - CDP `Page.setWebLifecycleState` 在本机 Chromium 未稳定派发 DOM `freeze`/`resume`，
    e2e 用直接派发标准事件的等价路径（已如实记录，不算虚报）。
  - `void dispose` 是为保留显式拆卸能力又不绑定到可取消导航事件的折中（已有注释）。
- **熵增维度必查**：收口新增了 `lastProvenFreshAt` 与 `FRESHNESS_WINDOW_MS`，
  同时删掉了 `beforeunload` 绑定。核验这是不是净减法，以及事件层与时间层两层防护
  是否构成了**无依据的双路径**（主脑判定它们是有意的纵深：事件是快速信号、
  时间是不依赖事件的兜底——请独立复核这个判断是否成立）。
- **不要修代码**。发现问题输出有边界的修复清单，由主脑拆卡。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：40
- **Diff-Lines-Hard**：120
- **阶段**：reviewing
- **锁定决策**：审查对象是冻结 SHA 范围；不改被审代码；verdict 只新增文件。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：`84c3ce2c906ec6cf33c4ecb75eb9149bc4cb3fe5`
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate --class big`，**新会话**，非 resume）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与定局。
  **这是 T3 的最后一轮**：本轮若 0 P1 则收敛合并；若仍有 P1，主脑会停下向用户汇报并
  升档换执行器重新设计，不再派修复卡。

## 修改边界

- **允许**：只允许**新增** `docs/sessions/260820-2016-wnet/reviews/wnet-t3-review2-verdict.md`。
  探针脚本放 `/tmp`，不要提交进仓库。
- **禁止**：`src/**`、`tests/**`、任何既有文件的修改。**不改一行被审代码。**
- **Scope-Globs**：docs/sessions/260820-2016-wnet/reviews/wnet-t3-review2-verdict.md
- **高风险区域**：矩阵穷举容易变成"读代码写表格"。**关键格子必须实测**，
  尤其是三类可疑格（未定义 / 违反不变式 / 卡死）——挑出来用测试或探针验证，不要只靠推理。

## 完成条件

- **产物入库**：verdict 提交到 delegate 分配的分支；报告贴出 `git log --oneline -1`
  与 `git show --stat HEAD`。
- **verdict 必须包含**：
  1. **完整的状态转移矩阵**（4 张表，每格有行为描述），以及标记出来的可疑格与它们的实测结果。
  2. 证据源 K 六种重入/竞态情形的实际断言或观察输出。
  3. findings：级别、违反的不变式、文件:行、具体触发路径、建议修法方向（不写代码）。
  4. 最终 verdict：`pass` / `fail`，P1 计数。
  5. **明确写出「本轮没有发现问题的方向」**。
  6. 对「事件层 + 时间层两层防护是有意纵深、不是无依据双路径」这个判断的独立复核结论。
- **相关测试**：本卡不改代码；证据源 K 的探针必须实际运行并贴输出。
- **lint / typecheck / build**：不适用。
- **现场还原**：停在卡分支；不要留游离进程与占用端口。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①状态转移矩阵 ②重入竞态实测 ③findings 与 verdict 三次提交。**
- **反熵条款**（固定条款，原样保留）：本卡不新增任何代码抽象。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行。
  该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。
  审出 P1 是 review 卡的正常产出，outcome 仍写 `succeeded`；
  只有审查工作本身没做完（被打穿、无法取证、卡在环境问题）才写 `failed`：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 收口后：全量 46 文件 / 741 测试通过；
    `client-connection` + `reconnect` 共 70 用例、5 连跑全绿；
    弱网 e2e 4 个用例（chromium-android）通过。
  - 收口改动很小：删 `window.addEventListener('beforeunload', dispose)`；
    新增 `lastProvenFreshAt`（只在 snapshot 应用成功与匹配 pong 两处更新）与
    `FRESHNESS_WINDOW_MS = 25_000`；`send()` 对普通 input 加真实时间判据，
    过期走既有 `failConnection(currentEpoch, 'heartbeat-timeout')`，**没有新增 reason 枚举值**。
  - 关键常量位置：`src/client-entry.ts:43-50`。`send()` 在 `:253` 一带；
    `applySnapshot` 的 synced 转换在 `:500` 一带；`handlePong` 在 `:548` 一带；
    生命周期监听注册在 `:717` 一带。
  - 前一轮（真实浏览器）**没有**发现问题的方向：正常断线路径的输入丢弃、snapshot 先于 output、
    心跳单在途、`exit` 后的会话结束动作、`Not sent — still syncing.` 会在 snapshot 后消失、
    无新增 `ConnectionManager`/配置项/第二份状态。
- **下一步唯一动作**：先画完整的状态转移矩阵——它是本轮唯一能系统性发现"还有哪格没想到"的手段。
