# 任务卡：ASR 增量 1 — 引擎核心（AsrEngine + doubao provider + config/CSP 接线）

## 目标

按设计文档实现 ASR 引擎核心：浏览器 AudioWorklet 采集 → PCM 管线 → 手写 SAUC 帧协议层 →
query 鉴权直连火山 `bigmodel_async`，识别事件（partial/final/error）经 AsrEngine 接口暴露；
配套 config schema、CSP/permissions-policy、worklet 静态路由与发布资产、mock ASR server 与
字节级测试。**不含任何 PTT UI**（增量 2 才接 mic-controller/preview/action）。

## 非目标

- 不做 PTT UI、mic-controller、预览气泡、sanitize、`{type:'voice-input'}` action 的渲染接线、
  playwright e2e（全部增量 2）。
- 不实现 Web Speech provider、热词注入、语音命令（设计文档已 CUT/DEFERRED）。
- 不引入帧协议/SDK 新依赖（手写最小帧层；`ws` 仅测试侧 mock server 用，已在仓）。
- 不做 opus/MediaRecorder 路径（spike 实测 0xF/45000151 不支持）。
- 不碰 `.github/workflows/`、CHANGELOG.md。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：3000
- **Diff-Lines-Hard**：3500
- **阶段**：implementing
- **锁定决策**：
  - 权威设计文档 `docs/designs/asr-voice-input.md`（v5）增量 1 节 + Eng Review 锁定节（模块布局、
    E1/E2/E4/E7、测试矩阵、v5 #10/#15/#16）。
  - **spike 实测 deltas（与设计文档冲突时以实测为准）**，证据
    `docs/sessions/260819-1306-asr-spike-results.md` + `tests/fixtures/asr/`：
    1. endpoint = `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`（不是旧 `/bigmodel`）；
       浏览器 query 鉴权参数名 = `api_key` + `api_resource_id`。
    2. config 为**单 `apiKey`**（无 appKey/accessKey/STS）；resourceId 默认
       `volc.seedasr.sauc.duration`。
    3. 尾包 `0b0010`/`0b0011` 服务端均接受；带序列尾包 sequence = `-(音频帧数+2)`；
       0x9 = server full response（partial/final），**不是业务错误帧**；0xF 才是错误帧
       （4B error code + 4B length + payload，offset 12）。
    4. 实帧均未压缩（compression nibble 0）；full/audio 帧 payload offset 8，
       0x9 final flags=0b0011 offset 12。
    5. 真机三环境实测 `AudioContext({sampleRate:16000})` 实际输出均 16000
       → pcm.ts **不建**线性抽取回退；但 iOS 上 AudioContext 启动为 `suspended` 后转
       `running`，引擎必须容忍该时序（v5 #5：构造 try/catch + 构造后 sampleRate 校验，
       校验失败走 onError，不静默降级）。
    6. opus 不支持，PCM 16kHz/16bit/mono 是唯一格式。
  - C8 密钥威胁模型已裁决：密钥经 `__remobiConfig` 全量内联下发（R3，build.ts:58 既有通道），
    无新增通道。
- **任务类型**：backend-logic
- **复杂度**：L
- **Base commit**：eeec5a1（origin/main，PR #6 合并 + 本卡入库后）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑只读验收）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **子代理 fan-out**：允许派 explorer 子代理并行只读扫描（fork_turns=none 防上下文污染）；并行写仍受一支笔约束
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收；review 按仓 risk-tier（未声明，按 internal）执行

## 修改边界

- **允许**：
  - `src/asr/**`（新模块：types.ts / pcm.ts / worklet-entry.ts / doubao/protocol.ts / doubao/engine.ts）
  - `src/config.ts`、`src/types.ts`、`src/config-schema.ts`、`src/config-resolve.ts`、`src/config-validate.ts`（asr 段）
  - `src/serve.ts`（worklet 路由 + buildSecurityHeaders asr 参数）
  - `build.ts`（bundleWorkletAsset 双路径）、`scripts/build-overlay.ts`（dist/asr-worklet.js）
  - 上述文件各自的配套测试：`tests/` 下新增或既有相关测试文件
  - `tests/fixtures/asr/mock-volc-server.ts`（及该目录下新增 mock 专用文件；**既有 19 个真帧目录只读**，不得改动）
  - `.agents/skills/remobi-setup/SKILL.md`（config shape 变化同步，仓规要求）
  - `AGENTS.md`（Module Layout 增加 src/asr/ 段，仓规要求）
- **禁止**：`tests/fixtures/asr/2026*`（spike 真帧 fixture，只读）、`spikes/`（可丢弃参考，不进依赖）、
  `src/controls/`、`src/client-entry.ts`、`src/toolbar/`、`src/drawer/`（增量 2 地盘）、
  `.github/workflows/`、CHANGELOG.md、`package.json`/lockfile（不加依赖）。
- **Scope-Globs**：src/asr/** src/config.ts src/types.ts src/config-schema.ts src/config-resolve.ts src/config-validate.ts src/serve.ts build.ts scripts/build-overlay.ts tests/** .agents/skills/remobi-setup/SKILL.md AGENTS.md
- **高风险区域**：
  - `buildSecurityHeaders` 签名变化影响既有调用——**既有 serve 测试全绿是回归铁律**（设计文档原文）。
  - 密钥：config 校验报错只报路径不回显值（v5 #16：asr 子树 redact 字符串原值，覆盖父对象被
    字符串替换的路径如 `doubao: "sk-xxx"`，不只叶子字段）；日志不打完整带参 wss URL（打 origin）。
  - AudioWorklet `process()` 在实时线程：不分配内存，复用预分配 buffer（设计性能节）。

## 不变式轴表

轴 1：SAUC 帧类型 × encode/decode round-trip（每格都要有检测点）

| 帧 | 检测点 |
|---|---|
| client full request（offset 8） | golden bytes 单测（spike 实帧 `20260819T052830488Z-query-seedasr-duration-2b7d8bd5/000-send-full-client-request.hex`） |
| client audio-only（offset 8） | golden bytes 单测（同目录 001 audio 帧） |
| 尾包 neg-with-seq（offset 12，seq=-(N+2)） | golden 单测（同目录 011）+ mock 集成 |
| 尾包 neg-no-seq（offset 8） | golden 单测（`20260819T052830811Z-...-end-variant-neg-no-seq-73fd940e`） |
| server 0x9 partial（offset 8） | golden decode 单测（主 fixture 012） |
| server 0x9 final（flags 0b0011, offset 12, seq） | golden decode 单测（主 fixture 013） |
| server 0xF 错误帧（code+length, offset 12） | golden decode 单测（45000000/45000151/45000292 实帧目录） |
| 畸形帧（截断/错 nibble/错长度） | 拒绝单测（不 crash、不误判为合法帧） |

轴 2：`asr.enabled` × security headers

| enabled | microphone permissions-policy | connect-src |
|---|---|---|
| false（默认） | 不含 | 不含 `wss://openspeech.bytedance.com` |
| true | `microphone=(self)` | 追加该单 origin |

两态都有 serve 测试；既有 header 测试不许改断言（回归铁律）。

## 完成条件

- **行为验收**：
  1. `AsrEngine` 最小接口（start/stop/isSupported/onPartial/onFinal/onError）+ doubao 实现，
     采集→PCM→协议→WS 全链路可注入 mock server 跑通 partial/final。
  2. PCM 管线：Float32→Int16 量化（溢出截断）+ 100ms 分块（1600 样本/3200B），纯函数字节级单测。
  3. 背压闭环（v5 #6 从简实现）：在途总量 = worklet port 在途 + 应用环形缓冲 + `ws.bufferedAmount`，
     100ms tick 检查，高水位 2s → `onError('network-too-slow')`（不静默丢音频）；WS CLOSING/CLOSED
     立即停采集转 error；stop 顺序 = 停采集 → 排空 → worklet flush 末包 ack 后发结束包（v5 #7/#8）。
  4. mock-volc-server（E4）：query 参数缺/错 → 401 拒绝；full request → full response；
     每 N 音频包回 partial；负序号包 → final；可注入畸形帧/错误码/断连；fixture 驱动。
  5. worklet 交付（E1）：build.ts `bundleWorkletAsset()` 双路径（源码 esbuild 现打 /
     `readPrebuiltAsset('asr-worklet.js')`）；`scripts/build-overlay.ts` 写 `dist/asr-worklet.js`；
     serve 路由 `GET {basePath}asr-worklet.js` → `text/javascript` + `cache-control: no-cache`
     （缓存策略定案为 no-cache，不接 `?v={version}`——review4 P2 处置，2026-08-19 修订）；
     CSP 对 worklet 零改动（same-origin 走 script-src 'self'）。
  6. config（E7 + spike delta）：`asr: { enabled:false, provider:'doubao'(字面量), doubao:{ apiKey,
     resourceId='volc.seedasr.sauc.duration' }, autoEnter:false }`；schema/merge/defineConfig 全通；
     校验报错只报路径不回显值（含 `doubao` 被整体替换为字符串的情形）。
  7. `pnpm pack` 冒烟（v5 #15）：临时目录安装 tarball → `node dist/cli.mjs serve` →
     请求 `{basePath}asr-worklet.js` 得 200 + `text/javascript`（防 readPrebuiltAsset 动态 fallback
     掩盖 dist 缺资产；esbuild 是 devDependency）。
- **相关测试**：`pnpm test` 全量（含新增：protocol golden/畸形、pcm 字节级、CSP/config 两态、
  engine↔mock 集成、serve 路由）；`pnpm run test:pw` 全量无回归。
- **跨发布边界验收**：protocol 单测的 golden 必须是 spike 实帧（`tests/fixtures/asr/2026*` 真帧，
  v5 #10：断言 byte1/2 nibble、big-endian payload 长度、PCM s16le；mock 与生产 encode/decode
  不互相证明——mock 的期望值也来自真帧而非生产代码输出）。
- **lint / typecheck / build**：`pnpm run check`、`pnpm run build:dist` 全绿。
- **截图或探活**：pack 冒烟的 curl 状态码/内容类型摘录进报告。
- **现场还原**：收工时 worktree 停 card 分支、tree clean；无全局配置改动。
- **提交纪律**（固定条款）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），
  未提交的工作按未完成处理，不得把提交留给验收方。具体节奏：按
  ①protocol+golden 测试 → ②pcm+单测 → ③engine+mock 集成 → ④build/serve/config 接线 →
  ⑤冒烟+SKILL/AGENTS 文档 至少 5 次提交；类型用 `feat(asr):`（消费者可见新能力）。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，
  改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
- **执行器自声明 outcome**（固定条款）：报告文件（report.md）正文中、首个二级标题之前，
  必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，二选一：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  值域只有 succeeded / failed，描述执行器本次任务是否完成，与 review verdict 正交。

## 当前状态

- **现场事实（主脑预取）**：
  - 设计文档：`docs/designs/asr-voice-input.md`（main 已有）；增量 1 节 + Eng Review 锁定节是
    模块布局/接口/测试矩阵的权威，本卡不重复全文。
  - spike 结果与实测 deltas：`docs/sessions/260819-1306-asr-spike-results.md`（验收清单 + 真机矩阵）。
  - 真帧 fixture：`tests/fixtures/asr/`（main 已有，19 目录 233 hex + transcript.jsonl；
    主成功链路目录 `20260819T052830488Z-query-seedasr-duration-2b7d8bd5`）。
  - 协议备忘：`spikes/asr/PROTOCOL-NOTES.md`（main 已有；实跑 nibble/offset/序列规则）。
  - 可参考的探针帧编解码：`spikes/asr/probe-auth.ts`（**仅参考**，正式实现进 src/asr/doubao/protocol.ts，
    不 import spike 代码）。
  - 既有模式锚点：`build.ts:31-47`（readPrebuiltAsset 双路径）、`build.ts:58`（__remobiConfig 内联）、
    `serve.ts:154-169`（buildSecurityHeaders）、serve.ts 图标路由（静态路由先例）、
    `src/config-schema.ts`（valibot）、`tests/` serve/config 测试模式（happy-dom/node）。
  - 仓 risk-tier 未声明，按 internal 处理（主脑已记 backlog：补声明）。
- **已完成**：增量 0 spike GO（query 鉴权/尾包 variant/opus/真机能力全部实测闭环，PR #6 已合 main）。
- **未完成**：增量 1 全部；增量 2（PTT UI）待增量 1 合并后另开卡。
- **关键决策**：spike deltas 优先于设计文档旧表述（单 apiKey、_async endpoint、0x9 非错误帧）。
- **已否决方案**：byted-ailab-speech-sdk 进依赖（设计：手写最小帧层，SDK 仅参照）；opus/MediaRecorder
  （实测不支持）；pcm 线性抽取回退（真机实测不需要）。
- **修改文件**：尚无。
- **测试及结果**：尚无。
- **已知问题**：正弦波 fixture 无识别文本——engine 集成测试的文本字段断言用 mock server 构造，
  真实语音验证留到增量 2 e2e/真机。
- **下一步唯一动作**：读 `tests/fixtures/asr/20260819T052830488Z-query-seedasr-duration-2b7d8bd5/transcript.jsonl`
  与主 fixture hex，写 `src/asr/doubao/protocol.ts` 的 golden bytes 单测（先红后绿）。
