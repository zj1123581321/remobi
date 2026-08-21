# 任务卡：双连接修复的判据换成新鲜度证明（别用 synced 当证据）

## 背景：这是主脑拆卡疏漏导致的，不是你做错了

上一轮的卡只要求「在 `queueImmediateConnect()` 里跳过 `CONNECTING`」。
主脑事后实测发现**那一条不够**——本地连接极快，首次 `pageshow` 到达时 socket 往往已经 `OPEN`，
守卫不生效，仍会建第二个 socket：

```
# 临时移除 onPageShow 的第二处判断，只留 CONNECTING 守卫后重跑
pnpm exec playwright test tests/playwright/weak-network.spec.ts --project=chromium-android
  1 failed        ← lock one socket on plain load
  4 passed
```

所以你在 `onPageShow()` 里补的那个判断**方向是对的、也是必要的**。
本卡只改它的**判据**。

## 目标

把 `onPageShow()` 里区分「首次加载」与「从后台回来」的判据，
从 `connectionStatus.state === 'synced'` 换成**新鲜度证明**，与不变式 I3 对齐。

## 为什么必须换

现在的实现：

```ts
const persisted = 'persisted' in event && event.persisted === true
if (!persisted && connectionStatus.state === 'synced') return
```

它把「状态显示 synced」当成了「这个连接可信」的证据——而这**正是 I3 禁止的缺席证据**，
也正是 T3 花四轮才修掉的那类判断（`docs/designs/weak-network-experience.md` 的 `## Invariants`：
「不得把"没收到坏消息"当作"状态良好"的证据」）。

具体危险路径（就是审查抓到的 F-1 的复现路径）：页面在某些平台被冻结而**没有**派发
`freeze`/`pagehide`/`visibilitychange` → 连接状态仍停留在陈旧的 `synced` →
恢复时派发 `pageshow(persisted=false)` → **当前代码直接 return，永不重连** →
用户看到陈旧画面，而 UI 显示已同步。

## 非目标

- 不动 `queueImmediateConnect()` 里的 `CONNECTING` 守卫（上一轮那条是对的，保留）。
- 不删 `persisted` 判断（bfcache 恢复必须强制重连，这条不变）。
- 不改 `FRESHNESS_WINDOW_MS` 的值、不改心跳、不改四态状态机。
- 不新增状态位或配置项。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：70
- **Diff-Lines-Hard**：180
- **阶段**：repairing
- **锁定决策**：

  1. **判据替换**（一行，加注释说明为什么）：
     ```ts
     function onPageShow(event: Event): void {
         pageHidden = false
         const persisted = 'persisted' in event && event.persisted === true
         // 首次加载也会派发 pageshow(persisted=false)，此时不该重连。
         // 判据用新鲜度证明而不是 connectionStatus.state：后者是「没收到坏消息」的
         // 缺席证据（I3 明令禁止），而 lastProvenFreshAt 只由当前 epoch 的 snapshot
         // 应用成功与 ID 匹配的 pong 写入，是在场证据。
         if (!persisted && Date.now() - lastProvenFreshAt <= FRESHNESS_WINDOW_MS) return
         queueImmediateConnect(true)
     }
     ```
  2. **这样做的效果差异**（报告里要复述）：
     - 首次加载：`connect()` 刚跑完、snapshot 刚应用，`lastProvenFreshAt` 是新的 → 不重连 ✓
     - 从后台回来且连接确实还活着（心跳一直在续）→ 不重连 ✓（与现在行为一致）
     - **从后台回来但连接早已陈旧**（冻结期间没有任何事件、心跳定时器一起被冻结，
       真实时间已过 25 秒）→ `lastProvenFreshAt` 过期 → **强制重连** ✓
       这正是当前实现漏掉的那一格。
     - 风险窗口从「只要状态还是 synced 就永不重连」收窄到「最多 25 秒」。
  3. **bfcache 路径不变**：`persisted === true` 时无条件 `queueImmediateConnect(true)`，
     不看新鲜度。

- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：`card/wnet-fix-dc` 当前 HEAD（`delegate resume`，同一 worktree 续修）
- **Branch**：`card/wnet-fix-dc`（**不是** `card/wnet-t4`；上一轮卡面有个过时的分支名，已修正）
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-fix-dc`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`）
- **Scope-Globs**：src/client-entry.ts tests/client-connection.test.ts tests/playwright/weak-network.spec.ts
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`，infra/状态机类。

## 修复卡必填

- **root_cause_group**：用「状态字段的当前值」代替「最近一次真实证明」——与 T3 三轮 finding 同源，
  也是 I3 存在的理由。
- **introduced_by_commit**：`9ea242c fix(client): preserve connecting socket during recovery`
  （上一轮为覆盖「pageshow 到达时 socket 已 OPEN」而加的判断，方向对、判据错）。
- **open_findings**：只改这一条判据。

## 不变式轴表

| 场景 | `persisted` | 新鲜度 | 期望 |
|---|---|---|---|
| 首次加载 | false | 新鲜（snapshot 刚应用） | **不**重连；socket 构造计数 = 1 |
| bfcache 恢复 | **true** | 任意 | **强制**重连（新 epoch + 完整 snapshot） |
| 后台回来，心跳一直正常 | false | 新鲜 | 不重连 |
| **后台回来，无任何事件、真实时间已过 25 秒** | false | **过期** | **强制重连**（当前实现漏掉的格子） |
| 后台回来，状态是 synced 但新鲜度过期 | false | 过期 | 强制重连（**不许**因为 state==='synced' 就跳过） |
| 页面 hidden 时 | 任意 | 任意 | 沿用既有 `pageHidden` 守卫，不建连接 |

**倒数第二、第三行是本卡的核心**，必须用 fake timers + `vi.setSystemTime` 构造
「定时器被冻结但真实时间流逝」，并断言**实际建了新 socket**（构造计数），不是只断言状态。

## 完成条件

- **产物入库**：提交到 `card/wnet-fix-dc`；报告贴出 `git log --oneline -1` 与 `git show --stat HEAD`。
- **行为验收**：
  1. 普通加载页面 socket 构造计数仍 **= 1**（上一轮的 e2e 不许退化）。
  2. 状态为 synced 但新鲜度已过期时收到 `pageshow(persisted=false)` → **确实建了新 socket**。
- **相关测试**：`pnpm test` 全量绿；轴表每格有断言。
- **e2e**：`pnpm exec playwright test tests/playwright/weak-network.spec.ts --project=chromium-android`
  全绿（上一轮新增的 `lock one socket on plain load` 必须仍然过）。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **WebKit**：本机跑不起来（缺系统库），**不要装系统包**，由 CI 验证。
- **现场还原**：停在 `card/wnet-fix-dc`；不要留 Playwright 进程。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①判据替换 ②轴表测试 两次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处。
- **反熵条款**（固定条款，原样保留）：本卡是**等量替换**——换一个判据，不新增状态位、
  不新增常量、不新增分支路径。报告须确认这一点。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 上一轮两个提交：`9ea242c fix(client): preserve connecting socket during recovery`、
    `514a9eb test(e2e): lock one socket on plain load`。本机 chromium e2e 5 passed。
  - 主脑实验证据（见开头）：移除 `onPageShow` 的第二处判断后，
    `lock one socket on plain load` 会红——**证明那个判断必要**，本卡只换判据不删它。
  - `lastProvenFreshAt` 与 `FRESHNESS_WINDOW_MS = 25_000` 由 T3 收口引入，
    只在「当前 epoch 的 snapshot 应用成功」与「ID 匹配的 pong」两处更新，是现成的在场证据。
  - main 仍红着（等本分支的修复合并）；T4 的 PR #18 也在等它。
- **下一步唯一动作**：换掉那一行判据，并补「synced 但新鲜度过期必须重连」的断言。
