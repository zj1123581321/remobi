# 任务卡：弱网 T2 独立审查（第 2 轮 · 降层 + 调用方 + 运行时实测）

## 目标

对已冻结的提交范围做一轮**独立**审查，判定它是否满足下面的规格与不变式，并产出 verdict 文件。

**先做一件事**：读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。本仓 `risk-tier: personal`；但本次 diff 的核心是**失败路径、状态迁移与
资源账本**，按 infra/状态机例外，判据与收敛条件提一档。

## 审查对象（H0 冻结，禁止改用分支名）

```
仓库：/home/zlx/projects/oss/remobi
范围：ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb..ad0109bc5174257607f452eeeea620e91e17cc1f
PR：  https://github.com/zj1123581321/remobi/pull/13
```

审查进行中若出现新提交，**不改变本轮审查对象**，统一留给下一轮。

## 本轮新证据源（这是本轮成立的前提，不是可选项）

上一轮已经做过的、**不算**本轮新证据、不要重复：

- 通读 `ba25ddf..ad0109b` 的 diff 并逐条对照契约（已做，0 P1）；
- `pnpm test` 全量 664 绿（已跑）；
- 时序测试连跑 5 次全绿（已跑两遍：实现方 5 次 + 主脑独立 5 次）；
- 红验抽查：把 `tests/session-action.test.ts` 与 `tests/session.test.ts` 拷到 `ba25ddf` 的
  临时 worktree 单独运行，两组各 4 条新测试全部 AssertionError 失败、9 条旧测试仍绿
  （已做，证明新测试不是恒真断言）。

**本轮必须换到下面四个证据源**，每一条都要有实际执行的命令/探针输出写进 verdict：

### 证据源 A：降层三问（不是读 diff，是回答机制问题）

1. **在终态写入成功之前，已经发生了哪些不可逆动作？** 把 `input-action` 从收帧到回
   `input-accepted` 的整条路径上每一个有外部副作用的调用列出来（PTY 写入、broadcast、
   client.close、mirror 写入……），标出哪些在"记账"之前就已经发生。
   有没有哪个不可逆动作发生了、但账本没记（于是重送会再做一次）？
2. **去重守卫用的那个 `id`，在真实部署形态下自身唯一吗？** 注意去重 Map 是
   **session 级**而不是 client 级。两个浏览器标签页/两台手机同时连同一个 session、
   各自生成 id 时会发生什么？id 由**客户端**提供意味着什么？
3. **保护覆盖的是"写入"还是"行为"？** 去重 Map 拦住的到底是"再写一次 Map"还是
   "再写一次 PTY"？有没有绕过 Map 仍能触达 `pty.write` 的路径（例如 legacy `input`）？

### 证据源 B：调用方视角（本轮 diff **没有**触及、但受其影响的代码）

`src/serve.ts` 是 `handleClientMessage()` 与 `addClient()` 的唯一调用方，本次 diff **一行没改它**。
请实际打开它审：

- `closeForProtocolViolation` 那条路径在新协议下还正确吗？新增的 `input-action` / 带 id 的
  `ping` 在 parse 失败时走的是同一条路，行为可接受吗？
- `SessionClient.send` 里的 `try{}catch{}`（发送竞态静默吞掉）会不会把新增的
  `input-accepted` / `input-rejected` 也一起吞掉？吞掉之后客户端会怎样、可接受吗？
- `void session.addClient(client).catch(...)` 这条路径遇到新的 mirror fail-loud 时表现如何？
- `wss.options.maxPayload` 与 `MAX_CLIENT_MESSAGE_BYTES` 的关系有没有因为新消息类型而失配？

### 证据源 C：node-pty 的真实失败语义（**必须实测，不许靠读代码推断**）

实现把 `pty.write(data)` 的**同步**异常转成 `input-rejected(pty-write-failed)`。
这条依赖一个未经验证的假设：**node-pty 的 write 失败会同步抛异常**。

请实际验证：写一个探针，让底层 PTY 处于会导致写入失败的状态
（例如子进程已退出但 `exited` 标志尚未置位的窗口、fd 已关闭、或你能构造的其他真实失败态），
观察 `pty.write()` 到底是同步抛、静默吞、还是异步 emit error。

**如果它不同步抛**，那么 `pty-write-failed` 这条分支在真实运行中永远不会触发，
而 `input-accepted` 会在 PTY 其实没写进去的情况下发出——这直接违反核心不变式
「accepted 只在 PTY write 成功后发出」，是 P1。把探针命令与实际输出写进 verdict。

### 证据源 D：多客户端并发

起一个真实 server，**同时**接两个 WebSocket 客户端，覆盖至少：

- 两个客户端各自 attach，拿到的 `sessionId` 是否相同、`outputWatermark` 是否各自正确；
- 两个客户端**同时**发 `input-action`（不同 id）→ PTY 收到几次？
- 客户端 A 发 id=X，客户端 B 也发 id=X 但 data 不同 → B 得到什么？这个行为可接受吗？
- 一个客户端触发了 mirror fail-loud → 另一个客户端看到什么？

## 规格与不变式（判据来源，每条意见都要溯源到这里）

设计文档：`docs/designs/weak-network-experience.md` §1「恢复可信」、§3「提交不重不漏」。
本次改动要满足的不变式：

1. **`accepted` 只在 `pty.write(data)` 成功返回之后发出**，且发出前 `{id,data}` 已写入去重 Map。
   顺序错了 = accepted 丢失后的重送会产生第二次 PTY 写入。
2. **同 id 同 data 重送不产生第二次 `pty.write`**；同 id 不同 data 回 `id-conflict` 且不写 PTY。
3. **snapshot 的 `outputWatermark` 与 `data` 必须一致**：data 里包含且仅包含
   `seq <= outputWatermark` 的输出。稳定循环的 `return` 之前不允许再有 `await`。
4. **mirror 写失败必须 fail-loud**：粘性错误、广播不含终端正文的 error、关闭现有连接、
   拒绝后续 attach。绝不允许静默吞掉——snapshot 是从 mirror 序列化出来的，
   吞掉 mirror 失败等于让"画面是新鲜的"变成假话。
5. **拿不到可靠 id 就不许伪造 rejected**：畸形帧走协议违规关连接，不发 rejected。
6. **legacy `{type:'input'}` 行为不变**，旧客户端不受影响。
7. `sessionId` 每个 `SharedTerminalSession` 一个，只随 snapshot 下发。
8. 不新增类/模块/持久化/TTL/fallback/重试。

## 判定纪律

- 每条意见必须注明**违反上面哪条不变式**或哪条 P1 红线；溯源不到的意见默认降一级。
- 本仓 `risk-tier: personal`，P1 红线 = 数据丢失 / 静默出错（结果错但不报错）/ 崩溃；
  **infra 例外**：本次 diff 核心是失败路径与资源账本，判据按 internal 档执行。
- **只审本次 diff**。存量问题（例如 `serve.ts` 里那个发送竞态 catch 是本次之前就有的）
  记 backlog 并写明"存量"，不占用循环 —— 但如果它**因为本次改动**而产生了新的坏后果
  （例如吞掉新增的 accepted），那就是本次的问题，照常提。
- **熵增维度必查**：本次新增的每个抽象/状态/字段（`inputActions` Map、`mirrorFailed`、
  `outputSeq`、`sessionId`、`MAX_ACTION_ID_BYTES`、`StorageReadResult` 之类），
  逐个问「这是不是熵 +1」——单实现接口、转发-only 层、与现有状态镜像、无第二消费者的通用化，
  命中即提意见（默认 ≤P2）。
- **不要修代码**。本卡是只读审查，发现问题输出有边界的修复清单，由主脑拆卡。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：40
- **Diff-Lines-Hard**：120
- **阶段**：reviewing
- **锁定决策**：审查对象是冻结的 SHA 范围；不改被审代码；verdict 只新增文件不覆写卡。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：ad0109bc5174257607f452eeeea620e91e17cc1f
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate --class big`，**新会话**，非 resume）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与定局。

## 修改边界

- **允许**：只允许**新增** `docs/sessions/260820-2016-wnet/reviews/wnet-t2-review1-verdict.md`
  （目录不存在就创建）。探针脚本请放在 `/tmp` 下，不要提交进仓库。
- **禁止**：`src/**`、`tests/**`、任何既有文件的修改。**本卡不改一行被审代码。**
- **Scope-Globs**：docs/sessions/260820-2016-wnet/reviews/wnet-t2-review1-verdict.md
- **高风险区域**：起真实 server / PTY 做探针时，务必收尾（`dispose()`、关端口、杀子进程），
  不要留下游离进程。

## 完成条件

- **产物入库**：verdict 文件提交到 delegate 分配的 `card/<worktree 名>` 分支；
  报告贴出 `git log --oneline -1` 与 `git show --stat HEAD` 的实际输出。
- **verdict 文件内容**必须包含：
  1. **本轮四个证据源各自的实际命令与输出**（A 降层三问的回答、B 调用方审查、
     C node-pty 实测探针、D 多客户端并发实测）。没有实际输出的证据源按未做处理。
  2. findings 列表，每条带：级别（P1/P2/P3）、违反的不变式编号、
     文件:行、**具体触发路径**（什么输入/时序 → 什么错误结果）、建议修法方向（不写代码）。
  3. 最终 verdict：`pass` / `fail`，以及 P1 计数。
  4. 明确写出「本轮没有发现问题的方向」，供主脑判断收敛。
- **相关测试**：本卡不改代码，无需跑全量。但证据源 C、D 的探针必须实际运行并贴输出。
- **lint / typecheck / build**：不适用（只新增一个 markdown 文件）。
- **现场还原**：停在卡分支；`/tmp` 下的探针脚本可留；不要留游离的 node/PTY 进程。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit，
  未提交的工作按未完成处理。本卡按 ①四个证据源的实测记录 ②findings 与 verdict 两次提交。
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
  - 被审范围共 7 个提交，`src/session-protocol.ts` +75/-5、`src/session.ts` +106/-17，
    其余为测试（合计 635 insertions / 43 deletions）。
  - 本次**没有**修改 `src/serve.ts`、`src/client-entry.ts`、`src/controls/**`。
  - 相关既有实现位置（供你定位，不是结论）：`src/serve.ts` 的 WebSocket 处理在
    `:349-412`，其中 `SessionClient.send` 的实现与 catch 在 `:352-374`，
    `addClient` 的调用与错误处理在 `:379-387`，`onMessage` 的 parse 与协议违规关闭在 `:388-412`。
  - 本仓风险等级已在 `AGENTS.md` / `CLAUDE.md` 声明为 `risk-tier: personal`。
- **下一步唯一动作**：先读 review-discipline skill，再从证据源 C（node-pty 实测）开始——
  它是唯一可能推翻核心不变式的那一条。
