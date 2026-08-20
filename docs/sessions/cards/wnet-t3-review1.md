# 任务卡：弱网 T3 独立审查（第 3 轮 · 真实浏览器生命周期 + 可观察状态反推）

## 目标

对已冻结的提交范围做一轮**独立**审查，判定客户端连接状态机是否满足规格，并产出 verdict。

**先做一件事**：读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。本仓 `risk-tier: personal`；本次 diff 核心是失败路径与状态迁移，
按 infra/状态机例外，判据与收敛条件提一档。

## 审查对象（H0 冻结，禁止改用分支名）

```
仓库：/home/zlx/projects/oss/remobi
范围：513d3fb89af660c5db549ebb3456b490e0f8c4c6..db6b72e5d3801e05fa13d61c49af987e0b8b96ee
```

派发时主脑会把 HEAD 实际 SHA 写在本卡末尾「现场事实」里；以那个值为准。
审查进行中若出现新提交，**不改变本轮审查对象**。

## 本轮新证据源（本轮成立的前提）

前两轮已经做过、**不算**新证据、不要重复：

1. 主脑逐行读 diff 核对状态机（epoch 守卫、snapshot 防重入、send 门槛、心跳单在途、
   退避防重复、输出缓冲字节计数）→ 抓到 4 条 finding，已修
2. 红验（新测试拷到 `513d3fb` 上必须红）
3. 修复增量四问审
4. 全量测试 + 时序 5 连跑 + 轴表逐格核对（轴 A 8/8、轴 B 5/5、轴 C 6/6、轴 D、轴 E 4/4）

**本轮必须换到下面两个证据源**，每条都要有实际命令与输出：

### 证据源 G：真实浏览器生命周期（Playwright，不是 happy-dom 单测）

现有轴表全部跑在 happy-dom 里——手工 `dispatchEvent` 一个 `visibilitychange`，
和真实浏览器把标签页切到后台**不是一回事**（真实浏览器会节流定时器、可能冻结页面、
bfcache 行为不同、WebSocket 可能被系统关闭）。

用 Playwright（chromium-android project）在真实浏览器里验证：

- 真的把页面切到后台再回来（`page.evaluate` 改 `document.visibilityState` 不算——
  用 Playwright 的真实机制，例如新开一个 page 抢焦点、或 CDP `Page.setWebLifecycleState`），
  观察 `window.__remobiSockets` 的实际变化：旧 socket 是否真的被关、是否真的建了新连接
- 后台期间定时器被浏览器节流时，重连退避与心跳的实际行为
- 真实断网恢复（`context.setOffline`）后，终端内容是否与服务端一致、有没有重复字符
- 断网期间敲键盘，恢复后**终端里绝对不能出现那些按键**（这是删队列要保住的核心保证）

**注意**：WebKit project 在本机缺系统库（`libgtk-4-1` 等）跑不起来，
**不要尝试安装系统包**；只跑 chromium-android，在 verdict 里注明 WebKit 未运行。

### 证据源 H：从「用户能观察到什么」反推（不是从代码往外看）

不要顺着代码读。列出用户在手机上**实际能看到的每一种画面**，然后反推它是否诚实：

- 四态各自显示什么文案？用户能据此知道"现在能不能输入"吗？
- 有没有哪个状态用户**永远看不到**（被 early-return、被覆盖、被更高优先级的 notice 挡住）？
- 有没有哪种情况下用户看到的提示**指向错误的动作**？
  （上一轮主脑就是用这个视角抓到"会话结束却提示重新认证"的——请找还有没有同类的）
- overlay 与终端画面的关系：什么时候盖住终端、什么时候让开？用户想读终端时能读到吗？
- `Not sent — still syncing.` 这类提示出现后，什么时候消失？会不会一直挂着误导用户？
- 连接恢复后，用户怎么知道"现在画面是新鲜的"？

每条结论都要有实际观察（截图或 DOM 断言）支撑，不要写"看代码应该是……"。

## 规格与不变式（判据来源）

设计文档：`docs/designs/weak-network-experience.md` §1「恢复可信」。

1. `synced` **只能**由当前 epoch 的完整 snapshot 产生；socket OPEN ≠ synced。
2. 旧 epoch 的任何事件（open/message/error/close/pong）都不得改变状态、写屏或完成同步。
3. 进后台立即作废 synced 并关 socket；回前台**无条件**建新连接，即使旧 socket 仍 OPEN。
4. 任一时刻最多一个活动 socket、一个重连 timer、一个在途 ping；
   `online`/`pageshow`/`visibilitychange` 只合并成一次尝试。
5. 非 synced 期间普通输入**丢弃且不排队**；resize 只保留最后一组、synced 后发一次。
6. 退避 1/2/4/8/15 秒，15 秒封顶不设次数上限；只有 snapshot 应用成功才清零计数。
7. snapshot 后丢弃 `seq <= outputWatermark` 的缓存输出，其余按 seq 升序应用；
   缓冲超 1 MiB 关闭重连。
8. 服务端消息解析失败按 `protocol-error` 处理，不静默丢弃。
9. 收到 `exit` 后不再自动重连，显示会话结束提示，保留手动重试。
10. 不新增 `ConnectionManager` 类、不新增配置项、不新增第二份连接状态。

## 判定纪律

- 每条意见必须注明违反上面哪条不变式或哪条 P1 红线；溯源不到的降一级。
- P1 红线（personal + infra 例外按 internal 档）：数据丢失 / 静默出错 / 崩溃 / 越权。
  **注意**：断线期间的按键被重放进终端属于"静默出错"且会真的执行命令，是 P1。
- 只审冻结范围。存量问题记 backlog 标"存量"。
- **已知且已接受、不要重复报的**：
  - `tests/serve-abuse.test.ts` 的超大帧测试在**本机高负载**下偶发超时
    （成功时 746ms，失败时 10 秒硬超时），根因是 `tsx cli.ts serve` 现场编译在 CPU 争用下
    超过 `waitForHttp` 的 10 秒上限；非代码缺陷，CI 未复现，已记 backlog。
  - `'Session ended — restart remobi to start a new one.'` 这个字面量在
    `client-entry.ts` 与 `reconnect.ts` 两处比较使用（P3，跨模块字符串耦合），主脑已判接受不修。
  - Playwright WebKit 在本机跑不起来（缺系统库），iOS 覆盖由真机验收承担。
- **熵增维度必查**：本次新增的状态、字段、事件（`ConnectionStatus`、`remobi-connection-notice`
  自定义事件、`notice` 变量、`exitReceived` 的新用法）逐个问「这是不是熵 +1」。
- **不要修代码**。发现问题输出有边界的修复清单，由主脑拆卡。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：40
- **Diff-Lines-Hard**：120
- **阶段**：reviewing
- **锁定决策**：审查对象是冻结 SHA 范围；不改被审代码；verdict 只新增文件。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：见「现场事实」里的 H0
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate --class big`，**新会话**，非 resume）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与定局。

## 修改边界

- **允许**：只允许**新增** `docs/sessions/260820-2016-wnet/reviews/wnet-t3-review1-verdict.md`。
  探针脚本放 `/tmp`，不要提交进仓库。
- **禁止**：`src/**`、`tests/**`、任何既有文件的修改。**不改一行被审代码。**
- **Scope-Globs**：docs/sessions/260820-2016-wnet/reviews/wnet-t3-review1-verdict.md
- **高风险区域**：Playwright 会起真实 server 与浏览器，务必收尾（关 context、杀进程、释放端口）。
  本机负载已经不低，探针请设明确超时上限，不要无界等待。

## 完成条件

- **产物入库**：verdict 文件提交到 delegate 分配的分支；报告贴出 `git log --oneline -1`
  与 `git show --stat HEAD`。
- **verdict 文件内容**必须包含：
  1. 证据源 G、H 的**实际命令与输出/截图路径**。没有实际输出的按未做处理。
  2. findings：级别、违反的不变式编号、文件:行、具体触发路径、建议修法方向（不写代码）。
  3. 最终 verdict：`pass` / `fail`，P1 计数。
  4. **明确写出「本轮没有发现问题的方向」**，供主脑判断收敛。
- **相关测试**：本卡不改代码。证据源 G 的 Playwright 必须实际运行并贴输出。
- **lint / typecheck / build**：不适用。
- **现场还原**：停在卡分支；不要留游离的 node/浏览器进程与占用端口。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①证据源 G 的真实浏览器实测 ②证据源 H 的可观察状态反推 ③findings 与 verdict
  三次提交。**
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
  - **H0（本轮审查对象的 HEAD）**：`db6b72e5d3801e05fa13d61c49af987e0b8b96ee`
    （若与实际不符，以 `git rev-parse origin/card/wnet-t3` 为准并在 verdict 写明）。
  - 改动规模：`src/client-entry.ts` +447/-…、`src/reconnect.ts`、`src/types.ts`，
    加上 `tests/client-connection.test.ts`（50 个用例）、重写的 `tests/reconnect.test.ts`、
    新增 `tests/playwright/weak-network.spec.ts`。
  - 主脑第 1 轮抓到并已修复的 4 条：接口 optional 生出静默 fallback；
    会话结束后无限重连且提示"可能需要重新认证"；按钮文案中英混用；轴表覆盖缺口。
  - 全量 `pnpm test` 46 文件 / 721 测试通过；
    `pnpm exec vitest run tests/client-connection.test.ts tests/reconnect.test.ts`
    连续 5 次均 50 测试全绿。
  - 生产部署形态（判断"会话结束"相关行为时需要）：`src/serve.ts:548-549` 是
    `await session.onExit` → `server.close()`，进程正常退出；
    `systemd/remobi.service:7` 是 `Restart=on-failure`，**正常退出不重启**。
- **下一步唯一动作**：先做证据源 G——真实浏览器的后台/前台切换，
  它是 happy-dom 单测最不可能覆盖真实行为的地方。
