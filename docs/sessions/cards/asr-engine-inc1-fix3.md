# 任务卡：ASR 增量 1 修复 — server response flags=0b0001（带序列 partial）误拒

## 目标

修复主脑 live smoke（shipped engine + 真实语音 + 真实火山服务）发现的线上 bug：
真实 `bigmodel_async` 的 partial 帧带 `flags=0b0001`（POS_SEQUENCE），
`decodeServerResponse` 只收 flags 0/3，把真实 partial 全部判畸形 → protocol-error，
生产链路不可用。修复 + 真帧 golden + live smoke 端到端复验通过。

## 非目标

- 不改 client 侧 encode（真实服务已接受 flags=0 音频帧与尾包，证据见下）。
- 不做 partial sequence 转发/去重（增量 2 只需要 final 的 sequence，已闭环）。
- 不改 decodeAudio 的 flags 域（无真实证据表明需要，不臆造）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：120
- **Diff-Lines-Hard**：300
- **阶段**：repairing
- **root_cause_group**：spike 采集窗口过窄（正弦波只录到 1 个 flags=0 partial + 1 个 flags=3 final），
  decoder 严格性按不完整样本域定死，真实服务行为域（flags=1 partial）被误拒
- **introduced_by_commit**：9834ca7（协议初版严格 flags 域；本增量内缺陷）
- **open_findings**：
  - F-live-1：`decodeServerResponse` 误拒 flags=0b0001（POS_SEQUENCE）的 server response——
    真实服务 partial 形态。证据：真帧 fixture
    `tests/fixtures/asr/2026-08-19T1230Z-live-smoke/recv-002-mt9f1.hex`
    （seq=1、311B JSON、text="The."）；live smoke 日志 `[error] protocol-error`、0 partial。
- **锁定决策**：
  - 合法帧域以真实服务实帧为准：0x9 response 合法 flags = 0（无序列）/ 1（带序列）/ 3（末包带序列）。
  - 修复后必须过 live smoke 端到端（真实服务 + 真实语音 → partial/final 文本事件），
    这是本卡的终审验收，不只是单测。
- **任务类型**：backend-logic
- **复杂度**：S
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main；
  被修分支 card/remobi-20260819-03 HEAD 4d9087c 已 push，在其上继续）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支；
  基于 origin/card/remobi-20260819-03 检出继续
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑只读验收）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 修改边界

- **允许**：`src/asr/doubao/protocol.ts`、`tests/asr-protocol.test.ts`、`tests/asr-engine.test.ts`、
  `tests/fixtures/asr/2026-08-19T1230Z-live-smoke/`（新增真帧，主脑已录制在该 worktree 外的
  另一 worktree；派发时主脑会把它放进被修分支——若卡到时不在，执行器报告阻塞而非伪造）
- **禁止**：其它一切（含 engine.ts——本卡不需要改引擎；若你发现必须改，停下报告）。
- **Scope-Globs**：src/asr/doubao/protocol.ts tests/asr-protocol.test.ts tests/asr-engine.test.ts tests/fixtures/asr/2026-08-19T1230Z-live-smoke/**
- **高风险区域**：decoder 严格性是 review2 误拒穷验过的面——放宽仅限 flags=1 且必须读 sequence；
  其它 flags 仍拒绝，畸形帧测试不许改绿。

## 完成条件

- **行为验收**：
  1. `decodeServerResponse` 接受 flags=1：按 flags===3 同样的规则读 4B big-endian sequence
     （offset 4），payload length 在 offset 8；sequence 填入 DecodedServerResponse。
     flags 合法域 = {0,1,3}，其余仍 `malformed`。
  2. golden 单测：`tests/fixtures/asr/2026-08-19T1230Z-live-smoke/recv-002-mt9f1.hex` 真帧
     decode → kind=server-response、flags=1、sequence=1、payload JSON 含 `"text":"The."`；
     `recv-001-mt9f0.hex`（flags=0）仍正常 decode。
  3. 误拒回归：flags=2 的 0x9 帧仍被拒绝（补一条负例测试）。
  4. engine 集成：带 flags=1 partial 的 mock/真帧流过 engine → onPartial 触发、无 protocol-error。
  5. **live smoke 终审**（主脑执行，执行器不用跑）：修复合入后由主脑重跑真实服务 smoke，
     必须拿到 partial + final 文本事件。
- **相关测试**：`pnpm test` 全量；`pnpm run check && pnpm run lint:ox && pnpm run build:dist`。
- **红验**：新 golden 测试在修复前必须红（报告写明红验命令与输出）。
- **提交纪律**：1-2 个 `fix(asr):` commit（fixture 用 `test:`），归因自动注入。
- **执行器自声明 outcome**：报告文件（report.md）正文中、首个二级标题之前，恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 主脑 live smoke 方法（可复现）：Node tsx harness 注入 FileCapture（真实 16k PCM，
    Open Speech Repository OSR_us_000_0010_8k 重采样）+ ws adapter，shipped DoubaoEngine
    直连真实服务。第一次运行：server 正常响应 frame 1（flags=0 audio_info）并在 1.1s 时
    发出 frame 2（flags=1、seq=1、311B、text="The."）→ engine 判 protocol-error。
  - 真帧 fixture 已录制（2 帧 + transcript.jsonl），主脑负责放进被修分支后派发。
  - client 侧现已被真实服务接受：flags=0 音频帧（server 持续转写即为证）、
    尾包 `-(N+2)`（spike 实证）——不要动 encode。
- **下一步唯一动作**：读真帧 `recv-002-mt9f1.hex`，给 protocol.ts 的 flags=1 写红测试。
