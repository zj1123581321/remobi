# ASR 增量 2 独立 review 第 2 轮 verdict

## Verdict

**通过本轮复核：无新增 P1；F1–F8 的登记修复均有闭环证据。** 本轮没有发现需要追加的 P2/P3。此前的 8 条 finding 在冻结对象 `11e2a7d..bd9aaeb` 上分别完成了反向拆穿、误拒检查和红验抽查。

审查对象固定为 `11e2a7d..bd9aaeb`，重点修复增量为 `5eeef33..bd9aaeb`；没有把之后的提交纳入结论。溯源契约为设计文档 v5 的 PTT 状态机、R1 sanitize、v5 #1/#12 注入顺序、E7 voice-input 摆放限制，以及增量 2 卡的两张轴表。

## F1–F8 修复闭环

| finding | 拆穿输入 | 实测结果 | 证据（文件:行） |
|---|---|---|---|
| F1 | `permission-requesting` 拒权后保持 error；error 无文本再发 `visibilitychange(hidden)`；waiting-final 超时进入 preview 后再 hidden；recording hidden | 均不抛异常；error 在 hidden 前保留 permission 提示；所有路径清 timer、解绑 engine handler、释放 pointer，并收口到 idle | `src/controls/mic-controller.ts:142-203,379-382`；`tests/mic-controller.test.ts:250-325` |
| F2 | after hook 内把终端置为 disconnected，`autoEnter=true`；另测发送前已断线 | 首段文本仅在 OPEN 时发送；after hook 断线不发送、不进入 `send()` 队列的 `\r`，preview 保留且提示可手动发送 | `src/controls/mic-controller.ts:318-368`；`tests/mic-controller.test.ts:381-415` |
| F3 | C0 全范围、DEL、C1 全范围、U+200B/U+202A/U+2028/U+2029/U+FEFF，及 `e+U+0301` | 所有列出的控制/格式/行段分隔符按 UTF-8 字节移除；组合音标保留；额外探针确认中文、emoji、组合字符保留 | `src/controls/mic-controller.ts:37,60-69`；`tests/mic-controller.test.ts:171-188` |
| F4 | waiting-final 收到 seq=2；之后收到 seq=1 和迟到 seq=3；3s 超时后用户编辑再收到迟到 final | seq=2 合法覆盖并进入 preview；preview 期的 stale/late final 不再改写；超时后的编辑文本保持不变 | `src/controls/mic-controller.ts:206-222`；`tests/mic-controller.test.ts:234-263,417-429` |
| F5 | fake mic 连续 5 次完整 PTT，mock 返回 partial/final，同时观察真实终端输出 | Chromium e2e 3 passed；xterm rows 实际出现 `OUTPUT-0..4`，且测试断言 full-request、audio、end 帧计数及带 flags=3 的尾帧 | `tests/playwright/asr.spec.ts:44-106`；实跑 `3 passed, 1 skipped` |
| F6 | socket 已断开后再注册 `onConnectionChange` | 新订阅者立即收到 `[false]`，不是等待下一次状态变化 | `src/client-entry.ts:255-275`；`tests/playwright/asr.spec.ts:108-124` |
| F7 | 先触发 socket close，再补发 error；也覆盖 error→close 顺序的去重逻辑 | 断开通知只计一次；`lastConnectionState` 按事实态去重 | `src/client-entry.ts:271-300`；`tests/playwright/asr.spec.ts:126-146` |
| F8 | drawer 两个非法 voice-input、floatingButtons 多组中的非法按钮，夹杂合法按钮；再验证 function 形式经最终 resolved 校验 | 每一个非法数组元素均定位到具体 `[index].action.type`；function 形态虽不能在 override 阶段静态展开，但 `defineConfig` 后的 resolved 校验仍拒绝并定位，未形成旁路 | `src/config-schema.ts:371-450,483-507`；`tests/config-validate.test.ts:143-175`；最终校验入口 `cli.ts:202-212` |

## F1 状态 × visibilitychange 穷举

`onVisibilityChange` 对所有 `currentState !== 'idle'` 统一调用 `cancelSession`。该函数的合法来源集合明确覆盖 7 个稳定非 idle 状态；`stopping` 虽只在 `stopRecording` 内同步存在，仍在迁移表中显式覆盖；`cancelled` 随后同步转 idle，不会成为可观察稳定状态。

| 当前状态 | hidden 时的迁移 | 是否可能抛 Invalid transition | 证据 |
|---|---|---|---|
| idle | no-op | 否 | `src/controls/mic-controller.ts:379-382` |
| permission-requesting | cancelled → idle | 否 | `src/controls/mic-controller.ts:185-203` |
| connecting | cancelled → idle | 否 | 同上 |
| recording | cancelled → idle | 否 | 同上；测试 `tests/mic-controller.test.ts:316-325` |
| stopping | cancelled → idle（稳定观察前通常已进入 waiting-final） | 否 | `src/controls/mic-controller.ts:228-230` 与 `185-203` |
| waiting-final | cancelled → idle | 否 | `tests/mic-controller.test.ts:250-263` |
| preview | cancelled → idle，文本清除并保留取消提示 | 否 | `src/controls/mic-controller.ts:191-203`；测试 `tests/mic-controller.test.ts:257-263` |
| error | cancelled → idle；无文本 error 在 hidden 前仍保留原 error 提示 | 否 | `src/controls/mic-controller.ts:166-180,185-203`；测试 `tests/mic-controller.test.ts:265-277` |
| cancelled | 同步已转 idle | 否 | `src/controls/mic-controller.ts:200-203` |

资源收口由 `cleanupSession()` 的 timer 清理、engine handler 解绑和 pointer capture 释放完成（`src/controls/mic-controller.ts:119-145`）；error/visibility 两条路径都调用 `stopEngine()`，其拒绝仍以 console.error 可观察，未静默吞掉（`src/controls/mic-controller.ts:148-151`）。

## 反向误拒检查

| 合法输入/行为 | 结果 | 证据 |
|---|---|---|
| waiting-final 内首个 seq 更大的合法 final（seq=2） | 接受，写入 preview | `tests/mic-controller.test.ts:234-242` |
| waiting-final 内 seq≤appliedSeq 的重复/乱序 final | 丢弃 | `tests/mic-controller.test.ts:243-244` |
| preview 期 seq 更大的迟到 final | 丢弃，避免覆盖 preview/用户编辑 | `tests/mic-controller.test.ts:245-247,417-427` |
| 中文、emoji、带重音的组合字符 `e+U+0301` | 保留；UTF-8 字节探针通过 | `src/controls/mic-controller.ts:61-69`；修复后探针输出 `SANITIZE_FULL_C0_DEL_C1=PASS; COMBINING_CJK_EMOJI=PASS` |
| WS OPEN、`autoEnter=true` | 文本发送后独立发送 `\r`，完成后 idle | `tests/mic-controller.test.ts:337-379` |
| WS 非 OPEN | 不发送、不排队，文本保持 preview | `tests/mic-controller.test.ts:381-394` |
| after hook 内断线、`autoEnter=true` | 已发送文本保留，独立 `\r` 被拒绝 | `tests/mic-controller.test.ts:396-415` |
| cancel 后再次按下 | `idle → permission-requesting`，未误触发 engine.start；实测 `CANCEL_STATE=idle; RESTART_STATE=permission-requesting; START_CALLS=0` | `src/controls/mic-controller.ts:201-203,283-295` |

## 红验与绿验

| 抽查 | 基线/输入 | 结果 |
|---|---|---|
| F3 sanitize | 临时 worktree `5eeef33`，仅拷入修复后的 `tests/mic-controller.test.ts`，抽跑 zero-width 用例 | 红：零宽/格式字符穿透；修复前测试失败 |
| F1 permission/error | 同上，抽跑 permission denial + visibility cancellation | 红：修复前状态为 idle，不是 error |
| F2 after-hook guard | 同上，抽跑 disconnect during after-send hook | 红：修复前实际发送 `['typed command', '\\r']` |
| 修复后定点绿验 | `bd9aaeb`：mic-controller + config-validate | 74/74 通过 |
| 修复后全量单测 | `bd9aaeb`：`pnpm test` | 42 files / 621 tests 通过 |
| 修复后 e2e | `bd9aaeb`：Chromium ASR 定点套件 | 3 passed；WebKit 能力用例按项目规则 skipped |

## P1 复核与工具状态

- P1 问题一：是否仍能从任一注入路径把 `\r`/C0 带入终端？——本轮拆穿输入、after-hook 断线和全量单测均未复现；autoEnter 是独立且有 OPEN 守卫的写入。
- P1 问题二：是否存在资源未收口、陈旧回调改写新会话或状态机抛错导致用户路径中断？——generation、handler cleanup、timer cleanup、pointer release 与全状态 cancellation 均有证据，未复现。
- OCR 前置扫描：`ocr-review` 未产出 envelope；约 100 秒只有 `leg=primary event=start`，缓存证据显示 primary/backup 均为 `caller_error:usage_help`。按规则记为 `skipped/未完成`，没有把空 findings 当成 clean，也不以 OCR 结果替代人工审查。
- 反熵检查：修复只增加必要的正则过滤、连接事实态去重、状态迁移覆盖和具体路径错误；未新增配置、fallback、重试或第二套注入通道。

## 收敛判定

本轮新增 P1：0 / 0
