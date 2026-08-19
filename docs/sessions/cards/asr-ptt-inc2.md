# 任务卡：ASR 增量 2 — PTT UI 与注入（mic-controller + preview + sanitize + voice-input action）

## 目标

按设计文档实现 PTT 交互层：toolbar 按住说话按钮 → mic-controller 状态机 → AsrEngine（增量 1 已交付）
→ 预览气泡（partial 流式、确认/编辑/发送）→ sanitize → sendData 注入终端。本卡落地后，
用户在手机浏览器按住按钮说话、松手出字、确认进终端，全链路可用。

## 非目标

- 不改引擎内核（`src/asr/` 除 backlog 三项与必要接线外不动；引擎缺陷另开修复卡）。
- 不做热词注入、Web Speech fallback、语音命令（设计已 CUT/DEFERRED）。
- 不做 Service Worker 深化；不改 release/CI 配置。
- 不引入新依赖。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：3000
- **Diff-Lines-Hard**：3500
- **阶段**：implementing
- **锁定决策**（设计文档 v5 增量 2 节 + Eng Review 锁定 + v5 补充，冲突以设计文档为准）：
  - R7/E7：`{type:'voice-input'}` action literal 进 ButtonAction 封闭 union + valibot schema；
    **渲染层特判**——toolbar 绑定 pointerdown/up/cancel 直连注入的 mic-controller，
    不走 onTap dispatch（v5 #2）；voice-input 按钮**仅允许摆 toolbar**（drawer/floating 不承载，
    schema 文档注明）。
  - PTT 状态机（设计文档 PTT 节迁移表为基线）：idle/permission-requesting/connecting/recording/
    stopping/waiting-final/preview/error/cancelled；松手发生于 recording 之前一律 cancel 回 idle，
    <300ms 误触不发起连接；任意状态 visibilitychange hidden / audio interruption → cancelled；
    waiting-final 中 WS 断连按 error 迁移、已识别文本留 preview 可手动发送。
  - E3：单一 `state` 字段 + 显式 transition 函数（禁散写赋值）；connect 5s 超时、
    waiting-final 3s 超时；**final 去重**：会话内单调 appliedSeq，序号 ≤ appliedSeq 丢弃，
    否则覆盖 preview 文本（不追加）——引擎 onFinal 已传 sequence（增量 1 F1）。
  - v5 #3：mic-controller 维护 generation 计数，getUserMedia/WS/timeout 等所有异步回调
    捕获 gen，失配即丢弃（引擎层 epoch 已覆盖引擎内部，controller 自己的 generation 不可省）。
  - v5 #1：注入前检查终端 WS 连接状态（client-entry 向 overlay 暴露 isConnected/
    onConnectionChange——本卡需新增该暴露）；非 OPEN → 文本留 preview + 提示，
    **不走 send() 内存队列**（队列会在重连后偷发）。
  - v5 #12：注入顺序 = beforeSendData hooks → **sanitize（最后一道）** → sendData；
    autoEnter 回车是独立按键，在 sanitize 之后追加，不参与文本 sanitize（F-2）。
  - R1 sanitize 正向定义：仅保留可打印字符与空格（剥离 C0 含 `\r`、DEL、C1；
    除非引用火山文档证明输出字符集），字节级单测。
  - E6：preview 用普通 `<input>`——键盘抑制只作用于终端 textarea，无白名单机制，
    不要发明 keyboard sovereignty 白名单。
  - C9：hook 是 fail-open（可观测非闸门），不做安全假设。
  - 能力检测降级：无 getUserMedia / 非 secure context → 按钮隐藏（不显示不可用按钮）。
  - 中断信号：引擎已提供 `audio-interrupted`（track.onended/mute 超时/statechange interrupted）；
    controller 消费之 + 自监听 `visibilitychange`（设计 E5 分工）。
  - 引擎接口微调仅允许 backlog 三项（见下），其余引擎改动禁止。
- **任务类型**：frontend-ui
- **复杂度**：L
- **Base commit**：11e2a7dccabb5c84662289d8e8009e4753645faf（origin/main，PR #7 合并后）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑只读验收）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **子代理 fan-out**：允许派 explorer 子代理并行只读扫描（fork_turns=none）；并行写仍受一支笔约束
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收；review 按仓 risk-tier（未声明，按 internal，
  UI/交互 diff 不提档，收敛 = 连续 1 轮无新增 P1 按 personal 红线核对后定）

## 修改边界

- **允许**：
  - `src/controls/mic-controller.ts`、`src/controls/asr-preview.ts`（新）
  - `src/controls/` 下既有文件的必要接线（如 keyboard-controller 的 focus 安全复用）
  - `src/toolbar/`（voice-input 渲染层特判）、`src/actions/registry.ts`、`src/types.ts`
    （ButtonAction union）、`src/config-schema.ts`（action schema）、`src/config-resolve.ts`
  - `src/client-entry.ts`（暴露终端 WS isConnected/onConnectionChange + mic-controller 接线）
  - `src/asr/types.ts`（仅 backlog：契约 JSDoc 补足、`stopped` 未用错误码处置——保留并注释
    或移除，报告说明选择）
  - `tests/asr-protocol.test.ts`（仅 backlog：flags=1 截断/长度边界负例逐项回归）
  - `tests/`、`tests/playwright/`（happy-dom 状态机测试、e2e）
  - `playwright.config.ts`（chromium 项目 fake-media-stream launch args，R11）
  - `README.md`（https 前置、iOS PWA 限制、密钥口径、voice-input 配置示例）
  - `AGENTS.md`、`.agents/skills/remobi-setup/SKILL.md`（action/config 变化同步）
- **禁止**：`src/asr/`（除上述 types.ts backlog 两项）、`src/asr/doubao/`、`src/serve.ts`、
  `build.ts`、`.github/`、CHANGELOG.md、package.json/lockfile、`tests/fixtures/asr/`（只读可用）。
- **Scope-Globs**：src/controls/** src/toolbar/** src/actions/registry.ts src/types.ts src/config-schema.ts src/config-resolve.ts src/client-entry.ts src/asr/types.ts tests/** playwright.config.ts README.md AGENTS.md .agents/skills/remobi-setup/SKILL.md
- **高风险区域**：
  - `src/client-entry.ts` 是终端输入链路心脏——sendData/键盘抑制既有行为零回归；
    注入必须走现有 sendData 链路，不另开通道。
  - 渲染层特判不能影响其它按钮类型的 onTap 路径（既有按钮测试全绿是回归铁律）。
  - 注入文本是终端命令面：sanitize 必须字节级锁死，`\r`/C0 注入命令执行是 P1 场景。

## 不变式轴表

轴 1：PTT 状态 × 关键事件（每格有检测点；迁移表以设计文档 PTT 节为准细化到测试）

| 状态 | 事件 | 期望 | 检测点 |
|---|---|---|---|
| idle | pointerdown | →permission-requesting（或 supported 检测失败隐藏） | 必填 |
| permission-requesting/connecting | pointerup（<300ms） | cancel→idle，不发起连接/已发起的取消 | |
| permission-requesting | granted/denied | →connecting / →error（permission-denied 提示） | |
| connecting | 5s 超时 / engine onError | →error（按钮复位+提示） | |
| recording | pointerup | →stopping→waiting-final | |
| recording | partial(text) | preview 流式更新（rAF 节流） | |
| recording | audio-interrupted / visibilitychange hidden | →cancelled→idle（按钮复位+提示） | |
| waiting-final | final(seq ≤ appliedSeq) | 丢弃 | |
| waiting-final | final(seq > appliedSeq) | 覆盖 preview 文本，appliedSeq 更新 | |
| waiting-final | 3s 超时 / WS 断连 | →preview（已有文本保留+提示）/ →error | |
| preview | 确认 / 编辑后确认 / 取消 | sanitize→注入（+autoEnter 回车）/ 回 idle | |
| preview | 终端 WS 非 OPEN | 文本留 preview + 提示，不入内存队列 | |
| 任意非 idle | pointerdown | 忽略（不排队） | |

轴 2：终端 WS 连接态 × 注入动作

| WS 状态 | 确认注入 | 期望 |
|---|---|---|
| OPEN | 是 | beforeSendData→sanitize→sendData，preview 清空 |
| 非 OPEN | 是 | 不注入、不入队、文本留 preview+提示 |

## 完成条件

- **行为验收**：
  1. `{type:'voice-input'}` 可配置进 toolbar.buttons；渲染层特判绑 pointerdown/up/cancel；
     drawer/floating 放置被 schema/文档拒绝或忽略（fail-loud 优先）。
  2. 轴 1 全格 happy-dom 测试；轴 2 两格测试。
  3. sanitize 字节级单测：可打印+空格保留；C0（含 `\r` `\n` `\t`？——`\t` 按设计归 C0 剥离，
     报告说明）/DEL/C1 剥离；autoEnter 回车 sanitize 后追加。
  4. 能力降级：无 getUserMedia/非 secure context 时按钮隐藏（happy-dom + webkit e2e）。
  5. e2e（仅 chromium 项目）：playwright.config 加 `--use-fake-device-for-media-stream` +
     `--use-fake-ui-for-media-stream`；`page.routeWebSocket` 拦截火山 origin 桥到
     mock-volc-server（增量 1 已交付），PTT 全流程：按下→fake mic→mock partial/final→
     preview→确认→终端收到注入文本。webkit-iphone 项目只跑能力降级用例（R6/R11）。
  6. README：https 前置（getUserMedia 需 secure context，Tailscale Serve/反代）、
     iOS PWA 限制与中断行为、密钥下发口径（单人自部署信任模型）、voice-input 配置示例。
  7. backlog 三项：types.ts 契约注释（错误码触发条件、sequence 语义、audio-interrupted 非主动
     stop 不触发）；`stopped` 处置；flags=1 截断/边界负例逐项回归锁。
- **相关测试**：**本地门禁 = CI 全量，一项不许漏**（inc1 教训：lint:knip 漏跑导致 CI 红）：
  `pnpm test && pnpm run test:coverage && pnpm run build:dist && pnpm run test:pw &&
  pnpm run check && pnpm run lint:ox && pnpm run lint:knip`（typos 无本地二进制则注明，
  由 CI 覆盖；新增 prose 自己过一遍明显错别字）。
- **跨发布边界验收**：注入链路的 producer 是 overlay JS、consumer 是终端 PTY——e2e 必须断言
  终端实际收到的字节（xterm buffer 内容），不只断言 sendData 被调用。
- **概率性验收**：PTT e2e 全流程用例连续跑 ≥5 次全绿（时序敏感）。
- **lint / typecheck / build**：见上门禁链。
- **截图或探活**：e2e 关键步骤截图（按下录音中/预览气泡/注入后终端）进报告。
- **现场还原**：worktree 停 card 分支、tree clean。
- **提交纪律**：小步 commit（建议 action/schema → mic-controller 状态机 → preview+sanitize →
  注入链路+e2e → README/文档 分 5+ 次），`feat(asr):` 类型，归因自动注入。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，
  改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
- **执行器自声明 outcome**：报告文件（report.md）正文中、首个二级标题之前，恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取）**：
  - 设计文档 `docs/designs/asr-voice-input.md`（main）：增量 2 节、PTT 状态机节、E3/E5/E6/E7、
    v5 #1-#5/#11/#12。
  - 增量 1 已合并（PR #7，main 11e2a7d）：`src/asr/` 引擎（AsrEngine 接口、onFinal 传 sequence、
    audio-interrupted、isSupported）、mock-volc-server、config asr 段、CSP 两态、live 实证
    （21 partial+1 final 真实转写）。
  - 锚点：sendData 链 `src/util/terminal.ts`；readyState 队列 `src/client-entry.ts:207-213`；
    键盘抑制 `src/client-entry.ts:94-105`；hook fail-open `src/hooks/registry.ts:111-113`；
    按钮 schema `src/config-schema.ts`；toolbar 渲染 `src/toolbar/`；tap `src/util/tap.ts`；
    focus 安全 `src/controls/keyboard-controller.ts`（touchend guard 可复用）。
  - 既有测试模式：happy-dom（tests/*.test.ts）、playwright（tests/playwright/，baseURL
    127.0.0.1 属 secure context）。
  - 仓 risk-tier 未声明（backlog：补声明）。
- **已完成**：增量 0 spike（GO）、增量 1 引擎核心（7 轮 review 收敛，live 实证）。
- **未完成**：本卡全部。
- **关键决策**：backlog 三项随本卡处理（types.ts 注释/stopped/flags=1 负例），不另开卡。
- **已否决方案**：blob: worklet（CSP）、MediaRecorder（opus 不支持）、preview 用键盘白名单（E6 撤销）、
  引擎内 final 去重（增量 2 职责）。
- **下一步唯一动作**：读 `src/asr/types.ts` 与设计文档 PTT 状态机节，写
  `{type:'voice-input'}` 的 ButtonAction union + schema（先红后绿）。
