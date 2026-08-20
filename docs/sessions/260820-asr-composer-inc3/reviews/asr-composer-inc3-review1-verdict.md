<!-- delegate-outcome: succeeded -->

# ASR 增量 3 独立 review 第 1 轮 verdict

## Verdict

**FAIL：新增 P1 1 条，必须修复后再进入下一轮。**

审查对象固定为 `5508a6721e654cae15895bca656b40b9faa959d5..30833518cf99dae40189cb471387f3518548c58c`，不纳入冻结点之后的提交。仓级风险为 `personal`；本轮按数据丢失 / 静默出错 / 崩溃判 P1。

本轮新证据是独立读取冻结 SHA 的全部 16 文件 diff、目标提交中的新增测试，以及仓内设计文档和外部任务卡的锁定轴表。`git diff --check` 通过；未把卡面给出的 Pixel 5 截图和定点测试结果当作完整 diff 审查的替代。工作树当前停在 base，未运行会误测 base 而非 H0 的测试命令。

## Findings

| 编号 / 级别 | 溯源 spec / 不变式 | 证据与触发路径 | 影响与处理 |
|---|---|---|---|
| F1 / **P1** | 设计文档 R2 错误路径要求音频会话被来电、Siri 或其他 App 中断时走 `cancelled`，并有“按钮复位 + 提示”（`docs/designs/asr-voice-input.md:162-165`）；增量 3 要复用增量 2 的取消/错误语义（`:149-155`）。 | `src/controls/mic-controller.ts:238-251` 收到 `audio-interrupted` 后直接调用 `cancelSession(sessionGeneration)`；`cancelSession` 在 `:178-200` 清空 preview、停止引擎、递增 generation 并回到 `idle`，没有任何 `showMessage`/错误提示。录音中已有 partial 时，`src/controls/mic-controller.ts:240-243` 已把文本写入输入框，随后中断路径仍由 `preview.clear()` 丢弃。真实触发路径：手机录音期间来电/Siri/其他 App 抢占音频 → engine 发 `audio-interrupted` → composer 消失、文本丢失、用户没有原因提示。 | 两个 P1 问题都通过：①真实手机使用中断音频会触发；②识别中的语音文本被不可恢复地清空且无提示，属于数据丢失/静默失败，后果不可接受。应在中断取消路径保留可见提示（并保留取消后的安全 idle/按钮复位语义），增加 `audio-interrupted` 回归断言。 |
| F2 / **P2** | 增量 3 轴表“开 / idle / 点 × 或 backdrop”要求关闭 composer 且**不调用 engine**（任务卡锁定轴 7；设计文档 `:155`）。 | `src/controls/mic-controller.ts:403-417` 把 `idle` 纳入 `cancelPreview`，但 `:415-417` 无条件 `preview.clear(); stopEngine(); endAsIdle()`。真实路径：打开 composer（状态仍 idle）→ 点 × 或 backdrop → 调用 `engine.stop()`。 | 当前 provider 在 idle stop 多半是 no-op，未证明 P1 后果，故为 P2；但它违反了明确的 idle 轴并污染 start/stop 资源账本。idle 分支应只清理/关闭，不调用 `stopEngine()`。增量 2 已有的 preview/error 重复 stop 属存量问题，本条只登记本 diff 新增的 idle 路径。 |
| F3 / **P2，反熵** | 反熵条款要求新增抽象能说明第二消费者；本卡只要求纯函数 `withVoiceComposerEntry`，没有要求导出按钮常量。 | `src/config.ts:90-95` 新增并导出 `voiceComposerButton`，生产代码唯一引用是同文件 `:117`；仓的 `./config` 是发布出口（`package.json:14-17`），因此该单消费者常量还扩张了可见 API。 | 不影响当前用户路径，属于无必要的公开 API / 单消费者抽象。将常量改为模块私有，或补充真实的第二生产消费者；不要为此新增包装层。 |
| F4 / **P3，backlog** | 反熵/失败路径要求挂载失败 fail-loud 且不留下脏 UI；OCR 已确认该边界为低级编程错误，不能提档 P1。 | `src/index.ts:109-117` 先在 `:112` 将 `controller.preview.element` append 到 `body`，再在 `:113-116` 查询内部 Mic；缺少按钮时抛错，DOM 已先发生部分变更。当前 `createAsrPreview` 固定创建该按钮，故只在内部编程不变量被破坏时触发，且外层 init catch 会继续 dispose。 | 低影响 P3；建议先 query/校验再 append，或把构造与挂载顺序收紧。不要为此添加 fallback。 |

### P1 两问复核

F1 的触发不是假想异常：设计文档明确列出手机音频会话被来电、Siri 或其他 App 中断，且目标引擎事件已被 controller 接收。后果也不是普通可接受取消：partial 已显示的语音随 `preview.clear()` 消失，composer 没有错误/取消原因，用户无法判断是否需要重说。因此 F1 必须修复，不能降为 P2。

## 必查不变式结论

| 检查项 | 结论 | 代码证据 |
|---|---|---|
| toolbar 入口不得 `startSession` | 通过 | `src/toolbar/toolbar.ts:96-99` 绑定 `attachComposerToggle`；`src/controls/mic-controller.ts:299-305` 只 `preview.open()`。 |
| 打开 composer 不得 focus input | 通过 | `src/controls/asr-preview.ts:97-102` 无 focus；新增测试断言 `tests/asr-preview.test.ts:13-29`。 |
| idle 打字 Send 走同一 hook → sanitize → connected 守卫，成功关闭 | 通过 | `src/controls/mic-controller.ts:338-400`；Send 先检查连接，hook 后再 sanitize 和检查连接，成功后 `clear/endAsIdle`。 |
| recording 只读，preview/error/idle 可编辑 | 通过 | `src/controls/mic-controller.ts:106-117`；目标测试覆盖 `tests/mic-controller.test.ts:340-347`、`:248-260`。 |
| 活动取消 / idle 关闭语义 | **F1、F2 不通过** | 活动音频中断无提示见 F1；idle ×/backdrop 调 `stopEngine` 见 F2。普通 recording/waiting-final 取消迁移本身位于 `:403-412`。 |
| toolbar Mic CSS 特异性和 44×44 圆形 | 通过 | `styles/base.css:90-108` 的 `#wt-toolbar .wt-row:last-child button.wt-mic` 覆盖 last-child flex；`tests/playwright/asr.spec.ts:78-83`。 |
| `withVoiceComposerEntry` 不重复注入；disabled 不注入 | 通过 | `src/config.ts:98-126`；`tests/config.test.ts:218-274`。 |
| 注入文本不把 C0/`\r` 送入文本路径 | 通过（autoEnter 是 spec 明确的独立 `\r`） | `src/controls/mic-controller.ts:361-397` 的 hook 后 sanitize 与两次 connected guard；`tests/mic-controller.test.ts:543-585`。 |

## 反熵检查

- `withVoiceComposerEntry` 只有一个生产调用点，但这是任务卡明确要求的纯函数接线点，并有独立配置测试，单消费者仍有必要。
- `voiceComposerButton` 没有第二个生产消费者，且被不必要地导出；已作为 F3 登记。
- `attachVoiceComposerMic` 只有一个调用点，但承担“controller 创建 → composer 挂载 → 查找内部 Mic → 接线”的生命周期顺序，且是 fail-loud 边界，单消费者理由成立；其异常顺序问题另列 F4。
- `closeComposerOverlays` 是 controller 创建早于 drawer/d-pad 的必要延迟依赖，`canSendComposerText` 在 before/after hook 两个边界复用；均未新增无理由状态或 fallback。
- `isOpen` 是任务卡接口要求；`isVisible` 是旧字段的兼容别名，不是新增状态源，二者都返回同一个 `open` 布尔值。

## Backlog

- F2（P2）：移除 idle 关闭路径的 `stopEngine`，补 `engine.stops === 0` 轴表断言。
- F3（P2）：把 `voiceComposerButton` 改为私有常量，除非明确需要第二个生产消费者。
- F4（P3）：收紧 `attachVoiceComposerMic` 的校验/挂载顺序。
- 增量 2 review 已登记的 preview/error 重复 `engine.stop()` 不在本轮重复提报；本轮只新增 idle 分支的调用。

## 工具与提交记录

OCR：卡面提供的前置扫描标记为 `status=reviewed`，其 finding 已作为背景逐条复核；本轮没有把它当作完整审查。尝试调用本机包装器时，三条腿均因 `caller_error:usage_help` 返回 `status=skipped`，因此没有把空 findings 解释为 clean。

本报告唯一允许的工作树写入是本文件；被审代码与测试未修改。提交后核验命令及其实际输出已在本卡最终摘要中贴出：

```text
git log --oneline -1
git show --stat --format= HEAD
```
