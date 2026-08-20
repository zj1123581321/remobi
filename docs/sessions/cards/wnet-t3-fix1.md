# 任务卡：弱网 T3 修复 1 — 接口去 optional、会话结束不再假装重连、补齐轴表

## 目标

修掉主脑验收 T3 时发现的四条问题。T3 的状态机主体（epoch 隔离、snapshot deadline、
单在途心跳、退避、删队列、resize 合并、1 MiB 上限）已经逐行核对通过，本卡**不要动它们**。

## 非目标

- 不改状态机核心逻辑：`connect()` / `failConnection()` / `applySnapshot()` / `handleOutput()` /
  `sendHeartbeat()` / `handlePong()` / `scheduleReconnect()` 的既有行为全部保持。
- 不改服务端、`src/controls/**`、`src/asr/**`、`src/config.ts`。
- 不做 T4 的 composer 原子提交。
- 不新增配置项、不新增状态位、不新增第二条 fail 路径。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：350
- **Diff-Lines-Hard**：620
- **阶段**：repairing
- **锁定决策**：

  1. **F1 修法（净减法）**：把 `XTerminal` 的
     `getConnectionStatus` / `onConnectionStatusChange` / `requestReconnect` 三个成员
     **从 optional 改成必填**，同时删掉 `src/reconnect.ts:100-102` 那个静默 fallback：
     ```ts
     if (!term.getConnectionStatus || !term.onConnectionStatusChange || !term.requestReconnect) {
         return () => {}     // ← 删掉：term 缺方法就整个 UI 静默消失，是个陷阱
     }
     ```
     以及 `:109` 的 `term.requestReconnect?.()` 里的可选链。
     **这三个测试桩文件本次明确允许修改**（上一轮它们不在允许清单里，执行器只能把接口做成
     optional——那是主脑拆卡的失误，不是你的问题）：
     `tests/fixtures.ts`（3 处桩）、`tests/keyboard-mode.test.ts`（2 处）、
     `tests/font-persistence.test.ts`（1 处）。给每个桩补上三个方法的最小实现即可。
  2. **F2 修法**：收到 `exit` 之后**不再自动重连**。
     现状：`exitReceived = true` 只用来在 close 时换一句文案，重连照常无限进行；
     3 次失败后显示 `Connection failed — you may need to re-authenticate.`——**这是错的**，
     真实原因是 herdr 会话结束、`remobi serve` 已经退出。
     **现场事实**：`src/serve.ts:548-549` 是 `await session.onExit` → `server.close()`，
     进程正常退出（exit 0）；生产 `systemd/remobi.service:7` 是 `Restart=on-failure`，
     **正常退出不会重启**。所以服务不会自己回来，无限重连只是白耗手机电量并显示错误原因。
     改成：
     - `exitReceived` 为真时，`failConnection` 之后**不调用** `scheduleReconnect()`；
     - 状态置 `disconnected`，通过既有的 `remobi-connection-notice` 事件发出
       `Session ended — restart remobi to start a new one.`；
     - **保留**「立即重试」按钮可用（用户可能刚手动重启了服务），点它走
       `requestReconnect()` 正常建连；若又收到 exit 则再次停下。
     - 「重新认证」按钮在这个状态下**不显示**（它不是认证问题）。
     不要为此新增状态位——`exitReceived` 已经存在，用它就够了。
  3. **F3 修法**：两个按钮文案改成英文，与全项目 UI 一致：
     `立即重试` → `Retry now`，`重新认证` → `Re-authenticate`。
     （中文是主脑卡面里的中文描述被直接抄成了字面量，属于卡面表述不清，不是你的问题。）
     同步更新 `tests/reconnect.test.ts` 里断言这两个文案的地方。
  4. **F4 修法：补齐轴表覆盖**。T3 卡的完成条件写的是「表驱动测试必须覆盖上面六张表的每一格」，
     实际交付 16 个用例，六张表里**整片没覆盖的方向**见下方轴表。
     补测试时优先用 `test.each` 表驱动（现有 `tests/reconnect.test.ts` 已经是这个写法，照抄风格）。

- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：`card/wnet-t3` 当前 HEAD（本卡走 `delegate resume`，同一 worktree 续修）
- **Branch**：继续用 `card/wnet-t3`
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-t3`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`，同一执行器第 1 轮修复）
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`，
  本卡仍属 infra/状态机类，收敛条件连续 2 轮无新增 P1。

## 修复卡必填

- **root_cause_group**：三条同源于「卡面边界写窄了/写含糊」，一条是覆盖没做到位。
  F1 是允许清单漏了测试桩 → 接口被迫 optional → 生出静默 fallback；
  F2 是卡面只说了"删队列、原地重连"，没说"会话结束怎么办"；
  F3 是卡面用中文描述按钮；F4 是轴表没被逐格落实。
- **introduced_by_commit**：本轮 `card/wnet-t3` 的 11 个提交（F1 主要在 `918db8c`
  引入的接口定义与 `reconnect.ts` 改造；F2/F3/F4 是整体交付的缺口）。
- **open_findings**：只修下面四条，不得超出。

### F1（P2）接口 optional 生出静默 fallback

`src/types.ts:266-273` 三个新成员带 `?`；`src/reconnect.ts:100-102` 因此加了一条早退分支——
term 不提供这三个方法时 `setupReconnect` **什么都不做就返回**，连接状态 UI 整个消失且无任何提示。
生产 bridge 总是提供，所以这是死代码 + 陷阱；同时 T4 消费时还要处处判 undefined。

### F2（P2）会话结束后仍无限重连，并显示错误的失败原因

触发路径：用户在手机上敲 `exit`（或 herdr 崩溃）→ PTY 退出 → 服务端广播 `exit` 后
`server.close()`、进程 exit 0 → systemd `Restart=on-failure` 不重启 → 客户端收到 `exit`
（`exitReceived = true`）却继续按 1/2/4/8/15 秒无限重连 → 3 次后显示
`Connection failed — you may need to re-authenticate.`。
用户被引向"重新认证"，而真实动作是重启 remobi 服务。手机端还在持续重连耗电。
另外 `showSessionStatus('Session ended')`（`src/client-entry.ts:273-276`）因为
`config.reconnect.enabled` 默认 `true` 而 early-return，所以"会话已结束"这个真实原因
**用户永远看不到**。

### F3（P3）按钮文案中英混用

`tests/reconnect.test.ts:95` 实测断言 `['立即重试', '重新认证']`，而同一 overlay 的状态文案
是英文（`Not sent — still syncing.` / `Output too fast — resyncing.` / `Connection failed — …`）。

### F4（卡面完成条件未满足）轴表覆盖缺口

现有 16 个用例集中在「syncing 丢输入 + resize 合并 + 匹配 pong」与「四态文案渲染」。
六张表里**整片没有覆盖**的方向见下方轴表，这些恰好是最容易写错、也最难靠人眼看出来的部分。

## 不变式轴表（本卡必须补齐的格子）

### 轴 A：页面生命周期（T3 卡轴 1，当前 0 覆盖）

| 事件 | 前置状态 | 检测点 |
|---|---|---|
| `hidden` | synced，socket OPEN | 立即离开 synced；重连/心跳 timer 被清；旧 socket 被 `close()` |
| `pagehide`（persisted=false） | synced | 同上 |
| `pagehide`（persisted=true） | synced | 同上 |
| `visible` | 旧 socket 仍 OPEN | 建**新** epoch 新 socket；旧 socket 后续事件不改状态 |
| `pageshow`（persisted=true） | 已关闭 | 建新 epoch |
| `visible`+`online`+`pageshow` 同帧 | disconnected | **只创建一个** socket、一个 timer |
| `online` | 页面可见且离线 | 触发一次立即尝试 |
| `online` | 页面 `hidden` | **不**建连接 |

### 轴 B：epoch 守卫（T3 卡轴 2，当前 0 覆盖）

| 旧 epoch 的迟到事件 | 检测点 |
|---|---|
| snapshot | 不写屏、不进 synced、不清失败计数 |
| output | 丢弃 |
| pong | **不续命**当前 epoch 的心跳 deadline |
| close / error | 不计失败、不触发退避 |
| open | 忽略 |

### 轴 C：退避与失败计数（T3 卡轴 6，当前只覆盖文案）

| 场景 | 检测点 |
|---|---|
| 连续第 1/2/3/4/5 次同步前失败 | 重连延迟依次为 1s / 2s / 4s / 8s / 15s（fake timers 断言实际延迟） |
| 第 6 次及以后 | 恒 15s，仍继续重试 |
| socket OPEN 但 snapshot 超时 | 算**一次**同步前失败 |
| snapshot 成功应用 | 失败计数清零、退避回到 1s、认证提示消失 |
| 页面 `hidden` 期间 | 重连 timer 不运行 |
| 用户点「立即重试」 | 立刻尝试一次，**不清零**失败计数 |

### 轴 D：snapshot / output 交错与溢出（T3 卡轴 4，当前部分覆盖）

| 场景 | 检测点 |
|---|---|
| 缓存 seq 1..5、watermark=3 | 丢弃 1-3，按序应用 4、5，屏幕无重复 |
| 缓存 seq 1..5、watermark=5 | 全部丢弃 |
| output 乱序到达（5 先于 4） | 按 seq 升序应用 |
| 缓冲累计 > 1 MiB | **真的**塞够字节触发 `output-overflow`，socket 被关、走退避重连 |
| 10 秒无 snapshot | 计一次同步前失败，socket 被关 |
| 收到无法解析的服务端帧 | `protocol-error`，**不静默丢弃** |

### 轴 E：会话结束（F2 新增）

| 场景 | 检测点 |
|---|---|
| 收到 `exit` 后 socket close | **不再** `scheduleReconnect()`；文案为 `Session ended — restart remobi to start a new one.` |
| 会话结束状态下 | 「重新认证」按钮不显示；「立即重试」可用 |
| 点「立即重试」后又收到 `exit` | 再次停下，不进入无限重连 |
| 点「立即重试」后正常 synced | 恢复正常，文案清空 |

## 完成条件

- **产物入库**：提交到 `card/wnet-t3`；报告贴出 `git log --oneline -1` 与 `git show --stat HEAD`。
- **行为验收**：
  1. `XTerminal` 三个新成员必填，`grep -n "getConnectionStatus?\|onConnectionStatusChange?\|requestReconnect?" src/types.ts` 零命中；`reconnect.ts` 里那条早退分支已删。
  2. 手机上敲 `exit` 结束会话 → 看到 `Session ended — restart remobi to start a new one.`，
     **不再**看到"可能需要重新认证"，也**不再**持续重连。
  3. 两个按钮显示 `Retry now` / `Re-authenticate`。
  4. 轴 A–E 每一格都有断言。
- **相关测试**：`pnpm test` 全量绿（禁止 `-k` 子集）。
  封笔前贴出 `grep -rn "getConnectionStatus\|onConnectionStatusChange\|requestReconnect" src/ tests/`。
- **概率性验收**：`pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`
  **连续跑 5 次全绿**，5 次结果贴进报告。
- **跨发布边界验收**：继续用假 WebSocket 捕获 `send(payload)` 的**字符串实参**再 `JSON.parse`
  比对；轴 C 的退避延迟用 fake timers 断言**实际 setTimeout 的毫秒值**，不要只断言"重连发生了"。
- **e2e**：`pnpm exec playwright test tests/playwright/weak-network.spec.ts --project=chromium-android`
  保持绿。WebKit project 在本机缺系统库（`libgtk-4-1` 等）跑不起来，**这是已知环境限制，
  不要尝试安装系统包**，在报告里照实写"WebKit 未运行"即可，iOS 覆盖由真机验收承担。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **现场还原**：停在 `card/wnet-t3`；不要留 Playwright 起的 serve 进程。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①F1 接口去 optional + 三个测试桩 ②F2 会话结束停重连 ③F3 文案
  ④轴 A 生命周期 ⑤轴 B epoch 守卫 ⑥轴 C 退避时序 ⑦轴 D 溢出与交错 ⑧轴 E 会话结束
  至少 8 次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：F1 与 F2 都应当是**减法**（删 optional、删 fallback、
  删掉一条不该走的重连路径）。报告须确认没有新增状态位、配置项或第二条 fail 路径。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取，均已实测）**：
  - T3 主体已逐行核对通过：`connect()` 每个事件处理器都有 `if (myEpoch !== currentEpoch) return`；
    `applySnapshot` 在 `term.write` 回调里二次校验 epoch 并用 `snapshotApplying` 防重入；
    `send()` 只在 synced+OPEN 才发、resize 在非 synced 只存最后一组；
    `handleOutput` 用 Map(seq→data) 且同 seq 覆盖时正确扣减字节；
    `sendHeartbeat` 三重守卫 + 单在途 id；`scheduleReconnect` 有 `reconnectTimer !== undefined`
    防重复。**这些不要动。**
  - `notSentNoticeShown` 在进入 synced 时（`client-entry.ts:465`）会重置，不是全局只提示一次。
  - 全量 687 测试绿；时序 5 连跑绿；红验：`tests/client-connection.test.ts` 的 2 条在
    `513d3fb` 上均 AssertionError 失败，确认在测本次改动。
  - 需要补桩的三个文件的自建桩数量：`tests/fixtures.ts` 3 处、
    `tests/keyboard-mode.test.ts` 2 处、`tests/font-persistence.test.ts` 1 处。
    `tests/mic-controller.test.ts` **0 处**（不构造 XTerminal 对象），不用改。
  - `src/controls/mic-controller.ts` 只**消费** `isConnected` / `onConnectionChange`，
    不构造 XTerminal，接口改必填不会打穿它。
- **已否决方案**（不得重新提起）：为 F1 保留 optional 并在 T4 处处判 undefined；
  为 F2 新增一个 `sessionEnded` 状态位（`exitReceived` 已经够用）；
  为 WebKit 缺依赖去装系统包。
- **下一步唯一动作**：先做 F1——把三个成员改必填并补三个测试桩，让那条静默 fallback 无处可藏。
