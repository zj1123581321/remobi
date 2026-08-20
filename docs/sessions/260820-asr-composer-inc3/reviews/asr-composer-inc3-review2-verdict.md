<!-- delegate-outcome: succeeded -->

# ASR 增量 3 独立 review 第 2 轮 verdict

## Verdict

**PASS：F1–F4 均闭合；本轮新增 P1 为 0。**

审查对象固定为 `30833518cf99dae40189cb471387f3518548c58c..5c270e2c7374a60445e8f260dd01d228e0e2a37a`，仓级风险为 `personal`。本轮只审 H0→H1 增量；第 1 轮已通过的入口、focus、typed-Send、CSS 与注入不变式未重复展开。

本轮新证据：

- 冻结 SHA 的 H0→H1 diff、H1 代码上下文与新增回归测试。
- 第 1 轮 verdict 的 F1–F4 表，以及修复卡锁定决策 1–5；修复卡从主仓现场只读取得，未改主仓文件。
- H1 中 `docs/designs/asr-voice-input.md` 的 R2；主脑提供的 `tests/mic-controller.test.ts` 31 条与 `tests/config.test.ts` 40 条定点测试绿证。
- OCR 前置扫描：`status=reviewed`、`profile=minimax`、完整覆盖；两条维护性意见均被复核器判定为 `refuted`，未形成 finding。

## 增量审四问

1. **本轮是否只修登记在案的 F1–F4？是。**

   生产 diff 逐项对应：`mic-controller.ts` 修 F1/F2，`config.ts` 修 F3，`index.ts` 修 F4；测试只补锁定验收轴。新增的 review1 verdict 文件是上一轮审查产物归档，不是未批准的生产改动。

2. **是否新增未经批准的抽象？否。**

   未新增 helper、接口、状态机、配置项、包装层或依赖。F1 复用既有 `showError`，F2 复用既有 `endAsIdle`，可见性提示复用既有 `preview.showMessage` 与 `setComposerExpanded`。

3. **状态/事实源/fallback 是否无依据增加？否。**

   没有新增状态或事实源，也没有 fallback、重试或防御式吞错。`audio-interrupted` 仍由既有 `AsrErrorCode`/engine error 事件驱动；idle 关闭只清理 composer，不触碰 engine。

4. **是否留下双路径？是，但仅为非阻断的重复条件路径。**

   H1 `src/controls/mic-controller.ts:245-251` 中，`audio-interrupted` 分支和默认分支都调用 `showError(code, sessionGeneration)`，前者随后 `return`。这是字面上的重复分支/维护性熵增，但不是双事实源，也没有不同运行语义；不构成数据丢失、静默失败、崩溃或新的 P1。它可在后续维护中合并为单一调用，本轮不扩展 F1–F4 修复范围。

## F1–F4 闭合证据

| Finding | 结论 | 证据 |
|---|---|---|
| F1 / P1 | **闭合** | `showError` 在 `src/controls/mic-controller.ts:162-176` 先读取 partial 文本，再进入 `error`、显示 `Audio input was interrupted.`、停止并清理会话；有文本时转 `preview`，无文本时保留 `error`。H1 测试 `tests/mic-controller.test.ts:491-517` 断言有 partial 可编辑且文案含 `interrupted`，无 partial 为可重试的 error 且 composer 保持打开。`visibilitychange(hidden)` 在 `:425-430` 取消活动会话后重新显示后台原因并保持 composer 展开；测试 `:531-549` 锁定该行为。 |
| F2 / P2 | **闭合** | `cancelPreview` 的 idle 分支 `src/controls/mic-controller.ts:415-418` 只 `preview.clear()`、`endAsIdle()`，不调用 `stopEngine()`。测试 `tests/mic-controller.test.ts:275-289` 断言打开后关闭及 backdrop 路径的 `engine.stops === 0`。 |
| F3 / P2 | **闭合** | `src/config.ts:90` 的 `voiceComposerButton` 已改为模块私有；H1 的生产引用只有同文件注入点 `:117-118`，没有扩大 `src/config.ts` 导出面。 |
| F4 / P3 | **闭合** | `attachVoiceComposerMic` 在 `src/index.ts:112-117` 先查询并校验 composer Mic，成功后才 `appendChild`，缺失按钮仍 fail-loud，不留下部分挂载。 |

## 新 P1 扫描

**0 条。**

逐项检查了本增量的事件路径、partial/error 分流、visibility hidden、idle 关闭、配置注入与 composer 挂载边界：没有发现新增的数据丢失、静默出错或崩溃路径。重复 `showError` 条件仅是非阻断维护性观察，不升级为 P1。

## 验收记录

- H0→H1 `git diff --check`：通过。
- 增量统计：5 个文件，`105 insertions(+), 13 deletions(-)`，在 200 行 target 内。
- 定点测试绿证：`tests/mic-controller.test.ts` 31 绿，`tests/config.test.ts` 40 绿（由主脑提供）。
- 本卡审查者没有修改生产代码；工作树唯一新增产物为本 verdict 文件。

## 固定条款

**红验安全**（固定条款，原样保留）：本卡禁止改生产代码，故不适用。

**反熵条款**（固定条款，原样保留）：禁止顺手新增抽象。
