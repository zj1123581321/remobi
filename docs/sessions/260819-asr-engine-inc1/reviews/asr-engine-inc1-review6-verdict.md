# ASR 增量 1 独立 Review 6 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..4d9087c`
- 重点增量：`c9ae8ec..4d9087c`（F1 final sequence、F2 audio interruption、F3 AudioWorklet fail-loud）
- 风险等级：仓未声明，按 internal；本 diff 涉及失败路径/状态迁移，按 infra 例外提档。
- 结论：**pass with P2/backlog**；本轮没有新增 P1，收敛计数为第 1 个无新增 P1 轮。

## 本轮新证据与审查范围

本轮新证据是前五轮未用作主输入的 `c9ae8ec..4d9087c` 三个修复提交、其与
`c9ae8ec`（P2 收口父）及 `c8f9b3f`（F1-F3 父）的 merge 对照、冻结 H0 上的定点/全量门禁，
以及 OCR 前置扫描的最终 `status=reviewed` envelope。OCR 仅作线索，finding 均经过代码和测试复核。

冻结树中没有任务卡所述的 `docs/sessions/260819-asr-engine-inc1/reviews/` 历史目录；历史五份
verdict 在 `origin/main` 可读，但不属于 H0。审查没有把实现报告或交接单当作生产证据，也没有重复
前轮已闭环 finding。

## F1/F2/F3 闭环核验

| 项目 | 拆穿输入 | 实测结果 | 证据 |
|---|---|---|---|
| F1 final sequence | 发送 flags=3、sequence=1 的 final，同时先发送 flags=0 的无序号 response；注册 `(text, sequence)` handler | 收到 `final, 1`；flags=0 走 partial，未伪造 sequence；旧 `(text)` handler 仍可注册，TypeScript 严格检查通过 | `src/asr/doubao/engine.ts:603-612`；`tests/asr-engine.test.ts:692-714`；旧单参数消费 `tests/asr-engine.test.ts:486,672` |
| F2 ended | 运行中触发 track `onended` | 立即只报一次 `audio-interrupted`，随后 stop 清理 track/context | `src/asr/doubao/engine.ts:278-282,736-765`；`tests/asr-engine.test.ts:984-1010` |
| F2 mute/unmute | 触发 mute 后立即 unmute，再推进 5s | 5s 内不报错，unmute 清除 timer；测试通过 | `src/asr/doubao/engine.ts:283-288,295-298`；`tests/asr-engine.test.ts:1014-1047` |
| F2 mute timeout | 触发 mute，推进 4999ms 后再推进 1ms | 4999ms 无错，满 5s 报一次 `audio-interrupted` | `src/asr/doubao/engine.ts:283-286`；`tests/asr-engine.test.ts:1050-1074` |
| F2 statechange/主动清理 | 初始 suspended 应正常 resume；随后触发 interrupted；第二个 session 主动 stop | 初始 suspended→running 不报错；interrupted 报 `audio-interrupted`；主动 stop 后 errors 为空 | `src/asr/doubao/engine.ts:177-190,289-309,315-341`；`tests/asr-engine.test.ts:1081-1127` |
| F2 迟到信号 | stop 前先解绑 track 三信号、mute timer、context statechange，并使旧 epoch 失效 | 清理代码在 `track.stop()`/`context.close()` 前解绑，迟到旧 epoch 回调不能触达当前 session；现有定点测试覆盖主动 stop 无误报，未单独重复调用已解绑 handler | `src/asr/doubao/engine.ts:301-309,328-329` |
| F3 processorerror | 触发 `AudioWorkletNode.onprocessorerror` | 恰好一次 `onError('audio-context')`，进入 fail/cleanup | `src/asr/doubao/engine.ts:228-230,736-765`；`tests/asr-engine.test.ts:1129-1163` |
| F3 control error | 注入 `{ type: 'error' }` MessagePort 控制消息 | 恰好一次 `onError('audio-context')`；分支在 PCM 读取前 return，不落入 PCM 分支 | `src/asr/doubao/engine.ts:204-226`；`tests/asr-engine.test.ts:1129-1159` |

F1-F3 的错误单次性由 `reportedError` 守卫锁定（`engine.ts:762-765`），epoch 失配还会屏蔽
清理后的迟到事件（`engine.ts:278-280,223-226`）。未发现静默丢 final、重复错误回调或主动
stop/close 误报，因此没有新增 P1。

## v5 #4 中断语义逐条对照

| 信号 | v5 #4 期望 | 实测/实现结论 |
|---|---|---|
| `onended` | 立即按中断处理 | 通过：注册后直接调用 `reportInterruption`，定点测试得到 `audio-interrupted`。 |
| `onmute` | 只观察，不立即取消 | 通过：只安装 5s timer；4999ms 内无错误。 |
| `onunmute` | 恢复并取消观察 timer | 通过：`clearMuteTimer(track)`；恢复测试 5s 后仍无错误。 |
| mute 5s 超时 | 仍 mute 则 cancel | 通过：5000ms 边界报 `audio-interrupted`。 |
| `statechange` | 只处理 `interrupted` 或非主动 `suspended`；正常 suspended→running 与主动 close 不报 | 通过：初始 suspended 在安装信号前 resume；handler 只接受 `interrupted/suspended`，主动 stop 先解绑 handler，close 后为 `closed` 不命中。定点 interrupted/主动 stop 测试通过。 |

这轮没有审 visibilitychange，符合任务卡非目标及既定“由增量 2 负责”的裁决。

## 接口契约终态

### 已满足的接入面

- `AsrFinalHandler = (text: string, sequence?: number) => void` 已成为 `onFinal` 参数类型，
  engine 转发 wire final 的 sequence；`undefined` 仍可被旧的单参数函数忽略。
- 注释已经说明 sequence 的用途是“consumer-side deduplication”，因此增量 2 不需要引擎内做
  final 去重；这与 v5 E3 “增量 2 mic-controller 持有 appliedSeq”一致。
- `audio-interrupted` 已进入 `AsrErrorCode`，并从 track ended、5s mute timeout、
  AudioContext interrupted/non-active suspended 统一进入 `onError`；主动 stop/close 不走该码。

### 新增 P2：types.ts 的契约注释不足以独立指导增量 2

- 溯源 spec：v5 #4 的中断语义（`docs/designs/asr-voice-input.md:277-290`）、E3 final 去重
  （同文件 `:215-220`）、错误路径“增量 1 通过 `onError` 提供错误回调”（同文件 `:148-156`）。
- 证据：`src/asr/types.ts:1-17` 只有错误码 union，没有任何错误码触发条件；新增
  `audio-interrupted` 没有注释；`src/asr/types.ts:20` 只说 sequence 用于去重，没有说明它是
  provider final 的可选 per-session 序号、`undefined` 的含义、或引擎不负责去重。真实触发条件
  只能从实现 `src/asr/doubao/engine.ts:272-309` 反推。
- 影响：增量 2 仍能编译并收到专用事件，但仅凭 types.ts 无法可靠区分“系统音频中断→cancelled”
  与普通错误/用户主动 stop，也无法确认 sequence 是否应按 session 单调比较；这会造成 UI 状态或
  final 去重实现偏差。
- 级别：P2。P1 两问不成立：真实触发条件存在，但运行时已经 fail-loud 并给出专用错误码，
  不会因此直接产生引擎结果静默错误；缺口是接入契约可读性/状态语义，不是本轮新增 P1。
- 最小处置：只补 `types.ts` 的 JSDoc/错误码注释，写清 sequence 的可选/不去重语义、
  `audio-interrupted` 的触发与“非主动 stop/close 不触发”，并给错误码分组列触发条件；不需新增状态、
  fallback、重试或包装层。

`AsrErrorCode` 中既有的 `stopped` 在当前实现没有 emit 点；这是 H0 之前已有的契约不完整项，
本轮不作为新增 finding，但应在上述错误码注释收口时明确“保留/未使用”或移除。

## merge 完整性对照

merge 提交为 `4d9087c`，父提交顺序为 `c8f9b3f`（F1-F3）和 `c9ae8ec`（P2 收口）。

| P2 收口项 | merge 后证据 | 结论 |
|---|---|---|
| HTML cache 头 | `src/serve.ts:325-329` 的 `private, no-store` 由 `/` 与 canonical base-path HTML 路由使用；`tests/serve.test.ts:266-274` 实测 200、HTML、头值精确匹配 | 保留，语义未变 |
| CSP 字节测试 | `src/serve.ts:162-173` enabled/disabled 两态；`tests/serve.test.ts:219-237` 对完整 CSP 字节、Permissions-Policy、wildcard 排除做精确断言 | 保留，语义未变 |
| 文档漂移处理 | `docs/designs/asr-voice-input.md:19-27,190-198,239-245` 已对齐 `_async`/query auth/no-cache；`docs/sessions/260819-1244-asr-spike-inc0.md:1` 标记 superseded | merge 未丢改动 |

两侧父提交对照为：`git diff c9ae8ec 4d9087c` 只包含
`src/asr/doubao/engine.ts`、`src/asr/types.ts`、`tests/asr-engine.test.ts`；
`git diff c8f9b3f 4d9087c` 只包含 serve/文档四文件；没有发现 merge 冲突解析导致的语义回退。

历史 P2 文档漂移尚未完全清零：活动卡 `docs/sessions/cards/asr-engine-inc1.md:113-116`
仍写 `asr-worklet.js?v={version}`，而设计与实现已裁决为无 query + `no-cache`。这是 review5
已登记的延续 backlog，不是本轮 merge 新增，也不影响本轮 P1 收敛计数。

## 终末复验

- `pnpm test`：41 files / **583 tests passed**。
- 定点 F1-F3：`tests/asr-engine.test.ts` 7 tests passed，27 skipped（过滤器之外）。
- `pnpm run check`：119 files，**No fixes applied**。
- `pnpm run lint:ox`：**0 errors，6 warnings**；warning 为既有 postMessage target-origin 规则提示及既有字符串拼接提示。
- `pnpm run build:dist`：在 `git archive HEAD` 的干净临时副本中通过；tsdown 24 files / 423.65 kB，生成 `dist/asr-worklet.js` 1624 bytes。
- `pnpm exec tsc --noEmit`：通过。
- `git diff --check c23d8e7..4d9087c`：通过；当前冻结工作树无 tracked 改动。
- OCR 前置：`status=reviewed`、profile=`minimax`、model=`MiniMax-M3`；返回 30 条 advisory，
  复核统计 29 verified / 17 confirmed / 12 refuted / 1 unverified。未把未溯源的维护性建议或
  未确认项升级为本轮 finding。

## 其他接受不修项

- 不重复前轮已闭环的 binaryType、stop/epoch 串行化、MessagePort 背压、真帧 mock、JSON 畸形帧、
  opened-WS starting close 与 stop rejection。
- 不要求引擎做 final 去重，也不要求引擎监听 visibilitychange；两项已裁决由增量 2 负责。
- OCR 提出的默认 uid、协议 magic number、schema 共享字段等维护性建议未能溯源为本轮用户可感知
  失败；不作为阻塞 finding。

本轮新增 P1：0 / 0
