# ASR 增量 2 独立 review 第 1 轮 verdict

## Verdict

**FAIL：发现 2 条 P1，不能以当前 H0 合入。**

审查对象固定为 `11e2a7d..5eeef33`（H0 `5eeef33`）；未审 base 存量，也未重复增量 1 引擎本体 findings。工作树只新增本 verdict；`git diff --check 11e2a7d..5eeef33` 通过。

## Findings

| ID | 级别 | 溯源 spec | 证据与触发路径 |
|---|---|---|---|
| F1 | **P1** | `docs/designs/asr-voice-input.md:99-113` 任意状态隐藏迁移；`docs/sessions/cards/asr-ptt-inc2.md:88-104` 轴 1；E3 单一显式迁移 | `src/controls/mic-controller.ts:182-196,370-373`。完成一轮识别后进入 `preview`（`finishPreview`），用户切后台/锁屏触发 `visibilitychange(hidden)`；`onVisibilityChange` 无条件调用 `cancelSession`，但 `cancelSession` 的来源状态只允许 `permission-requesting/connecting/recording/stopping/waiting-final`，于是 `transition()` 在 `:106-109` 抛 `Invalid mic transition preview -> cancelled`。preview 未清理、generation 未失效，违反“任意状态 → cancelled → idle”，移动端是正常路径。`error` 状态若尚未被 `showError` 收束也有同一非法迁移。 |
| F2 | **P1** | 设计 v5 #1/#12；`docs/designs/asr-voice-input.md:80,138-142,160-163`；`docs/sessions/cards/asr-ptt-inc2.md:102-111` | `src/controls/mic-controller.ts:327-359`。确认时文本在 `:347` 已经 `sendData`，随后 `await runAfterSendData`；异步 after hook/副作用期间终端 WS 关闭，` :356` 只检查 controller 状态，没有再次检查 `term.isConnected()`，`:357` 直接 `sendData('\r')`。`src/client-entry.ts:207-213` 的既有 bridge 会把非 OPEN 输入放入内存队列；重连时 flush，导致 autoEnter 回车脱离当前确认动作、执行此前已写入的命令，违反非 OPEN 不入队和回车独立但同样受行为守卫的要求。P1 两问均通过：公开 hook 合约允许异步；后果是终端命令面在断线重连时偷执行。 |
| F3 | **P2** | R1；`docs/designs/asr-voice-input.md:134-142,158-163`；`docs/sessions/cards/asr-ptt-inc2.md:80-84,119-120` | `src/controls/mic-controller.ts:59-69` 只按数值范围剥离 C0/DEL/C1，仍保留 U+200B（ZWSP）、U+202A（BIDI/Cf）、U+2028/U+2029（Zl/Zp）、U+FEFF 等非打印/格式/行分隔字符。正向定义是“仅保留可打印字符与 U+0020 空格”；当前测试 `tests/mic-controller.test.ts:156-166` 只覆盖 C0/DEL/C1，未锁定零宽、格式、BIDI、Zl/Zp 与组合字符边界。它不构成 `\r`/C0 直接执行路径，故按 internal 的注入低于 P1 红线判 P2。 |
| F4 | **P2** | `docs/designs/asr-voice-input.md:137,215-220`；`docs/sessions/cards/asr-ptt-inc2.md:101-103`（preview 可编辑后确认） | `src/controls/mic-controller.ts:198-219`。3 秒超时后状态为 `preview`，但 engine handlers/generation 仍允许 `onFinal`；迟到且 sequence 更大的 final 会在 `:217` 无条件 `preview.show(text)`，覆盖用户在 `preview` 中编辑的 input 值。触发是 pointerup → waiting-final → timeout → 用户编辑 → provider late final。`appliedSeq` 只防乱序，不防“用户编辑后”的生命周期边界；现有测试 `tests/mic-controller.test.ts:228-238` 没有编辑/迟到 final 交错。 |
| F5 | **P2（测试契约）** | `docs/sessions/cards/asr-ptt-inc2.md:122-125,134-136`；设计 E4/E7 测试矩阵 | `tests/playwright/asr.spec.ts:62-88` 的最终断言只检查 `body` 包含 `ptt-e2e-${attempt}`；这个字符串本身已经出现在注入的 `printf "ptt-e2e-${attempt}\\n"` 命令中（`:63`），即使没有 autoEnter/PTY 执行也可能因终端回显通过。没有读取 xterm buffer 或用与输入不同的命令输出标记，也没有断言真实 PTY 收到的字节；因此不满足“producer → PTY consumer”的跨边界真实性要求。|
| F6 | **P2** | `docs/designs/asr-voice-input.md:80,141`；`docs/sessions/cards/asr-ptt-inc2.md:101-111` | `src/client-entry.ts:258-265,267-295`。`onConnectionChange` 注册新 listener 时不立即回放当前 `readyState`；若 socket 在 mic controller 订阅前已 close，controller 在 recording 期间错过断线，之后进入 preview 不会获得“断开但文本保留”的提示，只能等用户再次点击 Send 才提示。`isConnected()` 的确认时守卫仍在，所以影响是状态提示/观察契约不完整，≤P2。 |
| F7 | **P2** | `docs/designs/asr-voice-input.md:80,148-156`；增量 2 错误路径“可见提示” | `src/client-entry.ts:283-295`。同一个 socket 的 error 与 close 事件分别调用 `notifyConnectionChange()`；常见握手失败/断网顺序会让 mic controller 收到两次 `false`，重复执行 preview 断线提示。它不改变发送安全性，但使一次连接故障产生重复状态通知，且没有去重的事实源。 |
| F8 | **P2** | `docs/designs/asr-voice-input.md:246-250`；`docs/sessions/cards/asr-ptt-inc2.md:115-118`（schema fail-loud） | `src/config-schema.ts:383-412`。非法 drawer 只把 path 定位到 `config.drawer`，非法 floating 只定位到 `config.floatingButtons[i]`，没有落到具体 `buttons[j].action.type`；多个按钮同时非法时用户仍无法直接定位修复项。功能会 fail-loud，但违反错误路径的可定位性，记 P2。 |

## 降层三问

1. **确认注入前的不可逆动作是否成对？**

   `beforeSendData` 之前没有终端写入；它之后先发生一次不可逆的 `sendData(text)`，再运行可异步的 after hook，最后才可能 `sendData('\r')`、清空 preview、结束 session。F2 说明这不是成对提交：断线或用户在异步 hook 期间取消时，文本可能已经写入而回车未写入；断线后的回车还可能进入重连队列。preview 在 F4 的 late final 下也会被异步 engine 回调覆盖，编辑状态没有账本保护。

2. **`appliedSeq`、`generation`、`state` 在单 controller 多轮会话中自洽吗？**

   正常 pointerdown 会递增 generation、重置 appliedSeq；cancel/error/confirm 会递增 generation 并清 handlers，快速连按也由 `state !== idle` 拦截，这些主路径自洽。边界不自洽在 `finishPreview()`：它只写 `waiting-final → preview`，不清理 engine handlers、不改变 generation；因此 late final 可以进入 preview 并覆盖编辑（F4），visibility hidden 又会以 preview 作为 cancelSession 的非法来源（F1）。

3. **保护覆盖的是“写入”还是“行为”？**

   sanitize 覆盖 controller 传给 `sendData(text)` 的文本，并且位于 before hook 之后，能拦住 hook 返回值重新引入的 `\r`/C0；但它不覆盖之后的 autoEnter 行为（F2 暴露其 WS 守卫缺口），也不约束 after hook 通过自身持有的 `term` 直接写入。后者是现有 fail-open hook 的可观测扩展面，不能当安全闸门；本 controller 至少必须对自己的每一次写入行为分别执行 OPEN 守卫。sanitize 的字符保护面也不是正向定义完备（F3）。

## 熵增审查

- `mic-controller`、`asr-preview`：这是锁定 spec 要求的专用状态机与预览边界；preview 接口同时提供 DOM 测试 seam，单消费者有明确必要性，不判熵增。
- `generation`、`appliedSeq`、单一 `state`：分别对应 v5 #3、E3 final 去重和显式迁移，消除异步旧回调/乱序 final/散写状态，不是无依据新增机制；但 F1/F4 说明当前生命周期收口没有覆盖所有状态。
- `XTerminal.isConnected/onConnectionChange`：是 v5 #1 要求的 readyState 事实源，虽然当前主要消费者是 mic controller，单消费者仍是为了阻断既有 `send()` 内存队列这一 P1；未另开注入通道。
- `voice-input` union/schema 与 `voiceInputPlacementCheck`：前者是 R7 封闭 action 契约，后者同时复用 overrides/resolved 两个 schema consumer，均非熵增。

## Backlog

- P2/P3：F3 的 Unicode 正向 allow-list 与字节级回归；F4 的用户编辑/迟到 final 规则；F5 的独立 PTY 输出标记、xterm buffer 字节断言和 routeWebSocket 协议帧断言。
- P2：F6 新订阅者立即同步当前连接态；F7 error/close 合并为单次连接状态迁移；F8 错误路径定位到具体按钮。
- 补齐状态轴测试：permission denied、connect timeout、pointercancel、WS CLOSING/CLOSED、generation 旧回调、preview/error visibilitychange、异步 hook 期间断线/取消/重复确认；补一条 toolbar 既有按钮 onTap 回归测试。
- `stopEngine()` 在取消/切后台路径只 console 记录 reject，未给用户可见错误；需与“错误路径零静默”契约一起决定是否纳入下一轮，不在本轮另造 fallback。

