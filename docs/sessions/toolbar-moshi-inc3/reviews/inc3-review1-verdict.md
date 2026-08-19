<!-- delegate-outcome: failed -->
# 增量 3 独立 review 第 1 轮 verdict

## Verdict

**fail**。冻结范围 `81cb468..dc5c736` 无 P1/P2；单行 toolbar、row1 逃生入口、横屏豁免、默认字号 13、drawer stay-open 主路径均符合规格。但字号持久化仍有 3 条待修 P3，另有 1 条违反反过度设计红线的 P3。修完并补对应测试后可复审。

审查范围与现场核对：分支 `card/remobi-20260818-03`，HEAD `dc5c736f3f112772d6f79d65b73692d6ff72cbbf`，6 commits，18 files，`+515/-252`；未发现禁止路径改动。

## P1

无。

## P2 / P3

### P2

无。

### P3-1：persisted 字号未按当前 `sizeRange` clamp

- 位置：`src/index.ts:52-68`
- 置信度：10/10
- Spec：任务卡目标“字号持久化”、任务清单 3“persisted > config”，以及 `font.sizeRange` 对字号有效范围的既有契约；降层检查点 ①明确要求覆盖坏值与超范围值。
- 触发路径：用户曾在较宽范围持久化 `30`，随后把配置收窄为 `[8, 20]`；或 localStorage 被写入 `0`、`100`、空字符串。刷新后 `Number(raw)` 对这些值返回 finite number（空字符串为 `0`），`applyTermAppearance` 直接赋给 xterm，越过当前配置范围。极端值可让终端文字不可用，并在每次刷新继续复现。
- 证据：`const size = Number(raw)` 后仅检查 `Number.isFinite(size)`；`term.options.fontSize = readPersistedFontSize() ?? config.font.mobileSizeDefault` 没有 clamp。现有 `tests/font-persistence.test.ts:60-86` 只覆盖 `20`、非数字字符串和读取异常，没有覆盖范围上下界或空字符串。
- 修复方向：读取后以当前 `config.font.sizeRange` clamp，再应用；补 lower/upper/empty-string 契约测试。无需新增机制。

### P3-2：pinch 改字号不会持久化

- 位置：`src/gestures/pinch.ts:56-66`，接线在 `src/index.ts:255-257`
- 置信度：10/10
- Spec：任务卡目标/背景“字号持久化、刷新后不丢失”，任务清单 3；主脑登记项要求核实。虽然 pinch 默认关闭，但 README 示例启用了它，是真实可配置路径。
- 触发路径：用户启用 `gestures.pinch.enabled`，双指缩放改变 `term.options.fontSize`；刷新后 init 只能读到旧的 drawer 缓存值或 config 默认值，刚才的字号丢失。
- 证据：`onPinchMove` 只执行 `term.options.fontSize = newSize` 和 `resizeTerm()`；`onTouchEnd` 只 `resetLock(lock)`，没有写 `remobi:fontSize`。当前持久化只存在于 `src/actions/registry.ts:90-95` 的 drawer action 路径。
- 修复方向：只在一次 pinch 手势结束且 lock 为 `pinch` 时持久化最终字号，避免 move 阶段高频写；沿用批准的窄 try/catch，失败 `console.error` 后继续。补“move 多次、touchend 只写一次”和写失败测试。

### P3-3：localStorage 键名在 producer / consumer 间重复字面量

- 位置：`src/actions/registry.ts:91`、`src/index.ts:54`
- 置信度：10/10
- Spec：锁定键名 `remobi:fontSize`；AGENTS.md 反过度设计红线允许已有第二调用方的共享抽象；跨边界 producer/consumer 契约必须锁死实际 payload。
- 触发路径：当前行为正确，但任一处后续改名都会变成“写成功、刷新读不到”的静默持久化失效。现有测试分别硬编码同一字符串，无法阻止生产两端同时漂移或单端漂移后的错误契约。
- 证据：读写两处均直接写 `'remobi:fontSize'`，已有两个生产调用方，满足共享常量的现实门槛。
- 修复方向：提取一个内部常量供读写及测试引用；若同时修 P3-2，则 pinch 成为第三个调用方。

### P3-4：`applyTermAppearance` 是无失败证据、无第二调用方的新 helper

- 位置：`src/index.ts:64-70`，唯一调用 `src/index.ts:165`
- 置信度：9/10
- Spec：AGENTS.md 反过度设计红线：“新增 helper 须有已发生失败或已存在第二调用方”。
- 触发路径：不造成运行时故障，但给一个仅 4 行、单调用点的顺序赋值增加命名层与跳转；本 diff 已超过机器预算 hard line，应优先收缩无依据抽象。
- 证据：全仓只有定义与单一调用。与之相对，`readPersistedFontSize` 的 helper 有 localStorage 读取异常这一已发生平台失败，保留是有依据的。
- 修复方向：把 theme/font 三行内联回 init，保留有失败边界的读取 helper。

## 降层检查点回答

### ① localStorage 失败与坏值

- absent：回退 `config.font.mobileSizeDefault`，正确。
- 非数字、`NaN`、`Infinity`：`Number.isFinite` 拒绝并回退，正确。
- 超 `sizeRange` 的 finite value、负数、空字符串：会直接应用，P3-1。
- 隐私模式读取失败：窄 try/catch，`console.error` 后回退默认，符合批准例外。
- 隐私模式写入失败：字号仍在本次会话生效，`console.error`，不静默，符合批准例外。
- 写入 payload：action 测试实际断言 `localStorage['remobi:fontSize'] === '16'`；但 pinch producer 缺失，见 P3-2。

### ② 横屏 CSS 选择器命中面

- `row2=[]`：DOM 只有一条 `.wt-row`，同时是 `:first-child` 与 `:last-child`，不满足 `:not(:first-child)`；整行不会消失。
- `row2` 非空且 row1 非空：第二条 row 同时满足 `:not(:first-child):last-child`；其非 ⌨ 按钮隐藏，`.wt-keyboard-toggle` 被排除并保持可达。
- row1 空、row2 非空：渲染器跳过空 row，唯一渲染行是 first+last，因此不隐藏；从 DOM 语义看它不是“真正第二行”，行为正确。
- 结论：`styles/base.css:487` 在两种主要 DOM 下命中面符合 F1/V2 与任务卡横屏规则。

### ③ drawer stay-open 与焦点语义

- `font-size` / `help` 仅跳过同步 `close()`；其他 action 仍在执行前关闭，原行为保留。
- `font-size` handler 仍调用 `context.focusIfNeeded()`，所以 `kbWasOpen` 的 `conditionalFocus` 语义未丢失；drawer 状态独立保持 open。
- `help` 原本就不调用 `focusIfNeeded`；现在 drawer 留在 z-index 10001 下方，help overlay 位于 10002，关闭 help 后仍可继续使用 drawer，符合规格。
- 未发现 drawer 连点引入的焦点回归。现有集成测试锁定 stay-open/close 分支；代码审查确认 conditionalFocus 接线未被旁路。

## 熵增结论

- 必要熵：新增 localStorage 状态是规格本身；`readPersistedFontSize` 封装了已发生的 iOS 异常边界，合理。
- 无必要熵：`applyTermAppearance` 单调用 helper 为熵 `+1`，见 P3-4。
- 降熵机会：共享 storage key 有真实第二调用方，应提常量；修 pinch 后调用方更多，见 P3-3。
- `keepsDrawerOpen` 保持局部、显式的两类判定是合适的；不应按 OCR L2 配置化，否则无第二调用方、属于 speculative generality。
- 预算：机器合同记录 `767 > hard 260`、`shrink-only`，而任务卡正文 hard 为 900。冻结 diff 没有范围漂移，但这两个预算口径冲突需主脑归档；本轮不以其单独升级代码严重度。

## OCR 预扫核实

- M6/L3：有效，合并为 P3-1。
- L0：有效，列为 P3-3。
- L1、L4/L5、L7、L8：未发现可升级为 P1/P2 的用户故障，接受“不修”。位置型 CSS 在当前固定两行 schema 下命中正确。
- L2：否决正确；当前实现没有引入配置谓词。

## 验证

为保持冻结 worktree 零污染，在 `dc5c736` 的临时归档副本执行：

- `pnpm test`：35 files、472 tests 全通过。
- `pnpm run check`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm run build:dist`：通过。
- `pnpm run lint:knip`：通过。
- `pnpm run lint:publint`：通过。
- `pnpm run lint:ox`：0 errors；1 条 `src/actions/registry.ts:167` 既有 warning，不在本 diff 新增行。
- `pnpm run test:pw`：Chromium 27 项中 25 通过；2 项因宿主网络 `ERR_NETWORK_CHANGED` 失败。单进程复验后 proxy 用例通过，smoke 的“零 console error”仍只收到同一网络错误。WebKit 因宿主缺 GTK/GStreamer 依赖无法启动。与本增量直接相关的 Chromium `tests/playwright/keyboard-toggle.spec.ts` 单跑 5/5 通过。

## Backlog（范围外，不阻塞本 verdict）

- `src/toolbar/buttons.ts:3-6` 的存量 re-export 注释仍描述旧两行布局；本 diff 未修改该文件，但新默认值使注释失真。后续文档清理时同步为单行/空 row2。
- `src/gestures/pinch.ts:69-74` 的既有 DOM attach 轮询使用无边界 `setTimeout` 重试，违反当前 AGENTS.md 的新红线，但不是 `81cb468..dc5c736` 引入，单列 backlog。
- Playwright WebKit 宿主依赖缺失与 Chromium 外部网络波动属于验证环境问题；合入前应在具备依赖且网络稳定的 CI/真实消费环境补跑完整浏览器矩阵。
