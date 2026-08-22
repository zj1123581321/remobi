<!-- delegate-outcome: succeeded -->

# R1 独立审查 verdict — 软键盘遮挡 + 终端 resize 卡顿（PR #48 H0）

| 字段 | 值 |
|------|-----|
| 审查轮次 | R1 |
| 审查范围 | `dbd12e0..9c8b781` |
| H0 HEAD | `9c8b7812b0779891492914c670b556cb478ca673` |
| 审查者 | Codex delegate（独立 reviewer，`card/herdweb-20260823-09`） |
| 风险等级 | personal（P1 红线 = 数据丢失、静默出错、崩溃） |
| OCR 前置 | `status=reviewed`（minimax profile），5 条 findings（见对照表） |

## 总评

**PASS** — 0 P1

diff 在静态审查与自动化测试下满足 spec 六条不变式；OCR 五条经核实后无 P1。有两条 P3 可接受风险记入 backlog（`isKeyboardOpen` 副作用语义、防抖定时器无 teardown），不阻塞合并。

## 本轮新证据

1. 冻结 diff 全量阅读（9 文件，+277/-48）：`build.ts`、`client-entry.ts`、`keyboard.ts`、`height.ts`、`landscape.ts`、`base.css`、测试与 AGENTS.md。
2. H0 提交树执行 `pnpm test`：49 files / 812 tests 全绿。
3. H0 提交树执行 `pnpm run check`：189 条 biome 诊断均不在本次 diff 触及文件内（存量问题，见 backlog）。
4. 红验复跑：将 H0 版 `tests/height.test.ts` + `tests/keyboard.test.ts` 拷入 base `dbd12e0` 源码，vitest 17 failed / 25 — 新增断言非恒真。
5. `src/index.ts` overlay `dispose()` 与 `initHeightManager` 返回值对照：高度管理器监听与 teardown 归属确认（OCR #2/#3 核实输入）。

## Spec 不变式逐条判定

| # | 不变式 | 判定 | 依据 |
|---|--------|------|------|
| 1 | 键盘弹出时底部 chrome 位于键盘上沿之上；终端/toolbar/键盘不重叠 | **成立** | `keyboardInsetPx` 写入 `--kb-inset`（`height.ts:97-100`）；`base.css` 中 `#wt-toolbar`、`#wt-asr-composer`、`#wt-drawer`、`#wt-dpad`、`.wt-floating-bottom-*` 均叠 `--kb-inset`；`bottomChromeHeight` 不再在键盘开时返回 0，终端高度始终扣可见 chrome（`height.ts:34-40`）。 |
| 2 | 键盘动画期间零 xterm reflow；落定后恰好一次 fit + 一次 WS resize | **成立**（viewport 路径） | `client-entry.ts` 移除 `resize`/`visualViewport.resize` → `syncSize` 裸订阅；`height.ts` 用 `TERM_RESIZE_DEBOUNCE_MS=150` 防抖 `resizeTerm()`，且仅 `h !== lastLockedHeight` 时 schedule（`height.ts:74-107`）。`initHeightManager` 集成测试模拟 5 帧动画仅触发 1 次额外 resize。`startup-resize`、`font-size`（`actions/registry.ts`）、`pinch`（`gestures/pinch.ts`）仍直调 `resizeTerm`，未改。 |
| 3 | 键盘检测平台无关（resizes-content 与 iOS visualViewport） | **成立**（单元测试覆盖；真机动画时序见下方验证点） | `build.ts` 增加 `interactive-widget=resizes-content`；`isKeyboardOpen` 用 `maxObservedViewportHeight` 基线（`keyboard.ts:14-22`）；`resetKeyboardHeightBaseline` 在 `orientationchange` 调用（`height.ts:121-123`）；`keyboard.test.ts` 覆盖 resizes-content 同缩与 baseline 重置。 |
| 4 | resize 链路单一入口：`height.ts` 订阅 viewport/resize 驱动终端 resize；`client-entry` 不得裸订阅 | **成立** | `client-entry.ts:820-821` 仅注释说明；viewport 监听集中在 `height.ts:116-120`。`keyboard-controller.ts:111` 的 `visualViewport.resize` 只更新指示器状态，不调 `resizeTerm`，不违反不变式。 |
| 5 | `updateHeight` 先读后写，无强制同步布局 | **成立** | `toolbar.offsetHeight` / `composer.element.offsetHeight` / `isKeyboardOpen` 均在 `lockDocumentHeight` 与 `--kb-inset` 写入之前读取（`height.ts:86-100`）；`checkLandscapeKeyboard` 仅写 class，且置于读之后。 |
| 6 | `--kb-inset = max(0, innerHeight - vv.height - vv.offsetTop)` | **成立** | `keyboardInsetPx`（`height.ts:48-54`）与测试 `keyboardInsetPx` describe 三条用例锁死 resizes-content→0、iOS 掩膜、非负。 |

### 真机验证点（无法静态判定，不计 fail）

- iOS Safari / Android Chrome 实机软键盘开闭动画期间底部 chrome 与终端是否像素级无重叠。
- `interactive-widget=resizes-content` 在 Android Chrome &lt;108 或部分 WebView 上的降级行为（无该 meta 时靠 `--kb-inset` 兜底，但需目视确认）。
- 地址栏收起/展开导致 viewport 高度变化 &gt;150px 时 `isKeyboardOpen` 是否误报（见 backlog F-01）。

## OCR 五条对照表

| # | OCR 摘要 | 工具标注 | 核实 | 真实使用下会触发？ | 触发后果可接受？ | 本仓最终级别 |
|---|----------|----------|------|-------------------|------------------|--------------|
| 1 | `isKeyboardOpen` 由纯谓词变为每次写 `maxObservedViewportHeight`，~15 调用点语义变 | medium / maintainability | **成立** — `keyboard.ts:20` 每次调用更新基线 | 偶发：地址栏大幅收起、首帧即键盘已开（autofocus） | 是（personal）：短暂误判键盘状态，下一帧 viewport 事件或用户操作可恢复 | **P3** backlog F-01 |
| 2 | `client-entry` `dispose()` 不再清理 resize 监听 | low | **不成立** — diff 移除的是已删除的 `addEventListener` 对应清理；viewport resize 归属 `height.ts` | — | — | **无效**（OCR refuted） |
| 3 | `termResizeTimer` 无 teardown，dispose/HMR 后可能 stale resize | high / bug | **部分成立** — `initHeightManager` 不返回 dispose、不 `clearTimeout`（`height.ts:71-79`）；但 overlay `dispose()`（`index.ts:149-158`）历来也未清理 height manager 监听 | 页面 `pagehide`/卸载时 pending timer 触发 | 是：`resizeTerm` → `__herdwebResize` 在卸载上下文单次空操作，无数据丢失 | **P3** backlog F-02 |
| 4 | `scheduleTermResize` 仅在 `h` 变化时 schedule，动画起止同高则跳过 refit | medium | **不成立** — 若锁定高度字符串不变，布局本就未变，跳过 refit 正确；动画中间帧 `h` 变化会多次 schedule 并由防抖合并为一次落定 resize | — | — | **无效**（OCR refuted） |
| 5 | `pendingResize` 命名不再贴切 | low | **成立** 但无行为影响 | — | — | **无效**（命名 nit，不进 findings） |

## Findings（本仓判定）

| ID | 级别 | 位置 | 违反 spec / 不变式 | 说明 |
|----|------|------|---------------------|------|
| — | — | — | — | **0 P1** |

### P3 backlog（接受不修，不阻塞合并）

| ID | 位置 | 说明 |
|----|------|------|
| F-01 | `src/util/keyboard.ts:14-22` | `isKeyboardOpen` 带副作用的模块级基线：调用顺序影响判定；地址栏 &gt;150px 变化或极早 autofocus 可能短暂误判。建议真机观察；若频发可在 `visualViewport` 专用路径与 `kbWasOpen` 快照路径分拆。 |
| F-02 | `src/viewport/height.ts:71-79` | `termResizeTimer` 无 `clearTimeout`；与存量「`initHeightManager` 无 dispose」叠加。卸载时无害；若未来支持 overlay 热重载应一并补 teardown。 |

## 熵增审查

| 新增项 | 第二消费者 / 必要性 | 判定 |
|--------|---------------------|------|
| `keyboardInsetPx` | `initHeightManager` + 单元测试 | 合理，公式需可测 |
| `resetKeyboardHeightBaseline` | `height.ts` orientationchange + 测试 | 合理，配对副作用基线 |
| `TERM_RESIZE_DEBOUNCE_MS` 导出 | 测试锁死防抖窗口 | 可接受 |
| `maxObservedViewportHeight` 模块状态 | `isKeyboardOpen` 全调用点 | 为不变式 #3 必要，但副作用语义见 F-01 |

无单实现接口、无转发-only 层；熵增在可接受范围。

## 测试锁死度

| 测试 | 锁死的不变式 / 行为 |
|------|---------------------|
| `keyboard.test.ts` resizes-content 用例 | #3 |
| `keyboard.test.ts` resetKeyboardHeightBaseline | #3 orientation 配对 |
| `height.test.ts` keyboardInsetPx | #6 |
| `height.test.ts` initHeightManager --kb-inset 写入 | #1、#6 |
| `height.test.ts` 键盘开时扣 chrome | #1 |
| `height.test.ts` 防抖 burst → 2 次 resize | #2 |

红验：base 源码 + H0 测试 → 17 红，确认非恒真。

## Backlog（存量，非本次 diff）

- `pnpm run check` 在 H0 树报告 189 条 biome 诊断，均不在 diff 文件内；CI 若全绿则可能与本地配置差异，需另卡处理。
- `initHeightManager` 返回 `scheduleResize` 而非 dispose handle；`index.ts` overlay dispose 从未移除 vv/window 监听（改前即存在）。
- `keyboard-controller.ts` 与 `height.ts` 各订阅 `visualViewport.resize`（职责分离：指示器 vs 布局），长期可合并订阅但非本 diff 范围。

## 验证命令

```text
# H0 提交树（/home/zlx/projects/oss/herdweb @ 9c8b781）
pnpm test          → 49 files, 812 passed
pnpm run check     → 189 errors, 0 in diff files
# 红验（base 源码 + H0 测试）
vitest run tests/height.test.ts tests/keyboard.test.ts → 17 failed / 25
```

## 结论

H0 实现与 spec 六条不变式一致；viewport 驱动终端 resize 的防抖与 `--kb-inset` 抬升方案在代码与单元测试层面可验证。0 P1；OCR 高风险项 #3 经 P1 两问降级为 P3。建议 PR #48 继续合并路径（标 ready 后完整 gate 另论）。
