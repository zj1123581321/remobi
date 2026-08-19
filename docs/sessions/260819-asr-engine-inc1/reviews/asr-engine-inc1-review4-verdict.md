# ASR 增量 1 独立 Review 4 Verdict

- 审查对象：`c23d8e731e6a692f6184d40a46ae2c2770a663de..397e3d6664dbb3518e2272a072afc463fe8a898b`
- 新证据：`efa5bd7..397e3d6` 的 opened-WS `starting` close 修复及 stopping 拒绝路径测试；本轮首次以密钥流、CSP/config、跨文档契约和发布包为主视角。
- 风险等级：`internal`；失败路径/状态机按 infra 例外提档。
- Verdict：**pass with P2/backlog**；本轮新增 P1：**0**（internal+infra 收敛计数第 1 轮）。

前三轮已闭环的 binaryType、epoch/stop 串行化、MessagePort 背压、真帧 mock、JSON 畸形帧和
`starting` opened-WS close 不重复提报。

## 1. 密钥流逐跳审计

| 跳 | 处理 | 泄露判断与证据 |
|---|---|---|
| 配置文件 → CLI | 主配置和 `.local` 都先导入，再分别校验；`.local` 在 `cli.ts:132-145,194-212` 处理。 | 值只在进程内流转；校验失败由 `cli.ts:113-115` 抛路径错误，不打印原值。 |
| `defineConfig`/merge | `deepMerge` 在 `src/config.ts:311-339` 保留嵌套 `doubao`，CLI 合并后在 `cli.ts:209-212` 做 resolved 校验。 | 未发现日志或错误回显。`defineConfig` 本身是类型/合并 API，CLI 是运行时校验闸门。 |
| schema/validate | `asrApiKeyCheck` 在 `src/config-schema.ts:321-365` 检查 enabled 时的非空 key；`src/config-validate.ts:80-97` 对 `config.asr` 全子树使用 `redacted`。 | 通过；错误的嵌套、数组、父对象替换和 merge 后非法类型均未回显 key。 |
| `__remobiConfig` 内联 | `build.ts:50-83` 用 `JSON.stringify(config)` 写入全局变量；`build.ts:125-142` 只放行经过 `</script` 保护的脚本。 | key 会出现在浏览器 HTML/JS（C8 明确接受），但不是 sourcemap、构建日志或 dist 常量。 |
| 浏览器 JS → WebSocket | `src/asr/doubao/engine.ts:455-461` 用 `URLSearchParams` 编码 `api_key`/`api_resource_id`；`engine.ts:89-135` 只把 URL 交给浏览器 WS。 | 仅进入 provider 网络请求；应用没有打印完整 URL，WS error/close 只映射错误码。网络面板暴露属于锁定决策允许范围。 |
| 构建/发布输出 | worklet 由 `build.ts:86-109,173-175` 单独编译，不接收 config；H0 临时副本生成的 dist/source map 中没有 key 值。 | 未发现 key 进入 dist 注释、source map 或 tarball 固化物。 |

### redact 路径形态探针

以下探针只输出路径和 `received === 'redacted'`，不会打印探针 secret；均通过：

| 形态 | 实际路径 | 结果 |
|---|---|---|
| 叶子 `doubao.apiKey` 非字符串 | `config.asr.doubao.apiKey` | redacted |
| 父对象 `doubao` 被字符串替换 | `config.asr.doubao` | redacted |
| 父对象 `asr` 被字符串替换 | `config.asr` | redacted |
| enabled=true 缺失叶子 | `config.asr.doubao.apiKey` | redacted |
| merge 后 `doubao` 为非法类型 | `config.asr.doubao` | redacted |
| 数组/索引形态 | `config.asr.0` | redacted |
| 嵌套未知字段 | `config.asr.doubao.extra` | redacted |
| provider/启用字段的 union-like 错误路径 | `config.asr.provider` / `config.asr.enabled` | redacted |

### 新增 P2-1：ASR enabled HTML 没有显式禁止缓存

- 溯源 spec：设计 v5 安全条款（`docs/designs/asr-voice-input.md:156-161`）允许现有
  `__remobiConfig` 通道，但本轮任务要求检查 key 是否进入不该出现的持久化通道。
- 证据：`build.ts:58,82` 将 key 内联 HTML；`src/serve.ts:418-425` 的 HTML 路由没有
  `Cache-Control`，临时发布包冒烟对 `/` 的响应头也没有该字段；worklet 路由虽有
  `src/serve.ts:454-458` 的 `cache-control: no-cache`，不能覆盖包含 config 的 HTML。
- 触发与后果：真实启用 ASR 后，浏览器/反代可按默认缓存规则保留 HTML 响应，导致 key
  出现在 HTTP cache，而不只是当前 JS 内存。单人自部署模型下不是 P1，但属于可避免的
  持久化面；建议 HTML 至少使用 `Cache-Control: private, no-store`（或同等明确策略），
  并加启用 ASR 的响应头回归测试。

## 2. CSP / Permissions-Policy

`buildSecurityHeaders('127.0.0.1:7681', ..., 'nonce-123', false)` 的字节值为：

```text
content-security-policy: default-src 'self'; script-src 'self' 'nonce-nonce-123'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:7681 wss://127.0.0.1:7681; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
permissions-policy: camera=(), microphone=(), geolocation=()
```

enabled=true 的字节差异只有：

```text
connect-src 'self' ws://127.0.0.1:7681 wss://127.0.0.1:7681 wss://openspeech.bytedance.com
permissions-policy: camera=(), microphone=(self), geolocation=()
```

证据为 `src/serve.ts:151-172` 和 `tests/serve.test.ts:81-110`；临时 H0 发布包实际
请求 `/asr-worklet.js?v=1.2.1` 得到 `200 text/javascript`、`cache-control: no-cache`。

- provider 是单一精确 origin `wss://openspeech.bytedance.com`，没有 `*`、子域通配或
  `wss:` scheme 通配；enabled 只额外放开该 origin 和当前页面的 microphone。
- camera/geolocation 仍拒绝；worklet 路由仅在 `config.asr.enabled` 时注册
  （`src/serve.ts:306-309,450-464`），same-origin worklet 由 `script-src 'self'`
  覆盖，没有 `blob:` 或 `unsafe-inline`。
- disabled 时 provider origin 不在 CSP，worklet route 不存在；query 参数不会改变
  路由匹配或 CSP。

### 新增 P2-2：两态安全契约的测试不是字节级锁定

代码当前字节正确，但 `tests/serve.test.ts:100-110` 对 enabled CSP 只使用
`toContain('wss://openspeech.bytedance.com')`，disabled 只断言“不包含”该字符串，未锁定
完整 CSP、无通配 host-source、也未直接锁定 disabled/enabled worklet HTTP 语义。一个把
provider 改成 `wss://*.openspeech.bytedance.com` 或额外放开 `wss:` 的变更仍可能绿测。
建议按本轮表格加入 exact `toBe` 与 wildcard 排除，并覆盖两个 route 状态；当前实现本身不
升级为 P1。

## 3. 跨文档契约漂移

| 文档 A 的说法 | 实现/后续权威证据 | 滞后文档与处置 |
|---|---|---|
| 设计 v5 `:22-25` 仍写旧 `/api/v3/sauc/bigmodel`、header 鉴权；E7 `:238-240` 仍写 `appKey/accessKey` 与 `volc.bigasr.sauc.duration`。 | spike 结果 `docs/sessions/260819-1306-asr-spike-results.md:5,65-67`、inc1 卡 `docs/sessions/cards/asr-engine-inc1.md:29-34` 已裁决 `_async` + query `api_key/api_resource_id` + `volc.seedasr.sauc.duration`；代码为 `engine.ts:11,455-461`、`config.ts:285-291`。 | 设计 v5 滞后；更新设计的旧约束，而不是改代码回旧协议。 |
| spike 初始交接 `docs/sessions/260819-1244-asr-spike-inc0.md:22,30` 仍写双 key/旧 resource。 | 更新的 spike 结果和 inc1 卡已给出单 key/seedasr resource。 | 初始交接文档滞后；标 superseded 并指向结果文档。 |
| 设计 v5 E1 `:190-192` 与 inc1 卡 `:113-116` 要求 `asr-worklet.js?v={version}` 做 version busting。 | `engine.ts:12` 默认 URL 是无 query 的 `asr-worklet.js`；`serve.ts:451-458` 接受 query 但不生成/强制 version，只发 `no-cache`。 | 设计/卡片与实现漂移；若继续依赖 no-cache 就改文档明确该策略，否则把版本 URL 接线并测试。当前没有观察到实际旧包复用，列 P2/backlog。 |
| 设计 v5 错误路径 `:146-154` 要求按钮提示和结构化 console 事件。 | inc1 非目标明确不做 PTT UI；当前引擎只通过 `onError`（`engine.ts:674-704`）交付错误，没有 UI console 事件。 | 设计的整 feature 条款超出 inc1；更新为 inc2 责任或补充“引擎只提供 callback”的边界，不在本轮为 UI 增机制。 |
| fix1 I1-I6 要求 starting/stopping 异常 fail-loud、epoch 作废和合法空结果静默忽略。 | `engine.ts:325-342,468-555,674-741` 与新增测试 `tests/asr-engine.test.ts:713-784,867-995` 一致；本轮未发现漂移。 | 无需处置；前三轮 P1 闭环保持。 |

## 4. 发布链

H0 工作树本身没有 dist；直接 `pnpm pack --dry-run` 因此只列 README、样式、PWA 图标等
发布源文件，不能作为已构建包结论。随后在 H0 的临时 git archive 副本中运行：

```text
node_modules/.bin/tsdown
node_modules/.bin/tsx scripts/build-overlay.ts
pnpm pack --dry-run --reporter append-only
```

构建包清单包含：

```text
CHANGELOG.md LICENSE package.json README.md styles/base.css
src/pwa/icons/icon-180.png icon-192.png icon-512.png
dist/asr-worklet.js dist/client.css dist/client.iife.js
dist/cli.mjs dist/cli.d.mts
dist/build.mjs dist/build.d.mts
dist/src/index.mjs dist/src/index.d.mts
dist/src/config.mjs dist/src/config.d.mts
dist/src/types.mjs dist/src/types.d.mts
以及 tsdown 生成的各对应 .map、chunk mjs/map 文件
```

`package.json:22-28` 的 `files: ['dist/', ...]` 足以带入 `dist/asr-worklet.js`；pack
冒烟实际证明 worklet 路由可用。`dist/src/types.d.mts` 包含并导出
`AsrConfig`/`DoubaoAsrConfig`，Node 配置消费者可见 `apiKey`/`resourceId`；没有把
`AudioContext`、`AudioWorkletNode` 等浏览器运行时类型漏入配置类型。

### 新增 P2-3：发布产物没有 ASR 引擎公共/运行时入口

- 溯源 spec：设计模块布局 `docs/designs/asr-voice-input.md:172-183` 和本轮发布链完成
  条件；增量 1 的 `src/asr/types.ts`/`src/asr/doubao/engine.ts` 是本增量交付的引擎核心。
- 证据：`tsdown.config.ts:3-8` 的 entry 只有 `cli.ts`、`build.ts`、`src/index.ts`、
  `src/config.ts`、`src/types.ts`；`src/index.ts:31-47` 没有导出 `AsrEngine` 或
  `DoubaoEngine`。临时构建后 `dist` 只有 `asr-worklet.js`，搜索不到
  `DoubaoEngine`/`AsrEngine`/`api_resource_id`；`dist/src/types.d.mts` 只有 ASR 配置类型。
- 影响：从 npm tarball 不能导入本增量实现或 provider-independent engine 类型；若该核心
  设计为公共、可独立发布的增量，消费者会在发布边界丢失它。由于 PTT/UI 明确留给增量 2，
  这不是当前用户流程的 P1；处置二选一：增加明确的 `./asr` 公共入口并纳入 tsdown，或
  明确把 `src/asr` 标为 inc2 前的内部源码并把发布要求改成仅 worklet/config。

## 5. 验证记录与收敛

- `pnpm test`：41 files / 573 tests passed。
- `pnpm run check`：119 files，0 errors。
- `pnpm run lint:ox`：0 errors，6 warnings（其中 MessagePort `postMessage` 被规则误按
  Window targetOrigin 检查；无本轮阻断错误）。
- 自定义 redact 探针：叶子、父对象字符串、父树字符串、嵌套缺失、数组/索引、union-like
  provider/enabled、merge 后非法类型全部 `redacted=true`、`leak=false`。
- 临时发布包：worklet `200 text/javascript`；enabled CSP 精确 provider origin；根 HTML
  无 `Cache-Control`，见 P2-1。
- OCR 前置：正式 `ocr-review` 启动后在本地复核腿长期没有最终 JSON envelope；达到有界等待
  后终止，未取得 `reviewed`/`reviewed_fallback`/`skipped` 状态，未采纳任何 OCR finding，
  不将其表述为“已扫过”。

结论：本轮 0 新增 P1，以上 P2/文档漂移不阻断收敛；需下一轮或维护卡处理 P2-1/P2-3，
并同步清理旧设计文字与精确 CSP/cache 测试契约。
