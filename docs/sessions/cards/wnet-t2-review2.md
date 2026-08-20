# 任务卡：弱网 T2 独立审查（第 4 轮 · 协议鲁棒性 + 资源账本运行时探测）

## 目标

对修复后的冻结范围再做一轮**独立**审查，判定 P1-1 是否真被修掉、有没有引入新问题，并产出 verdict。

**先做一件事**：读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）。本仓 `risk-tier: personal`；本次 diff 核心是失败路径与资源账本，
按 infra/状态机例外，判据与收敛条件提一档。

## 审查对象（H0 冻结，禁止改用分支名）

```
仓库：/home/zlx/projects/oss/remobi
全量范围：ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb..24a12d3714818bc721763c9b981c196ef0758698
修复增量：d48425790d692235a16aa12e77b8e64f4f75123a..24a12d3714818bc721763c9b981c196ef0758698
PR：      https://github.com/zj1123581321/remobi/pull/13
```

审查进行中若出现新提交，**不改变本轮审查对象**。

## 本轮新证据源（本轮成立的前提）

前三轮已经做过、**不算**新证据、不要重复：

1. 通读 diff 逐条对照契约（主脑，0 P1）
2. 全量测试 + 时序 5 连跑（两次独立执行）
3. 红验：新测试拷到 `ba25ddf` 上必须红（已做，8 条全红）
4. 降层三问 / 调用方 `serve.ts` / **node-pty 写失败真实语义实测** / 多客户端并发
   （第 2 轮，抓到 P1-1）
5. 修复增量四问审（主脑，0 新增 P1）

**本轮必须换到下面两个证据源**，每条都要有实际命令与输出写进 verdict：

### 证据源 E：协议鲁棒性 fuzzing（真 WebSocket，不是单测 mock）

起真实 server，用真实 WebSocket 客户端灌畸形/边界帧，每一类都要有实际收到的帧或 close code：

- **结构畸形**：非 JSON、JSON 数组、`null`、嵌套超深、`type` 缺失/非字符串/未知值
- **字段类型错配**：`input-action` 的 `id` 为数字/对象/数组/`null`；`data` 为数字/对象；
  `ping` 的 `id` 为布尔
- **边界值**：`id` 恰好 128 字节 / 129 字节 / 空串；`data` 恰好 256 KiB / 超过；
  多字节 UTF-8 使字节数与字符数不一致的情形（emoji、组合字符）
- **协议混淆**：客户端发送**服务端消息类型**（`snapshot` / `output` / `input-accepted`），
  看服务端是否正确拒绝
- **重放与乱序**：同一 `input-action` 帧连发 N 次；`ping` 与 `input-action` 交错高频发送

每一类都要回答三问：①连接是被 fail-closed 关闭还是被静默忽略？
②有没有**伪造**出 `input-accepted` / `input-rejected`（拿不到可靠 id 就不该有 ack）？
③返回的任何 error 文案里有没有泄漏终端正文或用户输入？

### 证据源 F：资源账本运行时探测（长跑，不是读代码）

起真实 server 并持续产生输出/动作，实测以下量随时间的变化，贴出实际数值：

- **去重 Map**：连续发 N（N > 128）个不同 id 的 action，实测 Map 是否严格停在 128；
  第 129 个进来时被淘汰的是不是最旧那个；淘汰后重送最旧 id 会发生什么（应当再写一次 PTY，
  这是已知且被接受的边界，要确认它没有变成别的行为）
- **`outputSeq`**：长时间高频输出后是否严格单调、有无跳号；
  `terminalFailed` 之后 seq 是否仍在增长（如果是，说明 `pty.onData` 未解绑——
  请评估这是否构成真实资源问题，给出实测的内存/CPU 观察，而不是理论推断）
- **`pendingMirrorWrite` 链**：`terminalFailed` 之后每条 output 仍会挂一层 `.then().catch()`，
  实测长跑下堆是否增长（跑够时间并采样 `process.memoryUsage()`）
- **fd / 子进程**：多次 attach/detach、多次 session 创建与 `dispose()` 之后，
  实测 `/proc/self/fd` 数量与子进程是否回收干净

### 必须复核的那条修复

P1-1 的修复是**减法**：删掉 `pty-write-failed`，把同步 `pty.write` 异常并入
`failTerminal()` 粘性 fail-loud。请实测确认：

- 同步异常路径确实触发 fail-loud（可以像第 2 轮那样注入），且**不写去重账本**；
- 协议层收到 `reason: "pty-write-failed"` 判 `null`；
- 只有**一条** fail-loud 路径（mirror 失败与 pty 同步异常共用），不是两套；
- fail-loud 的 error 文案不含终端正文。

## 规格与不变式（判据来源）

设计文档：`docs/designs/weak-network-experience.md` §1、§3，以及新增的 `## Known Limitations`。

1. `accepted` 只在 `pty.write(data)` 同步返回成功后发出，且发出前 `{id,data}` 已写入去重 Map。
   **注意**：设计文档的 Known Limitations 已明文承认「accepted 不保证操作系统层面写入成功」——
   这是**文档化契约**。若要就此再提意见，必须先举证该契约本身有问题（指出条款 + 为什么错），
   否则按无效处理。
2. 同 id 同 data 重送不产生第二次 `pty.write`；同 id 不同 data 回 `id-conflict` 且不写 PTY。
3. snapshot 的 `outputWatermark` 与 `data` 一致；稳定循环 `return` 前无 `await`。
4. PTY/mirror 失败必须 fail-loud，且只有一条路径；error 不含终端正文。
5. 拿不到可靠 id 就不许伪造 rejected；畸形帧走协议违规关闭。
6. legacy `{type:'input'}` 行为不变。
7. `sessionId` 每 session 一个，只随 snapshot 下发。
8. 不新增类/模块/持久化/TTL/fallback/重试。

## 判定纪律

- 每条意见必须注明违反上面哪条不变式或哪条 P1 红线；溯源不到的降一级。
- P1 红线（personal + infra 例外按 internal 档）：数据丢失 / 静默出错 / 崩溃 / 越权 / 损坏他人数据。
- 只审冻结范围内的 diff。存量问题记 backlog 并标"存量"。
- **熵增维度必查**：本轮修复应当是**净减法**（删了一个 reason、把两条失败路径并成一条）。
  确认没有反向新增：有没有多出状态、包装层、配置项、双路径？
- **不要修代码**。发现问题输出有边界的修复清单，由主脑拆卡。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：40
- **Diff-Lines-Hard**：120
- **阶段**：reviewing
- **锁定决策**：审查对象是冻结 SHA 范围；不改被审代码；verdict 只新增文件。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：24a12d3714818bc721763c9b981c196ef0758698
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate --class big`，**新会话**，非 resume）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与定局。

## 修改边界

- **允许**：只允许**新增** `docs/sessions/260820-2016-wnet/reviews/wnet-t2-review2-verdict.md`。
  探针脚本放 `/tmp`，不要提交进仓库。
- **禁止**：`src/**`、`tests/**`、任何既有文件的修改。**不改一行被审代码。**
- **Scope-Globs**：docs/sessions/260820-2016-wnet/reviews/wnet-t2-review2-verdict.md
- **高风险区域**：fuzzing 与长跑探针会起真实 server / PTY / 大量 socket，
  务必收尾（关连接、`dispose()`、杀子进程、释放端口），不要留游离进程。
  长跑请设明确上限（例如 60–120 秒），不要无界跑。

## 完成条件

- **产物入库**：verdict 文件提交到 delegate 分配的分支；报告贴出 `git log --oneline -1`
  与 `git show --stat HEAD` 的实际输出。
- **verdict 文件内容**必须包含：
  1. 证据源 E 与 F 的**实际命令与输出**（每一类 fuzz 输入的实际响应/close code；
     每一项资源指标的实际数值）。没有实际输出的按未做处理。
  2. P1-1 修复的复核结论与实测证据。
  3. findings 列表：级别、违反的不变式编号、文件:行、具体触发路径、建议修法方向（不写代码）。
  4. 最终 verdict：`pass` / `fail`，P1 计数。
  5. **明确写出「本轮没有发现问题的方向」**，供主脑判断收敛。
- **相关测试**：本卡不改代码。但 E、F 的探针必须实际运行并贴输出。
- **lint / typecheck / build**：不适用。
- **现场还原**：停在卡分支；不要留游离的 node/PTY 进程与占用端口。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①证据源 E 的 fuzz 实测记录 ②证据源 F 的资源实测记录 ③findings 与 verdict 三次提交。**
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
  - 第 2 轮 verdict `fail`（P1 计数 1，仅 P1-1），文件在
    `docs/sessions/260820-2016-wnet/reviews/wnet-t2-review1-verdict.md`
    （已合并进 `feat/wnet-cards`，PR #15）。
  - 修复增量 `d484257..24a12d3`：`src/session-protocol.ts` +13/-6、`src/session.ts` +31/-16、
    三个测试文件、设计文档 +7。主脑已做增量四问审：只修 P1-1、无新增抽象、无新增状态、
    无无意双路径。
  - 修复后主脑已跑全量测试与时序 5 连跑（结果见本轮派发时的对话记录，不作为你的证据）。
  - 第 2 轮**未发现问题**的方向（本轮不必重复，除非你有新手法）：去重四态、seq/watermark
    一致性、mirror fail-loud 的粘性与拒绝 attach、协议违规关闭、多客户端同 sessionId、
    256 KiB `maxPayload` 边界。
  - `card/wnet-t2` 已合入 `origin/main`（含 T1 与 typos 修复），此前 CI 绿。
- **下一步唯一动作**：先做证据源 E 的协议 fuzzing——它是本轮最可能翻出新问题的方向。
