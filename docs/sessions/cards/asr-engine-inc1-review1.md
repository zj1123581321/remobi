# 任务卡：ASR 增量 1 独立 review 第 1 轮（full-scope）

## 目标

对增量 1（ASR 引擎核心）diff 做独立全量审查，产出 verdict 文件。你是审查者，不是实现者；
只读代码与测试，唯一允许的写入是 verdict 产出文件。

**先读** `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`
（绝对路径，跨仓有效）——轮次规则、P1 分诊、熵增审查、输入隔离全部以它为准。

## 非目标

- 不修改被审代码（发现问题的修复由主脑另派修复卡）。
- 不审存量代码（base 之前的问题记 backlog，不占本轮）。
- 不重复主脑已分诊的 OCR findings（清单见下，同意见换措辞重提不算新增）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：800
- **阶段**：reviewing
- **锁定决策**：被审对象的 spec 即锁定项（见下「spec 输入」）；与项目文档化契约冲突的意见
  不能直接判 fail，须先举证契约本身有问题。
- **任务类型**：review
- **复杂度**：M
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配；worktree 基于 origin/main，被审分支已 push，
  `git fetch origin && git diff c23d8e7..50a2207` 即可取得完整审查对象
- **当前唯一写入者**：本卡执行器（仅 verdict 文件）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收；本卡执行器即审查者

## 审查对象（H0 冻结）

SHA 范围 `c23d8e7..50a2207`（22+13 文件，~1880 行新增）。冻结在该范围：审查进行中出现的
新提交不改变本轮对象。

主要内容：`src/asr/`（types/pcm/worklet-entry/doubao/protocol/doubao/engine）、
`src/serve.ts`（worklet 路由 + buildSecurityHeaders 第 4 参 + enabled gating）、
`build.ts`/`scripts/build-overlay.ts`（worklet 资产双入口）、config 四文件（asr 段 + redact）、
`tests/`（protocol golden、pcm、engine↔mock、build-worklet、config/serve 两态）、
`tests/fixtures/asr/mock-volc-server.ts`、AGENTS.md/SKILL.md 同步。

## spec 输入（意见须溯源到这些条目，无法溯源的默认降一级）

1. `docs/designs/asr-voice-input.md`：增量 1 节、Eng Review 锁定节（模块布局/E1/E2/E4/E7/测试矩阵）、
   v5 节（#1/#5/#6/#7/#8/#10/#12/#15/#16）。
2. `docs/sessions/cards/asr-engine-inc1.md`：完成条件、不变式轴表、spike 实测 deltas
   （endpoint `_async`、query `api_key`/`api_resource_id`、单 apiKey config、
   resourceId `volc.seedasr.sauc.duration`、尾包 `-(N+2)`、0x9=partial/final、0xF=错误帧、
   实帧未压缩、offset 8/12、PCM 16k/16bit/mono 唯一格式、不建重采样回退）。
3. `docs/sessions/260819-1306-asr-spike-results.md`：spike 验收清单与真机矩阵。
4. 仓 risk-tier：未声明，按 internal；本 diff 核心是失败路径/状态迁移（引擎状态机、背压、
   清理时序），按提档例外执行（收敛条件 saas 档：连续 2 轮无新增 P1，轮次上限 8）。

P1 红线（internal + 提档）：数据丢失、静默出错（结果错但不报错）、崩溃、越权访问、
损坏他人数据。判定两问：本项目的真实使用方式（单人自部署手机浏览器 PTT）下会触发吗？
触发了后果能否接受？

## 主脑已分诊的 OCR findings（已修复，勿重复提）

onerror 被 open-promise 覆盖（已修，resolve 后重挂）；worklet 未 downmix（已修，全声道平均）；
build-overlay 陈旧资产（已修，拆 serve 读资产/build 强制重建）；oxlint 三处 cast（已修，
WebSocketLike 事件具体化 + adapter）；NaN 静默归零（已修，RangeError）；截断帧裸 RangeError
（已修，统一 malformed）；enabled 时 apiKey 必填（已修）；worklet 未知消息静默（已修，
unknown-worklet-command）；isSupported 逻辑（已修）；errorCode 映射不全（已修）；getText
无限递归（已修，定深取值）；worklet 路由/打包挂 enabled（已修）。误报已判：destination
连接回授（Chrome pull 模型必需）、addModule 失败不清理（fail 路径已清理）、URL 带 key（C8 裁决）。

## 修改边界

- **允许**：仅新增 `docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review1-verdict.md`
- **禁止**：其它一切写入，包括被审代码、测试、配置、spike fixture。
- **Scope-Globs**：docs/sessions/260819-asr-engine-inc1/**
- **高风险区域**：无写入面。

## 完成条件

- **行为验收**：
  1. 全量审 `c23d8e7..50a2207`（不因 OCR 已跑缩小范围），覆盖：帧编解码边界与 golden 一致性
     （对照 `tests/fixtures/asr/20260819T052830488Z-query-seedasr-duration-2b7d8bd5/` 实帧）、
     引擎状态机与失败路径（建连失败/运行期断连/背压/provider 错误/重复 start/stop）、
     清理时序（tracks/context/定时器/port）、背压语义（不静默丢音频）、
     尾包序列 `-(N+2)` 与 audioFrameCount 一致性、worklet 实时线程零分配、
     CSP/config 两态、redact 覆盖所有路径形态、mock server 与生产实现不互相证明。
  2. **降层三问**（infra/状态机类必答，写进 verdict）：
     ①终态写入成功之前已发生哪些不可逆动作（WS 已发的音频帧/已触发的 error 回调/
     已关闭的采集资源，在 fail/cleanup 交错时序下是否成对）？
     ②守卫用的值（state 字段、audioFrameCount、reportedError）在实际使用形态
     （单引擎实例复用 start/stop 多轮）下自身一致吗？
     ③保护覆盖的是「写入」还是「行为」（背压检查覆盖了 queuedBytes+bufferedAmount，
     但 worklet port 在途量是否真的被覆盖，还是只覆盖了可观测的两个量）？
  3. 熵增维度：对 diff 中每个新增抽象/文件/状态/配置项问「是不是熵 +1」（单实现接口、
     转发-only 层、无第二消费者的通用化），命中即提（默认 ≤P2）。
  4. 每条 finding 注明：严重级（P1/P2/P3）、溯源 spec 条目、证据（文件:行 + 触发路径）。
     P1 必须过「真实使用会触发 + 后果不可接受」两问。
- **verdict 产出**：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review1-verdict.md`
  （只新增该文件），结构：verdict（pass/fail）、findings 表（P 级/溯源/证据）、降层三问答案、
  backlog（存量/接受不修项）。
- **相关测试**：审查可跑 `pnpm test` 与定点 vitest 验证怀疑点（只读运行，不改代码）。
- **跨发布边界不适用**：本卡无产物被下游消费，verdict 即终点。
- **提交纪律**：verdict 文件在本卡分支 commit（`docs(sessions):` 类型，归因自动注入）。
- **执行器自声明 outcome**：报告文件（report.md）正文中、首个二级标题之前，恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。
  outcome 描述「审查工作做完没有」：审出 P1 是正常产出，写 succeeded；只有审查本身没完成才写 failed。

## 当前状态

- **现场事实（主脑预取）**：被审分支已 push（origin/card/remobi-20260819-03，draft PR #7）。
  主脑验收已过：scope 干净、557 tests 绿、lint:ox 0 errors、红验抽查通过、H0..H1 增量审四问通过。
  OCR 前置 status=reviewed。以上仅供定位，不构成审查结论——你独立下判断。
- **下一步唯一动作**：`git fetch origin && git diff c23d8e7..50a2207 --stat`，从
  `src/asr/doubao/protocol.ts` 与 spike 实帧的对照开始审。
