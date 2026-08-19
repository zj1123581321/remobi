# ASR 增量 1 独立 Review 7 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..a673fa14800a9e176e4a5f4e6b07a84e9ceb793c`（H0 冻结）
- 重点增量：`1db2735..a673fa1`（fix3 `flags=1` partial 解码 + 真实服务成功会话 fixture）
- 本轮新证据：前六轮未用作主输入的 fix3 代码/测试、`2026-08-19T1242Z-live-smoke` 真实语音+真实火山服务 23 帧、逐帧 decoder 探针、合法域双向探针及 H0 终末门禁。
- OCR 前置：包装器返回 `status=skipped`，三条腿均为 `caller_error:usage_help`；没有把空 findings 当作已扫过，也没有采纳 OCR finding。
- 结论：**pass with P2/backlog**；本轮没有新增 P1，收敛计数达到第 2 个连续无新增 P1 轮，正式收敛。

## 1. 结论摘要

fix3 的运行时放宽面是最小的：仅 `0x9` server-response 接受 flags `1`，并把该形态的 sequence 与 payload 起点从 wire offset `8` 正确处理为 payload offset `12`。`decodeAudio`、full-request、error 的合法域没有被连带放宽。

真实 1242 会话逐帧得到：1 个 flags=0 元数据帧、21 个 flags=1 partial（sequence 1..21）、1 个 flags=3 final（sequence 22），没有其它 flags、audio_info-only 帧或多 final。当前 decoder 对 23/23 帧全部接受，字段和长度边界均正确。

保留一条 P2：fix3 新增的 flags=1 分支在仓库测试中只有正向代表帧和 flags=2 负例；flags=1 的截断 sequence、声明长度/实际 payload 边界虽然已由本轮探针全部拒绝，但没有逐项作为回归测试锁死。它是测试完备性缺口，不是当前运行时错误，不阻塞本轮 P1 收敛。

## 2. live fixture 逐帧审计

以下 `payload offset/len` 是 SAUC frame 的 JSON payload 起点和实际字节数；`P` = `tests/asr-protocol.test.ts`，`E` = `tests/asr-engine.test.ts`。

| 帧 | bytes | flags | sequence | payload offset / len | live JSON 形态 | decoder | 测试锁定 |
|---:|---:|---:|---:|---:|---|---|---|
| 001 | 80 | 0 | — | 8 / 72 | `result.additions.log_id`，无 text | 接受 | P flags=0 代表帧（55-57）；1242 精确字节未逐帧引用 |
| 002 | 323 | 1 | 1 | 12 / 311 | partial，text=`The.`，含 audio_info/utterances | 接受 | P flags=1 + sequence=1（59-63）；E 真实 fixture 穿 engine（718-735） |
| 003 | 430 | 1 | 2 | 12 / 418 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 004 | 530 | 1 | 3 | 12 / 518 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 005 | 642 | 1 | 4 | 12 / 630 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 006 | 839 | 1 | 5 | 12 / 827 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 007 | 948 | 1 | 6 | 12 / 936 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 008 | 1051 | 1 | 7 | 12 / 1039 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 009 | 1073 | 1 | 8 | 12 / 1061 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 010 | 1085 | 1 | 9 | 12 / 1073 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 011 | 1156 | 1 | 10 | 12 / 1144 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 012 | 1368 | 1 | 11 | 12 / 1356 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 013 | 1565 | 1 | 12 | 12 / 1553 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 014 | 1771 | 1 | 13 | 12 / 1759 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 015 | 1892 | 1 | 14 | 12 / 1880 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 016 | 1908 | 1 | 15 | 12 / 1896 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 017 | 1920 | 1 | 16 | 12 / 1908 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 018 | 1991 | 1 | 17 | 12 / 1979 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 019 | 2288 | 1 | 18 | 12 / 2276 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 020 | 2491 | 1 | 19 | 12 / 2479 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 021 | 2597 | 1 | 20 | 12 / 2585 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 022 | 2789 | 1 | 21 | 12 / 2777 | partial，含 text/audio_info/utterances | 接受 | flags=1 类覆盖；该精确帧未单独断言 |
| 023 | 3035 | 3 | 22 | 12 / 3023 | final，含 text/audio_info/utterances | 接受 | P 既有 flags=3 final + sequence=1（40-53）；sequence=22 精确帧未单独断言 |

审计结论：所有帧的 `bytes = payload offset + payload len`；flags=1 的 21 帧都使用 sequence 4 字节 + length 4 字节 + JSON payload 的 offset=12 形态。第 001 帧是 metadata-only，不是 audio_info-only；第 002-023 帧都有 `audio_info`，但只有第 023 帧是 final。live 中没有第三种 flags、没有多个 final，也没有 decoder 未覆盖的 offset 分布。

## 3. decoder 合法域双向矩阵

### 3.1 `0x9` server-response flags 域

| 输入 flags | 规范终态 | 实际结果 | 仓库测试/探针证据 |
|---:|---|---|---|
| 0 | 合法；无 sequence；payload offset=8 | 接受，无误拒 | 既有 flags=0 fixture 与 P55-57 |
| 1 | 合法；sequence 在 4，payload offset=12 | 接受，无误拒 | live 23 帧中的 21 帧；P59-63、E718-735 |
| 3 | 合法；sequence 在 4，payload offset=12 | 接受，无误拒 | 既有 final fixture P40-53；live frame 023 |
| 2 | 非法 | 拒绝，无误收 | P88-95 |
| 4..15 | 非法 | 全部拒绝，无误收 | 本轮 0x9 全 flags 0..15 探针 |

因此「合法 × 误拒」为 `{0:0, 1:0, 3:0}`，「非法 × 误收」为 `{2,4..15:0}`。

### 3.2 flags=1 截断与 payload offset 边界

| 输入 | 期望 | 实际结果 |
|---|---|---|
| flags=1，frame 长度 4..11 | 拒绝 sequence 截断 | 8/8 全部拒绝 |
| flags=1，正确 sequence + length + `{}`，payload offset=12 | 接受 | 接受 |
| flags=1，声明长度小于实际 payload | 拒绝 | 拒绝 |
| flags=1，声明长度大于实际 payload | 拒绝 | 拒绝 |
| flags=1，正确 payload 后附加字节 | 拒绝 | 拒绝 exact-length mismatch |
| flags=1，空 payload | 拒绝非法 JSON | 拒绝 |

flags=3 复用同一 `readSequence`/`payloadSlice` 结构，既有 flags=3 截断测试继续通过。flags=1 的上述负向矩阵尚未全部进入仓库测试，形成 P2-F1；本轮探针确认实现本身没有误收。

### 3.3 其它消息类型未被连带放宽

当前实现仍为：full-request 仅 flags=0；audio 仅 flags=0/2/3，且 flags=2/3 要求空 payload；error 仅 flags=0。对各类型合法/非法 flags 的探针结果与这些域完全一致。fix3 的 `readSequence` 虽是共享 helper，但 `decodeAudio` 的 flags 守卫先拒绝 flags=1，因此没有实际放宽 audio。

## 4. fix3 最小性与 mock server 结论

fix3 只改了 `src/asr/doubao/protocol.ts:34,148-152,209-216`：

- 将 `DecodedServerResponse.flags` 扩为 `0 | 1 | 3`；
- 仅让 `readSequence` 为 flags=1/3 读取 sequence；
- 仅在 `decodeServerResponse` 为 flags=1/3 使用 length offset=8、payload offset=12；
- 保留 flags=2 及其它 server-response flags 的 fail-fast 拒绝。

没有改 `decodeAudio`、`decodeFullRequest`、`decodeError` 的域，没有改客户端 encode，没有新增 fallback/retry/防御式 catch，也没有新增状态或抽象。对应的正向协议 golden、flags=2 负例和 engine `onmessage → decodeFrame → onPartial` 回归在 `tests/asr-protocol.test.ts:55-95`、`tests/asr-engine.test.ts:718-741`。

mock server（`tests/fixtures/asr/mock-volc-server.ts:20-21,104-134`）仍发送已有真实 fixture 的 flags=0 partial 与 flags=3 final，不主动模拟 flags=1 partial。该设计不构成 P1：flags=1 已由真实 1242 服务会话穿过 shipped engine，且引擎层有真实 flags=1 fixture 的 socket seam 集成测试；mock 的职责是 fixture-driven 协议子集和端到端清理/尾包路径，不需要为每个 provider response variant 复制一套发送分支。若以后要增强覆盖，可让 mock 选择 1242 flags=1 fixture，但这会是重复覆盖，不是当前修复的必要条件。

## 5. 新增 finding

### P2-F1：flags=1 负向边界未由仓库测试逐项锁死

- 溯源 spec：设计文档要求协议 round-trip + 畸形帧拒绝（`docs/designs/asr-voice-input.md:126-132`）；任务卡要求 fix3 后对 `0x9` 合法 `{0,1,3}` 做合法×误拒、非法×误收，并覆盖 flags=1 截断 sequence 与 payload offset 边界。
- 证据：正向 flags=1 只断言 `tests/asr-protocol.test.ts:55-63` 的代表帧；非法 flags 只断言 flags=2（`88-95`）；截断参数化测试覆盖 flags=3（`117-124`），没有 flags=1；`tests/asr-engine.test.ts:718-741` 只穿过 flags=1 sequence=1 的真实代表帧。本轮独立探针已验证 flags=1 长度 4..11、声明长度不匹配、尾随字节均正确拒绝。
- 影响：当前代码没有误收或误拒，但未来若只改 flags=1 分支的 sequence/payload offset，CI 不会直接锁住这组负向边界；这是回归保护不足。
- 级别：P2，接受不修进入 backlog，不阻塞正式收敛。P1 两问均不成立：真实 flags=1 已在 live 成功会话中工作，当前没有真实使用触发的用户可感知失败；后果是缺少测试锁而非运行时静默丢 partial/final。最小后续处置是把现有 flags=3 截断/长度参数化矩阵扩成 flags=1，并加一条 flags=1 payload offset exact-length 负例，不新增运行时机制。

## 6. 终末全量复验

| 命令 | 结果 |
|---|---|
| `pnpm test` | 41 files / 586 tests passed |
| `pnpm run check` | 119 files checked，0 error |
| `pnpm run lint:ox` | 0 errors，6 warnings；均为既有 postMessage target-origin 与字符串拼接 warning |
| `pnpm run build:dist` | 通过；tsdown 24 files / 423.65 kB，overlay 构建完成 |
| 逐帧 decoder probe | 1242 live fixture 23/23 accepted |
| 合法域双向 probe | `0x9` flags 0..15 结果精确为 accept `{0,1,3}` / reject `{2,4..15}` |
| `git diff --check c23d8e7..a673fa1` | 通过；审查前后工作树无非 verdict 改动 |

测试期间 happy-dom 仅打印已有的预期错误日志，Vitest 仍以 586/586 通过；没有把 stderr 日志误判为失败。

## 7. 历史 backlog 与收敛

不重复前轮已闭环的 binaryType、stop/epoch 串行化、MessagePort 背压、真实 fixture mock、JSON 畸形帧、opened-WS starting close、stop rejection、HTML cache/CSP 及 F1-F3。review6 的 types.ts 契约注释和活动卡 `?v={version}` 文档漂移仍是历史 P2/backlog，不是本轮新增。

本轮新增 P1：0 / 0
