# ASR 增量 5 独立 review 第 1 轮 verdict

## Verdict

**FAIL：新增 P1 为 1 条；另有 1 条 P2 进入 backlog。**

审查对象固定为 `69fb85a41ac30fd8828bbb53e6d003ea8fdf1309..ac9b30d6b91c97d8ae89f986f2ac32306c39b9e4`，没有把 H0 之后的提交纳入结论。该 diff 共 194 行新增、21 行删除，涉及任务卡允许的 7 个文件；未修改 `src/asr/` 引擎本体。

P1 命中 personal 仓红线：真实的异步发送 hook 等待期间，用户可编辑 composer，随后成功发送路径会无提示清空这份新草稿。它违反本增量“连续回合”和“不得静默丢掉用户草稿”的不变式，因此不能以 P2 接受不修。

## Findings

| 编号 / 级别 | 溯源 spec | 证据与触发路径 | 结论 / 要求 |
|---|---|---|---|
| F1 / **P1** | `docs/sessions/cards/asr-composer-inc5.md:26-30` 锁定决策 1；本轮必查“保护覆盖的是发送行为……不得静默丢掉用户草稿”；用户可感知目标 `:7-10` | `src/controls/mic-controller.ts:362-364` 只捕获 `sessionGeneration`、`wasOpen` 和发送开始时的 `rawText`；`src/controls/mic-controller.ts:373-401` 在 `beforeSendData` / `sendData(text)` / `afterSendData` 间允许异步暂停；`src/controls/mic-controller.ts:402-410` 的 `canSendComposerText()` 只检查 disposed、generation、初始 `wasOpen` 和 idle/preview，不检查 textarea 是否已被用户改写，随后 `finishSend()` 调 `src/controls/mic-controller.ts:162-168` 的 `preview.resetDraft()`。真实路径：打开 composer → 输入 `first draft` → Send → 异步 `afterSendData` 未完成时输入 `new draft` → hook 完成 → 旧命令已经送入终端，新草稿被无提示清空。公共 hook 契约允许异步 `afterSendData`（`src/hooks/registry.ts:48-54`），现有测试也使用异步 hook（`tests/mic-controller.test.ts:677-684`）。只读运行时探针实测输出：`{"sent":["first draft"],"remainingDraft":"","state":"idle","isOpen":true}`。 | **必须修复。** 发送完成守卫还需区分“本次发送的草稿”和发送期间用户新写入的草稿；若草稿已变更，不能由本次 `finishSend()` 清空。补一个异步 hook 期间改稿的回归测试，断言旧发送只发生一次且新草稿仍保留。 |
| F2 / **P2，backlog** | `docs/sessions/cards/asr-composer-inc5.md:26-30` 锁定决策 6；完成条件 `:56-62` 要求长文本与 composer 高度不遮挡终端 | `src/controls/asr-preview.ts:108-115` 的 `setOpen()` 在 composer 已打开时直接返回，不发 `onOpenChange`；`src/controls/asr-preview.ts:145-148` 的 `showMessage()` 只改状态文案并调用这个同开状态的 `setOpen(true)`；新重录路径 `src/controls/mic-controller.ts:342-346` 是 `preview → idle → startSession`，而 `startSession()` 在 `:301-304` 随即调用 `preview.showMessage()`。`src/index.ts:302-312` 只把高度调度接到 `onOpenChange` 与 `onHeightChange`，后者在 `src/controls/asr-preview.ts:95-103` 仅由 textarea 高度变化触发。真实路径：已有长草稿且 composer 已打开 → 点 Mic 重录（或在同开态出现断线/错误文案）→ message 增高，但没有高度调度；`src/viewport/height.ts:42-64` 继续使用旧的 `composer.element.offsetHeight` 计算终端高度，底部内容可能被新文案覆盖。 | **进入 backlog，非本轮 P1 阻塞。** 让状态文案变化沿用现有高度通知，或在同开态更新文案后显式调度；不要另造第三套 resize 状态。 |

## 本轮必查不变式

| 检查项 | 结论 | 代码证据 |
|---|---|---|
| 发送成功后保持打开、清空草稿、状态 idle、toolbar hidden | **通过主路径；被 F1 的异步改稿边界破坏数据语义** | `finishSend()` 在 `src/controls/mic-controller.ts:162-169` 不调用 `preview.clear()` / `endAsIdle()`，只 reset 草稿、preview→idle 并保持 expanded；`wt-composer-open` 与 toolbar CSS 由 composer 仍打开维持。 |
| × / 用户取消关层并恢复 toolbar | 通过 | `src/controls/mic-controller.ts:414-434` 的 `cancelPreview()` 仍走 `preview.clear()` 与 `endAsIdle()`；成功发送后的 idle 状态点 × 也走 idle 清理分支。 |
| `startSession` 不清理已有草稿，首个 partial 再覆盖 | 通过 | `src/controls/mic-controller.ts:295-305` 删除了 `preview.clear()`；partial 仍由 `src/controls/mic-controller.ts:247-251` → `preview.setPartial()` → `src/controls/asr-preview.ts:135-143` 覆盖。 |
| preview 点 Mic 重录，不关层、不先清草稿 | 通过 | 新分支 `src/controls/mic-controller.ts:342-346` 先转 idle 再 `startSession()`；没有 `clear()`，测试 `tests/mic-controller.test.ts:603-615` 锁定 composer 与原文仍在。 |
| 打开不 focus；Enter 换行；Send 才发送 | 通过 | `src/controls/asr-preview.ts:61-67` 使用 textarea，`openComposer()` 无 focus；`tests/asr-preview.test.ts:13-40`、`tests/mic-controller.test.ts:300-310`、`tests/playwright/asr.spec.ts:163-185` 覆盖。 |
| 空发送、断线、sanitize 空文本不静默丢草稿 | 通过现有生产分支；测试覆盖仍偏弱 | `src/controls/mic-controller.ts:365-371` 空发送/初始断线直接保留，`:384-391` sanitize 空文本/再次断线只展示 message；不会调用 `finishSend()`。但现有 `tests/mic-controller.test.ts:712-721` 的空例子本身没有非空草稿，修复 F1 时应补真正的“原草稿被 sanitize 为空仍保留”断言。 |
| generation / wasOpen 是否足够 | **不通过** | 它们能防止 controller 关闭、重录、dispose 后的旧异步结果，但不能发现用户仅编辑 textarea 的事实；F1 的探针正是 generation 未变而新草稿被清空。 |
| 保护的是关层还是发送行为 | **不通过** | `canSendComposerText()` 保护的是生命周期资格（generation、初始 open、状态），不是发送草稿版本；`sendData(text)` 已在 `:393` 发生后才由 `finishSend()` 清空 UI。 |

## 降层三问

1. **终态写入成功之前发生了哪些不可逆动作？失败回切后草稿是否还在？**

   文本 `sendData(options.term, text)` 在 `src/controls/mic-controller.ts:393` 先发生；`autoEnter` 开启时独立的 `sendData(options.term, '\\r')` 在 `:408` 发生；只有二者之后才调用 `finishSend()`。初始断线、hook blocked、sanitize 为空、after hook 后发现断线等分支都不会调用 `finishSend()`，因而草稿仍在；autoEnter 的回车发送前断线时，文本可能已不可逆写入但草稿会保留。若 `term.input()` 自身抛错，当前异步任务会在 `finishSend()` 前失败，草稿也不会被清理，但没有把异常转为 composer 文案；这不是本 diff 新增的主要 P1。F1 的更危险路径不是连接失败，而是文本已发送后用户写入的新草稿被正常成功收尾流程清掉。

2. **generation / wasOpen 在单页单实例下是否足够唯一？**

   对单实例的关闭、取消、重录、dispose 生命周期，它们足够阻止旧会话继续收尾：这些路径会递增 generation，`wasOpen` 也能阻止发送从未打开的 composer 继续执行。但它们不是草稿版本号；同一实例、同一 generation、同一打开层内，用户编辑不会改变任一守卫值。因此对本轮要求的“保护发送行为”不够，不能把单实例假设当作 F1 的解答。

3. **保护覆盖的是“关层”还是“发送行为”？**

   当前新增 `finishSend()` 正确保护了关层语义：成功发送不走 `clear()` / `endAsIdle()`，composer 保持打开；× 仍走旧取消路径。但 `canSendComposerText()` 没有保护发送草稿本身，`rawText` 是一次性快照，`finishSend()` 对当前输入无条件 reset。因此本 diff 只完成了“发送后不关层”，没有完整完成“发送行为不误伤用户在途草稿”。

## 反熵检查

- `resetDraft()` 有多个真实消费者：`openComposer()`（打开时清理旧的已取消草稿）、`clear()`（取消时清理并关层）、`finishSend()`（成功发送后只清理草稿）；它与 `clear()` 的拆分直接对应锁定决策 5。preview 重录路径刻意不调用它，才能保留草稿到首个 partial；没有再新增第三种 clear。
- `finishSend()` 当前只有一个生产调用点，但这是锁定高风险区域要求的独立成功发送路径，用来避免用 keep-open 布尔参数打穿取消关闭语义；单消费者理由成立。
- `onHeightChange` 当前只有 index 一个消费方，但锁定决策 6 明确要求在同 open 态补足现有 `onOpenChange` 的通知缺口；`inputHeight` 只用于去重高度通知。二者不是无理由通用化。
- 未新增配置项、状态源、fallback、重试或防御式 catch；`src/asr/` 未被触及。

## 测试与外部证据

- 目标工作树只读定点运行：`pnpm exec vitest run tests/asr-preview.test.ts tests/mic-controller.test.ts --reporter=dot`，结果 `2 passed / 39 passed`。
- Playwright 提供的 `voice-composer-idle.png` 与 `voice-composer-long-text.png` 已查看：composer 可见、终端正文可见，长文本换行且未横向滚动；它们不能覆盖异步 hook 改稿竞态。
- OCR 前置扫描：`status=reviewed`，profile `minimax` / `MiniMax-M3`，6 条候选经验证 `confirmed=0`、`refuted=6`。其中验证器部分证据误指向 H0 代码，未将其候选升级为本 verdict finding。
- 本轮没有改坏生产代码，红验固定条款不适用；没有运行全量测试，定点测试已覆盖本轮主要组件。

## Backlog

1. **F2 / P2：**同一打开态的状态文案变化要触发现有高度调度，尤其是长草稿重录、断线和 sanitize 错误文案路径。
2. **F1 修复配套测试：**用异步 `afterSendData` 挂起，用户在等待期间输入第二份草稿；断言第一份只发送一次，第二份仍保留，且之后可再次 Send。
3. **P2 测试覆盖：**补非空草稿经 hook/sanitize 变为空、以及断线发生在文本已发送但 autoEnter 尚未发送时的草稿保留断言。
4. 不重复提报增量 3 已登记且本 diff 未改动的 idle/preview engine stop 与挂载顺序问题。

<!-- delegate-outcome: succeeded -->
