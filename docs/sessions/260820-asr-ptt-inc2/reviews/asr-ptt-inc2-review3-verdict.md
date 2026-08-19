# ASR 增量 2 独立 review 第 3 轮 verdict

## Verdict

**通过本轮：新增 P1 为 0；发现 1 条新的 P2 资源账本问题。**

审查对象固定为 `11e2a7d..bd9aaeb`，没有把冻结 H0 之后的提交纳入结论。本轮主输入是此前两轮没有使用的运行时证据：happy-dom 真实 `createMicController` + fake engine/term/preview seam 的固定种子交错压力、注入模糊和 50 轮资源账本。历史 F1–F8 不重复提报。

本仓按 internal 风险等级处理；本 diff 属状态机/失败路径类，收敛条件按上一档执行。第 2 轮已为 0 新增 P1，本轮仍为 0，达到连续两轮无新增 P1 的正式收敛条件。

## 运行时探针结果

探针临时路径：`.tmp-review3/ptt-pressure.test.ts`，配置：`.tmp-review3/vitest.config.ts`。探针不在 git 中。

复跑命令：

```bash
pnpm exec vitest run --config .tmp-review3/vitest.config.ts --reporter=verbose
```

结果：

- 固定 seed `0x26082003`，512 条排列，每条 12 事件，共 6144 个事件位置；事件集合覆盖 pointerdown/pointerup/pointercancel、timeout tick、permission grant/deny、engine partial/final（含多种 seq）、engine error、visibility hidden/visible、WS connect/disconnect、用户编辑、确认、取消、重复确认。
- 交错探针执行 6330 个 V1/V2/V6 断言，`violations=0`；未出现 `Invalid mic transition`，hidden 收口路径未遗留 handler、timer 或 pending start。
- 注入模糊 7 类输入，`failures=0`。
- V4/V5 定点探针均通过：断线确认不调用 term 输入且保留预览；首个 `seq=2` 被接受，进入 preview 后 `seq=1/3` 均不能覆盖文本。
- `pnpm test`：42 files / 621 tests 通过。测试中既有 keyboard-toggle 负向路径会按预期打印错误日志，不影响退出码。

## V1–V6 逐条结论

| 不变式 | 结论 | 新证据与代码落点 |
|---|---|---|
| V1：事件后状态合法、迁移不抛 | **未拆穿** | 512×12 交错中 `violations=0`；唯一状态写入仍由 `src/controls/mic-controller.ts:107-117` 的 `transition()` 承担。 |
| V2：任意非 idle + hidden → cancelled → idle，解绑 handler、清 timer | **未拆穿** | 每个 hidden 事件后检查 idle、engine handler=0、fake timer=0；统一路径为 `src/controls/mic-controller.ts:379-382` → `182-203`。 |
| V3：注入字节不含 C0/DEL/C1/Cf/Zl/Zp，autoEnter 独立 `\r` 帧 | **未拆穿** | C0/C1/DEL、Cf、Zl/Zp、组合字符、8192 字符、空文本、纯空格 7 类输入均通过；`sanitizeVoiceText()` 在 `src/controls/mic-controller.ts:60-69`，文本与 `\r` 分别由 `:350`、`:365` 发送。 |
| V4：WS 非 OPEN 时无 sendData、无队列累积、预览保留 | **未拆穿** | 断线后确认结果为 `sent=[]`、state=`preview`、原文本保留；readyState 守卫在 `src/controls/mic-controller.ts:325-350`，autoEnter 另有 `:361-365` 守卫。 |
| V5：final 仅在 waiting-final 且序号有效时应用；preview 后 final 无效 | **未拆穿** | `seq=2` 首 final 应用；随后 `seq=1` 与 `seq=3` 均不能改写 preview；门控在 `src/controls/mic-controller.ts:214-221`。 |
| V6：序列干净结束、无悬挂 promise、无重复 onError | **未拆穿（资源账本的冗余 stop 另列 P2）** | 交错结束时 pending start=0、handler=0、timer=0、无异常；每个 engine error 事件只产生一次 controller 回调。50 轮的 stop 调用次数不成对属于下述 P2，不是悬挂资源。 |

## 注入面模糊结果

| 输入类 | 期望 | 实测 |
|---|---|---|
| C0 + DEL + C1 混合 | 控制字符全部移除 | 文本帧只含清洗后的可打印内容；通过 |
| Cf（ZWSP、连接控制、Bidi、FEFF） | 格式/零宽字符移除 | 全部移除；通过 |
| Zl/Zp | 行/段分隔符移除 | 全部移除；通过 |
| 组合字符、中文、emoji | 保留合法 Unicode，不误删组合音标 | `e\u0301 你好 🎙️` 保留；通过 |
| 超长文本 | 不引入控制字节，按原文本清洗 | 8192 个 `x` 作为独立文本帧发送；通过 |
| 空文本 | 不发送文本，也不发送 autoEnter | `sent=[]`；通过 |
| 纯空格 | 空格属于允许字符，独立文本帧后才追加回车 | 文本帧与独立 `\r` 帧均正确；通过 |

## 多轮资源账本

50 轮均按「pointerdown → 300ms → engine start grant → recording → pointerup → final(seq=1) → 确认/取消」执行，确认与取消交替。

```text
rounds=50
starts=50
stops_before_dispose=75
stops_after_dispose=76
handlers_before_dispose=0
connection_listeners_before=1
connection_listeners_after=0
applied_seq_reset_failures=0
paired_before_dispose=false
```

每轮 engine handlers 都回到 0，连接 listener 在 controller dispose 后回到 0；每轮都能重新接受 `seq=1`，所以 `appliedSeq` 每轮重置。多出的 25 次 stop 来自 25 个取消轮：pointerup 已经在 `src/controls/mic-controller.ts:228-234` 停止 engine，preview 取消又在 `:372-376` 再次调用 `stopEngine()`。最小复现序列为：

```text
pointerdown → tick(300ms) → permission grant → pointerup
→ engine final(seq=1) → preview Cancel
```

该序列得到 `starts=1, stops=2`。controller dispose 还会在 `src/controls/mic-controller.ts:416-425` 再调用一次 stop；当前 `DoubaoEngine.stop()` 在 idle 时于 `src/asr/doubao/engine.ts:498-500` 直接返回，因此没有观测到实际音频资源泄漏。

## Findings

### F9 — P2：preview 取消重复调用 engine.stop，资源账本不成对

- **级别**：P2；不阻塞本轮收敛。
- **溯源 spec**：增量 2 卡 `docs/sessions/cards/asr-ptt-inc2.md:86-104` 轴 1、完成条件 `:118` 的状态机全格与本轮明确的“50 轮 engine start/stop 调用次数成对、listener 回基线、appliedSeq 重置”账本要求；设计 v5 `docs/designs/asr-voice-input.md:99-113` 的 `recording → stopping → waiting-final → preview` 生命周期。
- **证据**：运行时 50 轮得到 `start=50 / stop=75`，最小序列见上。实现中 pointerup 的 `stopRecording()` 已调用 `engine.stop()`，之后 preview 的 `cancelPreview()` 无条件再次调用 `stopEngine()`。
- **影响判断**：真实使用中取消 preview 可触发，故第一问“真实使用会触发”通过；但当前唯一 provider `DoubaoEngine.stop()` 对 idle 是幂等 no-op，handler、timer、capture 账本均已清理，第二问“后果不可接受”不通过，故不能升级 P1。若未来 AsrEngine 实现不保持该幂等性，会放大为接口契约问题；当前按 P2 记录。
- **建议**：preview 是 stop 已完成后的稳定态，取消路径应去掉这次重复 stop；保留 `showError()` / active cancellation 的必要 stop 路径，并以一条回归账本断言锁定每轮一对 start/stop。

## 反熵检查与 OCR 状态

本轮未新增被审代码、状态、接口、配置或 fallback；临时探针只复用既有 engine/term/preview seam。F9 的最小修复是删除一条重复调用，不需要新增抽象或状态。

按 review-discipline 要求已运行 OCR 前置扫描。主腿与 qwen/glm 备腿均在 input 阶段返回 `caller_error:usage_help`，没有有效 review envelope；因此本轮 OCR 状态记为 **skipped / 未完成**，未将空 findings 当作扫描干净。缓存证据位于 `~/.cache/ocr/ocr-failure-{minimax,qwen,glm}-*.stderr`。

## 收敛判定

本轮新增 P1：0 / 0
