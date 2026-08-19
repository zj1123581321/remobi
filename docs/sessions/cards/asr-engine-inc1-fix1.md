# 任务卡：ASR 增量 1 引擎生命周期状态机收口卡（熔断后系统性收口）

## 目标

两轮独立 review 在同一边界（DoubaoEngine start/stop/fail 生命周期）连续出 P1，触发补丁追逐熔断。
本卡不做单点修复：先把**引擎层生命周期状态机**定义成显式迁移表（设计文档只定义了增量 2 的
mic-controller 状态机与 epoch，引擎层是空白），再按表修齐实现与测试，使该边界收敛。

用户可感知目标：按住说话文本稳定流出；松手/断网/权限弹窗/服务错误任意交错下，
不错字、不卡死、不泄漏麦克风（麦克风指示灯必须灭）。

## 非目标

- 不动 mic-controller/PTT UI（增量 2）；不改 protocol/pcm 的合法帧语义（第 2 轮误拒穷举已证无误拒）。
- 不重写引擎整体架构——状态机收口，不是重写。
- 不引入新依赖。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：800
- **Diff-Lines-Hard**：1500
- **阶段**：repairing
- **root_cause_group**：引擎层生命周期状态模型在设计层未定义（设计文档 E3/v5#3 只覆盖增量 2
  mic-controller），实现期临时发明导致 start/stop/fail 交错语义两轮连续出 P1
- **introduced_by_commit**：e710f56（引擎初版引入；属本增量内缺陷，非 pre-existing）
- **open_findings**（登记在案，修复不得超出；另加状态机收口本身）：
  - P1-F1：pending `capture.start()`（getUserMedia/AudioContext 初始化）不被 stop/fail 取消；
    迟到授权在 stop 后仍创建 stream/context/node；stop 于 starting 态不递增 epoch；
    start/stop 交错可双开 socket/capture（证据：review2 verdict，engine.ts:313-362、153-187、533-544）
  - P1-F2：结构完整但 JSON payload 损坏的 0x9 帧被静默丢弃（parseJson 吞异常 → json:undefined →
    engine getText()===undefined 直接 return，无 protocol-error）
    （证据：protocol.ts:154-162、engine.ts:426-443）
  - P2-F3：`capture.stop()` rejection 无失败终态——engine 卡 stopping、socket 仍 OPEN、
    后续 start 静默 no-op（证据：engine.ts:345-352、503-531）
  - backlog-1：真实 BrowserPcmCapture 的 flush-ack 路径缺直接 seam 测试（现绿测全走 injected capture）
- **锁定决策**：
  - 第 1/2 轮 verdict 中已核验真闭环的修复（binaryType、epoch waiter、port 背压、真帧 mock、
    删包装）不得回退或重写形态。
  - 设计文档 v5 #3 epoch 语义是权威：所有异步回调捕获代际号，失配即丢弃并 stop tracks；
    getUserMedia 无取消信号，靠代际作废。
  - 「合法 JSON 但无 text 的 0x9 帧静默忽略」是设计行为（空结果不注入），**不是**错误；
    只有 JSON 损坏/结构非法才 fail-loud。两者必须可区分。
- **任务类型**：backend-logic
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main；
  被修分支 card/remobi-20260819-03 HEAD d74239f 已 push，在其上继续，不得重建分支历史）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支；
  基于 origin/card/remobi-20260819-03 检出继续工作
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑只读验收）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 引擎生命周期领域不变式（本卡定义即 spec，逐条写「代码在哪、哪个测试锁死」）

- **I1 单代际占有**：同一时刻至多一个 WS 连接 + 一个采集会话属于当前代际；旧代际的资源
  与异步事件不得读写新代际状态。
- **I2 停后禁建**：stop/fail 之后不再创建任何新资源——pending 中的 getUserMedia/AudioContext/
  addModule/WS 握手完成时必须按代际作废并立即清理刚得到的资源（track.stop/context.close）。
- **I3 成对清理**：每个被创建的资源（tracks/AudioContext/worklet node/socket/timer/port）
  恰好清理一次；任何交错路径下不漏、不重。
- **I4 异常必响**：畸形帧、JSON 损坏、provider 错误帧、WS 错误、采集失败、stop 失败——
  每一条都必须产生恰好一次 onError（或按设计的显式忽略路径），禁止静默。
  例外（设计显式忽略）：合法 JSON 但无 text 的 0x9 帧。
- **I5 stop 契约**：stop() 幂等、可重入、有限时间内必然 settle（resolve 或 fail-loud 转移），
  任何交错下不永久悬挂；stop 完成后实例可直接 start 新轮且语义干净。
- **I6 背压三要素**：queuedBytes + worklet port 在途 + ws.bufferedAmount 超 2s 水位必报
  network-too-slow（已闭环，回归测试锁死即可）。

## 状态机轴表（必须全格有检测点；事件列 = 外部/异步输入）

状态：`idle` / `starting`（含 WS 握手与 capture.start 两个子阶段）/ `recording` / `stopping` / `failing`

| 当前状态 | 事件 | 期望迁移与动作 | 检测点（测试名） |
|---|---|---|---|
| idle | start() | epoch++ → starting；等待旧代际 cleanup 完成后开 WS+capture | 每格必填 |
| starting(WS 握手) | WS onerror/onclose | →failing：onError(connection-failed) 恰好一次 → idle；capture 未启动 | |
| starting(capture pending) | stop() | 标记取消（epoch 语义）；capture 返回后按 I2 作废资源；stop 有限时间 settle → idle | |
| starting(capture pending) | getUserMedia 迟到 resolve | 代际失配 → track.stop + 不建 context/node（I2） | |
| starting(capture pending) | WS/provider fail | →failing；pending capture 按 I2 作废；onError 恰好一次 | |
| recording | stop() | →stopping：停 monitor → capture.stop → 排空 → 尾包 → final/3s → cleanup → idle | |
| recording | WS error/close、provider 0xF、畸形帧、JSON 损坏 | →failing：onError 恰好一次、采集停、资源成对清理 → idle | |
| stopping | provider 0xF / WS close / 畸形帧 | onError 恰好一次（不重复）；当前 stop 继续走完成对清理；不覆盖 waiter | |
| stopping | capture.stop() rejection | fail-loud：onError + 转 idle（不卡 stopping）；资源尽力清理并记录 | |
| stopping | 再次 stop() | 返回同一 promise（幂等） | |
| stopping/failing | start() | 拒绝或排队到 idle 后（语义二选一写死），禁止双开 socket/capture（I1） | |
| 任意 | start() 在 getUserMedia pending 中被调两次 | 第二次按锁定语义处理（忽略/拒绝），不双开 | |
| 任意 | JSON 损坏的 0x9 帧 | onError(protocol-error) 恰好一次 → failing（I4） | |
| 任意 | 合法 JSON 无 text 的 0x9 帧 | 静默忽略（设计行为），不 onError、不影响状态 | |

## 修改边界

- **允许**：`src/asr/**`、`tests/asr-*.test.ts`、`tests/fixtures/asr/mock-volc-server.ts`
- **禁止**：`src/asr` 与上述测试外的一切；spike 真帧目录只读；禁止回退已闭环修复
  （binaryType/epoch waiter/port 背压/真帧 mock/删包装）。
- **Scope-Globs**：src/asr/** tests/asr-engine.test.ts tests/asr-protocol.test.ts tests/asr-pcm.test.ts tests/fixtures/asr/mock-volc-server.ts
- **高风险区域**：不得破坏已闭环修复的回归测试；状态机改动是全引擎行为面，pnpm test 全绿是底线。

## 完成条件

- **行为验收**：上表全格有测试且全绿；I1-I6 每条在报告里写「代码在哪（文件:行）、哪个测试锁死」；
  P1-F1/P1-F2/P2-F3/backlog-1 四条登记 finding 闭环（真实 BrowserPcmCapture flush-ack 补 port fake seam 测试）。
- **相关测试**：`pnpm test` 全量；新增交错时序测试必须红验（先红后绿，报告写明红验证据）。
- **跨发布边界不适用**（引擎内部状态机；协议跨边界已被真帧 mock 测试覆盖）。
- **lint / typecheck / build**：`pnpm run check && pnpm run lint:ox && pnpm run build:dist` 全绿。
- **状态机文档**：迁移表以注释或 `src/asr/` 内文档常量形式落代码旁（不进 docs/，避免两处漂移）；
  每个 transition 函数显式化（禁散写 state 赋值，对齐设计 E3 原则）。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，
  改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
- **提交纪律**：小步 commit（建议 状态机表/迁移函数 → I2 pending 作废 → I4 异常必响 → I5 stop 契约 →
  seam 测试 分 4-5 个），`fix(asr):` 类型，归因自动注入。
- **执行器自声明 outcome**：报告文件（report.md）正文中、首个二级标题之前，恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 两个 verdict 与证据：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review1-verdict.md`
    与 `asr-engine-inc1-review2-verdict.md`（在各自 review 分支，主脑会并入 main；worktree 内
    可经 `git show 6d87c6f:...` / review2 分支读取，或主仓 docs/sessions/ 若已并入）。
  - review2 的修复闭环核验表（5 条真闭环）、误拒穷举表（protocol/pcm/config/epoch 无误拒）、
    epoch 迁移表与三个不一致窗口——直接是本卡的输入，照单收口，不必重新发现。
  - 被修分支 origin/card/remobi-20260819-03 HEAD d74239f：559 tests 绿、lint:ox 0 errors。
- **已完成**：实现 + 两轮修复 + 两轮独立 review（round1: 2 P1+3 P2 已闭环；round2: 修复全真闭环，
  新增 P1-F1/P1-F2/P2-F3 未修）。
- **未完成**：本卡全格状态机 + 四条登记 finding。
- **关键决策**：熔断后不再派单点修复卡；先定义状态机再修——本卡即收口卡。
- **已否决方案**：继续第三轮 resume 单点修复（熔断禁止）；推倒重写引擎（无依据，已闭环部分良好）。
- **下一步唯一动作**：读 review2 verdict 的迁移表三个不一致窗口，把引擎现有 state 赋值点全部
  列出来（grep `this.state` src/asr/doubao/engine.ts），写迁移函数骨架。
