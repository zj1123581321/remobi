<!-- delegate-outcome: succeeded -->

# R1 独立审查 verdict — iOS PWA 状态栏盖 Tab（PR #47 H0）

| 字段 | 值 |
|------|-----|
| 审查轮次 | R1 |
| 审查范围 | `f3227b20fbfd374ee2968b0334a78c43d2207630..96b34e6a7fe455692147607c424924425e5edcc4` |
| H0 HEAD | `96b34e6a7fe455692147607c424924425e5edcc4` |
| 审查者 | Cursor delegate（独立 reviewer，`card/pwa-safe-area-r1`） |
| 风险等级 | personal |
| OCR 前置 | `status=reviewed`（MiniMax-M3），`findings=[]`（参考，非证据） |

## 总评

**PASS** — 0 P1

## 本轮新证据

1. 对冻结 diff 的全量阅读（`styles/base.css` +27/-1、`tests/safe-area.test.ts` +23/-0）。
2. H0 提交树内 `#terminal-container` / `#terminal` 声明块与 `build.ts` HTML 骨架（`#terminal-container > #terminal`）对照。
3. `@xterm/addon-fit` 源码 `FitAddon.proposeDimensions()`：以 `.xterm` 的 `parentElement`（即 `#terminal`）的 computed `height`/`width` 为可用空间，再减去 `.xterm` 自身 padding（非 `#terminal-container` padding）。
4. `src/viewport/height.ts` 未在 diff 内改动；`bottomChromeHeight` 仍用 `toolbar.offsetHeight`（含 toolbar 自身 bottom inset padding）。

## Spec 正向对照（约束 1–5）

| # | 约束 | diff 落点 | 判定 |
|---|------|-----------|------|
| 1 | `#terminal-container` 仅加 `box-sizing: border-box` 与 top/left/right `env(safe-area-inset-*, 0px)` | `styles/base.css` 替换 `padding: 0` 为四条声明 | ✅ |
| 2 | 不加 `padding-bottom` safe-area | 块内无 `safe-area-inset-bottom`；toolbar 仍单独 `calc(6px + env(...bottom...))` | ✅ |
| 3 | 不用 `padding: 0` shorthand | 已拆为定向 `padding-top/left/right` | ✅ |
| 4 | `#terminal` 自身不加 safe-area padding | `#terminal { box-sizing; background }` 无 inset；测试锁死 | ✅ |
| 5 | 不改 `height.ts`、不改 `status-bar-style` | diff 仅上述两文件；`meta-tags.ts` 仍为 `black-translucent` | ✅ |

## 反向审查

### Safari 标签页（inset = 0）几何是否被改坏？

`env(safe-area-inset-*, 0px)` 在 Safari 非 standalone 下解析为 `0px`。相对 base：
- 垂直：`padding-top` 0 + 新增 `box-sizing: border-box` 在 padding 全 0 时与原先 `content-box` + `padding: 0` 等价（outer/content 高度均 100%）。
- 水平：`padding-left/right` 0，无宽度变化。
- 结论：Safari 标签页布局应与改前一致（符合用户目标中的「Safari 标签页布局与改前一致」）。

### FitAddon 是否会把 container padding 算进行数？

DOM：`#terminal-container`（padding 在此）→ `#terminal`（`height: 100%`）→ `.xterm`。

FitAddon 读的是 `#terminal`（`.xterm.parentElement`）的 computed height，不是 container 的 border-box。Container 的 `padding-top` 在 `border-box` 下缩小 content box，`#terminal` 的 `height: 100%` 相对该 content box，故行数基于「已扣除 top inset 后的高度」计算，**不会**把 container padding 二次计入 rows。

### 有无双计 bottom inset？

Container 无 bottom padding；viewport height manager 减 `toolbar.offsetHeight`（toolbar CSS 已含 bottom safe-area）。两条路径独立，无双计。

## 测试锁死度（spec 1–4）

`tests/safe-area.test.ts` 新增 3 条用例：

| 用例 | 锁死的 spec |
|------|-------------|
| `terminal container respects the top and side insets` | #1（border-box + 三边 inset） |
| `terminal container has no bottom inset or clearing shorthand` | #2、#3 |
| `#terminal itself carries no safe-area padding` | #4 |

主脑红验（卡面事实，本审查未复跑）：base CSS + 新测试应 2 红；H0 CSS 应 8/8 绿——说明断言非恒真。

未覆盖：spec #5（无 JS/meta 改动，diff 范围外可接受）。

## Findings

| ID | 严重度（本仓） | 违反 spec | 真实使用下会触发？ | 触发后果可接受？ | 工具标注 / 本仓判定 |
|----|----------------|-----------|-------------------|------------------|---------------------|
| — | — | — | — | — | **0 P1**；无 P2/P3 登记项 |

OCR `findings=[]` 与本仓判定一致；无工具意见需降级对照。

## 熵增审查

diff 无新增抽象、状态、配置项或包装层；仅 CSS 声明替换与契约测试。无熵增意见。

## 结论

H0 实现与 spec 1–5 一致；反向路径（Safari inset=0、FitAddon 计量、bottom 双计）未发现 personal 级 P1。建议合并路径继续（标 ready 后完整 gate 另论）。
