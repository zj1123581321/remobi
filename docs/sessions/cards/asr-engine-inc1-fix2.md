# 任务卡：ASR 增量 1 P2 收口 + 文档漂移清理（review4 登记项）

## 目标

处理 review 第 4 轮（pass，0 新 P1）登记的 2 条 P2 修复 + 1 条 P2 处置 + 跨文档漂移更新，
为收敛第 2 轮 review 提供新证据。

## 非目标

- 不加 `./asr` 公共入口（P2-3 已裁决：无第二消费者，增量 2 前 src/asr 为包内源码）。
- 不动引擎/协议/worklet 运行时代码（P2-1 只动 serve 响应头）。
- 不改 CHANGELOG。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：250
- **Diff-Lines-Hard**：500
- **阶段**：implementing
- **锁定决策**：
  - P2-3（dist 无 asr 公共入口）处置 = 接受不修：增量 2 前 `src/asr` 是包内源码，
    无外部消费者；文档注明即可，禁止加 export。
  - worklet 资产缓存策略定案 = `cache-control: no-cache`（实现已是），文档对齐到实现，
    不接 `?v={version}` 接线（无实际旧包复用证据，不建机制）。
  - 文档漂移的处置方向：更新滞后文档对齐实现与 spike 实测，**不改代码回旧协议**。
- **任务类型**：tests-docs
- **复杂度**：S
- **Base commit**：c23d8e731e6a692f6184d40a46ae2c2770a663de（origin/main；
  被修分支 card/remobi-20260819-03 HEAD 397e3d6 已 push，在其上继续）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支；
  基于 origin/card/remobi-20260819-03 检出继续
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑只读验收）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收

## 修改边界

- **允许**：`src/serve.ts`（仅 HTML 路由响应头）、`tests/serve.test.ts`、
  `docs/designs/asr-voice-input.md`、`docs/sessions/260819-1244-asr-spike-inc0.md`
- **禁止**：其它一切（含 src/asr/、config 四文件、build.ts、worklet 相关）。
- **Scope-Globs**：src/serve.ts tests/serve.test.ts docs/designs/asr-voice-input.md docs/sessions/260819-1244-asr-spike-inc0.md
- **高风险区域**：serve.ts 是共享文件——既有 serve 测试全绿是回归铁律。

## 完成条件

- **行为验收**：
  1. **P2-1（HTML 缓存）**：HTML 路由响应加 `Cache-Control: private, no-store`
     （config 内联进 HTML，启用 ASR 后含 apiKey，不得进 HTTP cache 持久化）；
     补响应头回归测试（断言该 header 精确值）。
  2. **P2-2（CSP 字节级锁定）**：`tests/serve.test.ts` 的 enabled/disabled 两态 CSP 改
     字节级 `toBe` 精确断言 + 通配排除（断言不出现 `*`、`wss:` 裸 scheme）；补 worklet 路由
     enabled/disabled 两态 HTTP 语义断言（enabled 200 text/javascript / disabled 404）。
  3. **文档漂移清理**（只改文档，对齐实现与 spike 实测）：
     - `docs/designs/asr-voice-input.md`「关键约束」节：旧 `/api/v3/sauc/bigmodel` + header 鉴权
       更新为 `_async` + query `api_key`/`api_resource_id` 实测结论（注明出处 spike 结果文档）；
       E7 config 节的 `appKey/accessKey`/`volc.bigasr.sauc.duration` 更新为单 `apiKey`/
       `volc.seedasr.sauc.duration`；E1 的 `?v={version}` 改为 no-cache 策略表述；
       错误路径节注明 UI 提示/结构化事件属增量 2 责任边界。
     - `docs/sessions/260819-1244-asr-spike-inc0.md` 文首加 superseded 标记，指向
       `260819-1306-asr-spike-results.md`。
     - 设计文档模块布局节注明：`src/asr` 在增量 2 接线前为包内源码，无 npm 公共入口（P2-3 处置）。
- **相关测试**：`pnpm test` 全量；`pnpm run check && pnpm run lint:ox && pnpm run build:dist`。
- **跨发布边界不适用**。
- **红验**：P2-1/P2-2 新断言先红后绿（报告写明红验命令与结果）。
- **提交纪律**：小步 commit（P2-1、P2-2、文档各一），`fix(asr):` 用于 serve 头（消费者可见
  运行时行为），`test:` 用于测试硬化，`docs:` 用于文档漂移。
- **执行器自声明 outcome**：报告文件（report.md）正文中、首个二级标题之前，恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：review4 verdict（main：`docs/sessions/260819-asr-engine-inc1/reviews/asr-engine-inc1-review4-verdict.md`）
  含 P2-1/P2-2 证据（serve.ts:418-425 无 Cache-Control；serve.test.ts:100-110 仅 toContain）
  与漂移表（设计 :22-25、:190-192、:238-240、:146-154；交接卡 :22,30）。
  被修分支 573 tests 绿、lint:ox 0 err。
- **下一步唯一动作**：读 verdict 第 1/2 节，给 HTML 路由加 `Cache-Control: private, no-store` 并先写红测试。
