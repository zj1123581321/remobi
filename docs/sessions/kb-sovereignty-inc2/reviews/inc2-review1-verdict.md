<!-- delegate-outcome: succeeded -->
# 增量 2 键盘主权独立审查第 1 轮

## Verdict

**fail**。没有发现 P1，但发现 4 条 P2，均与 spec 明确的不变式或真实移动端手势路径冲突；本轮不能按 pass 收敛。实现代码、测试代码均未修改。

审查范围严格为 `e8b9ba6..a242992`，9 个 commit、17 个文件、987 insertions / 24 deletions。依据：`docs/designs/keyboard-sovereignty.md` 的增量 2/T-A/T-B/T-E/V1/V2/V3/V6、主仓 spike 结论、仓规与本范围 diff。

## P1 findings

无。

按 internal + 状态机的 P1 两问过滤：默认手机浏览器路径中，manual 锁定/解锁没有观察到数据丢失、越权、崩溃或静默 PTY 输入错误；按钮、paste、`mobile.initData` 都通过 `sendData()` → `term.input(data, true)` 绕过 textarea，这与 spec 允许的远端控制路径一致。以下问题是状态错误、键盘不可达或生命周期泄漏，最高 P2，未提档为 P1。

## P2 findings

### P2-1：controller 未纳入 init dispose，重复 init 泄漏两组事件监听

- **位置**：`src/index.ts:110-125`；`src/controls/keyboard-controller.ts:66-81,134-137`。
- **违反条款/不变式**：T-E#4 的“单一 controller + 订阅”；`onFocusChange()` 返回了明确的 disposer，controller 也提供 `dispose()`，但 init 的生命周期没有消费它。
- **触发路径**：同一页面调用两次 `init()`，或嵌入消费者在同页重新初始化 overlay。每次 `createKeyboardController()` 都给同一个 `visualViewport` 加 `resize` listener，并给 xterm textarea 加 focus/blur listener；`pagehide`/`beforeunload` 的 `dispose()` 只清理 resize scheduler、reconnect 和 hook disposer，不清理 `keyboard`。
- **证据**：`src/index.ts:155` 创建 controller，但 `dispose()` 闭包在 `src/index.ts:110-117` 中没有捕获或调用它；`src/controls/keyboard-controller.ts:135-136` 的清理逻辑因此不可达。页面卸载本身不显现问题，但同页重复 init 会保留旧 controller、旧订阅和旧按钮行为，造成状态镜像与资源泄漏。
- **最小复现/推理**：在移动 DOM 环境先 `init(config)`，再再次 `init(config)`；随后改变 `visualViewport.height` 或 focus textarea。两个 controller 都收到事件，旧 toolbar 仍保留自己的订阅。最小修复是把 `keyboard.dispose()` 纳入现有 `dispose()` 闭包，不需要新机制。
- **置信度**：10/10。

### P2-2：auto 迁移直接读取 keyboardVisible，违反“视口只驱动指示器”

- **位置**：`src/controls/keyboard-controller.ts:98-105`，尤其 `:100`。
- **违反条款/不变式**：T-B 明确规定 `keyboardVisible` 只驱动指示器、不参与任何迁移；spike 结论也把 `innerHeight - visualViewport.height > 150` 定位为指示器信号。V1 只要求 auto 的 ⌨ 是 focus/blur 瞬时控制。
- **触发路径**：auto 模式下系统键盘收起、弹起或 viewport resize 与 textarea focus/blur 事件不同步时，`keyboardVisible` 仍是旧值；toggle 用 `keyboardVisible || textareaFocused` 决定 blur/focus。于是视口信号参与了迁移选择，而不是只更新 indicator。
- **证据**：`src/controls/keyboard-controller.ts:74-79` 只在 `visualViewport.resize` 到达时更新 `keyboardVisible`，而 `:100` 用它选择 `term.blur()`；`textareaFocused` 则由 `:66-71` 的 DOM 事件更新。两者事件顺序并无同一时序保证。
- **最小复现/推理**：初始化 auto controller，保持 `textareaFocused=false`，让键盘/viewport 进入 open 状态但暂不派发 resize，再点 ⌨；controller 读取旧 `keyboardVisible` 并走 blur 分支。反向地，viewport 已恢复但 focus 信号仍为 true 也会进入 blur。此行为不仅有读旧值窗口，也直接违背 T-B 的信号职责划分。
- **置信度**：9/10。

### P2-3：escape hatch 接受 drawer/floating 的唯一 ⌨，但 touchend 竞态修复只覆盖 toolbar

- **位置**：`src/controls/keyboard-controller.ts:142-160`；`src/toolbar/toolbar.ts:179-186`；`src/drawer/drawer.ts:46-50`；`src/controls/floating-buttons.ts:24-29`。
- **违反条款/不变式**：V2 规定 manual 的键盘入口必须可用；spike 探针③/解锁时序要求清除抑制属性后在用户手势内 focus，且 `touchend` 后不能让合成 mousedown 抢走焦点。统一 ControlButton/action schema 允许同一 action 出现在 toolbar、drawer、floating。
- **触发路径**：配置移除 toolbar 的 ⌨，把 `keyboard-toggle` 放入 drawer 或 floatingButtons。`allButtons()` 会将其判定为“已有入口”，但只有 toolbar 的 `buildRow()` 添加 `touchend` `preventDefault()`。drawer/floating 仍走普通 `onTap()`：touchend 内 controller 先清掉 `inputmode` 并 `term.focus()`，随后浏览器合成 mousedown 把焦点移到按钮，键盘不弹。
- **证据**：`src/controls/keyboard-controller.ts:160` 明确把 drawer/floating 中的 action 当作覆盖；`src/toolbar/toolbar.ts:179-186` 是唯一的键盘专用 touchend listener；`src/util/tap.ts:6-11,33-50` 记录并实现了 touchend 后合成 click/mouse 事件；spike 结论要求“清属性后用户手势内 focus()”。
- **最小复现/推理**：`mobile.keyboardMode='manual'`，`toolbar.row2=[]`，toolbar 保留 `drawer-toggle`，`drawer.buttons=[keyboardToggleButton]`。打开 drawer 后用真实触摸点 ⌨：permission 已翻为 true，但 textarea 最终失焦、viewport 不开键盘；再次点会把 permission 翻回 false。floating-only 配置同理。
- **附带可观察后果**：drawer/floating 也没有 `wt-keyboard-toggle` class，因此 `src/toolbar/toolbar.ts:243-250` 不会同步 indicator，`reportKeyboardUnavailable()` 的 `:210-212` 也不会给这些按钮加错误态。
- **置信度**：9/10。

### P2-4：escape hatch 用“存在于全集”代替“真实可达”，drawer-toggle 被删时可永久锁死

- **位置**：`src/controls/keyboard-controller.ts:142-169`。
- **违反条款/不变式**：V2 的逃生入口语义是“manual 下始终有可达 ⌨”；设计说明强调 toolbar 保证渲染，drawer 可被替换且 `drawer-toggle` 可删。仅检查 action 是否存在不能证明入口可达。
- **触发路径**：用户配置 `mobile.keyboardMode='manual'`、`toolbar.row1=[]`、`toolbar.row2=[]`、`drawer.buttons=[keyboardToggleButton]`、`floatingButtons=[]`。`allButtons()` 找到 drawer 中的 action，于是 `withKeyboardEscapeHatch()` 原样返回；toolbar 没有 toggle，也没有 drawer-toggle，隐藏 drawer 无任何打开路径。
- **证据**：`src/controls/keyboard-controller.ts:160-161` 只按 action type 返回 config；`src/drawer/drawer.ts:94-104` 的 drawer 初态是隐藏的，只有 `open()` 被调用才显示；`src/index.ts:163-171` 虽然创建 drawer，但没有为不可达 drawer 自动建立入口。
- **最小复现/推理**：使用上面的最小配置，manual controller 在 `src/controls/keyboard-controller.ts:83-86` 初始锁定，且全屏没有可操作的 ⌨。用户只能改配置或重新加载，不能在当前页面恢复输入权限。
- **置信度**：9/10。

## P2/P3 可接受项与降级意见

- **P3，机制不可用时 overlay 时序**：`reportKeyboardUnavailable()` 在 toolbar/hook await 之后的 `src/index.ts:179-193` 执行。无自定义异步 hook 时只是同步任务末尾的微任务窗口；点击后的 throw 会被 `src/toolbar/toolbar.ts:149-153` 捕获并设置 `wt-action-error`，没有静默失败。自定义 hook 长时间 await 时存在延迟，但不提档 P1。
- **P3，auto 缺 blur 的判定**：`src/controls/keyboard-controller.ts:48-51` 将 auto 的可用性定义为存在 `term.blur()`。对于当前 client bridge，`src/client-entry.ts:88-93` 确实提供它；对旧的嵌入式 XTerminal，缺 blur 会显示 fail-loud overlay，影响兼容性但不会静默退回 auto。错误文本把 auto 的 momentary blur 也概括成 soft-keyboard suppression，属诊断文案问题。
- **P3，bridge throw 路径**：`src/client-entry.ts:94-112` 在 textarea 不存在时 throw；controller 的 availability 只检查函数类型（`src/controls/keyboard-controller.ts:48-51,66-71`），若方法存在但执行时发现 textarea 缺失，可能在 `reportKeyboardUnavailable()` 前直接进入 init catch，只有 console.error，没有用户 overlay。正常 client-entry 在 `term.open()` 后才创建 bridge，且本次 Chromium 键盘契约 5/5 通过；保留为嵌入消费者 backlog。
- **P3，CSS 兼容性**：`.wt-row { justify-content: safe center; }`（`styles/base.css:58-63`）在不认识 `safe` 的旧浏览器会丢弃该 declaration，通常退回 flex 的默认左对齐。row2 的 `overflow-x:auto`、`min-width:44px` 与 `flex:1 0 auto` 仍保证可横滑和触达，因此是视觉降级，不是 keyboard sovereignty 语义故障。横屏选择器 `button:not(.wt-keyboard-toggle)` 正确保留 row2 中的 toggle；其仅作用于 row2，符合本 diff 的默认布局。
- **P3，touchend 无障碍副作用**：toolbar 专用 listener 在 `onTap` listener 之前注册，仍会执行 touchend handler；桌面点击/键盘激活走 click，保留工作路径。`preventDefault()` 只取消合成 mouse/click，不构成当前可确认的无障碍回归。

## 降层三问

### ① 键盘从锁到开的不可逆/可观察动作与中途失败

manual 解锁顺序为：`permission = !permission`（`keyboard-controller.ts:108`）→ `setKeyboardSuppressed(false)` 清掉 `inputmode`（client bridge `:104-106`）→ `term.focus()`（controller `:112`）→ `notify()`（`:117`，indicator 才同步亮）。解锁路径没有 blur；锁定路径则由 bridge 先 `textarea.blur()` 再设置 `inputmode="none"`（`client-entry.ts:99-103`）。因此开锁完成前，`inputmode` 已被改、focus 已发起，系统键盘可能异步弹起；indicator 在最后才亮。

若 `setKeyboardSuppressed(false)` 或 `term.focus()` 中途 throw，permission 已经是 true，可能出现“输入已许可但键盘没有打开”，且本次 `notify()` 不执行；toolbar catch 只会把按钮标为 error，不回滚 controller。正常 bridge 的 textarea 在 `term.open()` 后存在，故这不是默认路径 P1；但它解释了上面的 bridge throw P3，以及为何 availability 不能只做函数类型检查。

### ② 三个守卫值是否存在读旧值窗口

有。`textareaFocus` 来自 DOM focus/blur listener，通常同步更新；`keyboardVisible` 依赖之后到达的 `visualViewport.resize`。manual 的 permission 不由后两者改写，所以“系统手势收键盘 permission 不变”成立。可是当前 auto toggle 在 `:100` 读取 `keyboardVisible` 参与选择 blur/focus，故事件重排窗口会影响迁移，形成 P2-2。它本应只用于 `indicatorOn()`（`:124`），不能成为迁移守卫。

### ③ 保护的是状态写入还是用户可感知行为

两层都有，但覆盖边界不同。manual 锁定通过 `inputmode="none"` 保护 xterm textarea 的软键盘入口；`sendData()`（`src/util/terminal.ts:4-6`）、paste 的 raw send、`mobile-init` 都走 `term.input()`，不经过 textarea，这是 spec 明确允许的按钮/远端控制路径，不与锁定语义矛盾。反过来，P2-3 证明状态写入（permission 已翻转）不等于用户可感知行为（键盘确实弹出）：drawer/floating 的 ⌨ 没有 touchend 防护，解锁后焦点可能被抢回。

## 熵增审查

| 新增项 | 熵判断 | 结论 |
|---|---|---|
| `src/controls/keyboard-controller.ts` 的 controller、三信号、订阅 | 不是无谓通用化；index 负责迁移，toolbar 负责 indicator，registry 负责 action，已有多个消费者 | T-B/T-E#4 必要，但生命周期必须补齐（P2-1） |
| `KeyboardMode`、schema/default/config/CLI 文档 | 同一配置被 schema、merge 后运行时、文档和测试消费 | 熵可接受 |
| `XTerminal` 的 `blur`/`setKeyboardSuppressed`/`onFocusChange` | bridge 与 controller 是两个实际调用方，且 onFocusChange 有真实 disposer 契约 | 熵可接受；availability 仍过浅（P3） |
| `toggleKeyboard` DI | action registry 与 init wiring 形成实际调用链，避免 registry 直接碰 DOM | 熵可接受 |
| `allButtons()` 私有 helper | 只有 `withKeyboardEscapeHatch()` 一个调用方，是本 diff 最明显的抽象 +1；但它集中表达“解析后全集”判定并被测试锁死，复杂度有限 | 可接受但不要继续抽象；当前判定仍有可达性缺陷（P2-4） |
| `wt-keyboard-toggle`/`wt-kb-active` CSS 状态 | 不是状态镜像本身，属于用户可见 indicator/error 契约；实现只在 toolbar 接线 | 不能扩成新的通用 button 基类；修现有三个 renderer 的覆盖即可 |

未发现 fallback、重试或防御式吞错等新增熵；controller 的三信号不是重复镜像，而是 spec 明确要求的状态分解。

## Backlog

1. P2-1：把 `keyboard.dispose()` 接入现有 `init()` dispose 闭包，并补同页重复 init 的 listener 契约测试。
2. P2-2：auto 的迁移决策改为只依赖 focus 语义，viewport 差值只更新 indicator；补事件乱序测试。
3. P2-3：将 keyboard-toggle 的 touchend 防护、class/indicator/error wiring 覆盖 drawer/floating，或收敛入口位置后同步调整 escape-hatch 判定。
4. P2-4：escape hatch 检查真实可达路径；若 drawer 中的 ⌨ 没有可达 drawer-toggle，仍应注入 toolbar row2。
5. P3 bridge throw/auto blur：为嵌入式 XTerminal 写明能力契约，或在 controller 创建时做一次可见性/textarea 级 fail-loud 探针，但不要引入运行时 inputmode fallback，遵守 V3。
6. P3 CSS fallback：若要保留旧浏览器居中视觉，先写普通 `justify-content: center` 再写 `safe center`；不影响本轮 keyboard 语义。
7. Spike 已知盲区：iOS Safari、IME 组合态、iPad 实体键盘仍需真机闸门；不能由本次 happy-dom/Chromium 契约测试替代。

## 验证记录

- `pnpm test`：通过，34 files / 463 tests。
- `pnpm run check`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm exec playwright test tests/playwright/keyboard-toggle.spec.ts --project=chromium-android`：通过，5/5。
- `pnpm run test:pw`：Chromium 26 项通过，1 项既有 multi-client 导航超时；WebKit 28 项因本机缺少 GTK 等系统库失败，符合任务卡已知限制。单独 Chromium 重跑为 25/27，通过的键盘契约仍完整；剩余 2 项是既有 multi-client/mouse-encoding 资源超时。
- `pnpm run build:dist`：未运行。该命令会写入 `dist/`，与本卡“唯一允许写入 verdict/报告文件”冲突。

