<!-- delegate-outcome: succeeded -->
# 增量 4 独立代码审查（第 1 轮）

- 审查范围：`955a900eb67301020c65c5d3e34ceea82c50acfb..bea80ccb862662db1005dcdde67e34fc78990db0`
- 风险等级：`personal`
- verdict：`changes_requested`
- P1：0
- P2：2
- P3：2（其中 1 条接受进入 backlog）

## 本轮新证据

本轮在冻结 SHA 上逐文件审阅完整 diff，并读取了实际调用方（`onTap`、toolbar/drawer action wiring、keyboard controller、CSS 布局）。新增运行证据包括全量 Vitest、Biome、knip、Chromium Android E2E，以及 Pixel 5/Chromium 的真实触摸焦点与双行 toolbar 几何探针。

## Findings

### P2-1：× 关闭按钮在真实触摸序列结束后抢走终端焦点

- 位置：`src/drawer/drawer.ts:130-136`
- 违反契约：增量 4 目标 3 要求新增 × 点按关闭并保留既有关闭路径；项目明文约定 `AGENTS.md:150` 要求动作前记录键盘状态、动作后恢复焦点。新增按钮路径虽调用了 `conditionalFocus()`，但最终没有保住焦点，行为与 backdrop/handle 关闭路径不一致。
- 根因：`onTap` 的 touchend handler 内同步执行 `conditionalFocus()` 后，浏览器继续合成 mousedown；原生 `<button>` 随后获得焦点。关闭动画把 drawer 移出视口，但焦点仍留在 `#wt-drawer-close`。
- 真实证据：Pixel 5/Chromium 中，触摸 × 前 `document.activeElement` 是 `.xterm-helper-textarea`，触摸并等待关闭动画后变成 `BUTTON#wt-drawer-close`。
- 影响：用户用 × 关闭 drawer 后，软键盘/终端输入焦点会被新按钮路径意外改变；personal 档下不构成崩溃或静默错误，因此为 P2。
- 修复要求：让 × 的 touchend 路径抑制合成鼠标焦点（可复用本增量已经抽出的 `suppressSynthesisedMouse`），并用真实 touch `tap()` 回归测试锁定关闭后 textarea 仍为 active element。

### P2-2：d-pad 新增了只供测试读取的镜像状态和单实现接口

- 位置：`src/controls/dpad.ts:33-37,49-51,70-75`
- 违反要求：本卡熵增维度明确要求拦截“与现有状态镜像”和“无第二消费者的单实现接口”。
- 现状：`open` 与 `element.classList.contains('open')` 表示同一事实；`isOpen()` 只被 `tests/dpad.test.ts` 使用，生产调用方 `src/index.ts` 不读取它。私有 `Dpad` interface 也只有 `createDpad()` 这一个实现。
- 影响：同一显隐事实出现两个来源，且为测试增加了生产 API；当前不会触发 personal P1 红线，但属于明确的熵 +1，定为 P2。
- 修复要求：删除 `open`、`isOpen()` 和不再需要的私有单实现接口；`toggle()` 直接切换 class，测试只断言用户可观察的 class/可见状态。

### P3-1：backdrop 与 × 的关闭动作完整重复

- 位置：`src/drawer/drawer.ts:123-136`
- 违反要求：目标 3 要求两条点按关闭路径长期保持同一语义；当前两段 handler 分别复制键盘采样、震动、关闭与焦点恢复，形成两份事实源。该项也是 OCR 已登记待修项。
- 影响：当前主要是维护熵，未单独造成 personal 档红线后果，定为 P3。
- 建议：在修 P2-1 时合并为一个已有第二调用方的局部 handler；不要新增状态或配置。

### P3-2（接受进入 backlog）：自定义双行 toolbar 时 d-pad 覆盖第二行

- 位置：`styles/base.css:229-245`
- 违反契约：本增量新增的 `README.md:232-237` 明文称 d-pad 位于 toolbar 上方，同时继续支持用户配置 row2。当前 `bottom: 64px` 只按默认单行高度计算。
- 真实证据：Pixel 5/Chromium 中追加受支持的第二行后，toolbar 高 104px、d-pad bottom 为 663px、toolbar top 为 623px，垂直重叠 40px，右侧第二行按钮会被遮挡。
- 分级与处置：只影响非默认 row2 配置，d-pad 可立即关闭，故降为 P3。鉴于本卡为 `shrink-only` 且修复不应为 P3 引入新的布局状态/测量机制，本轮接受进入 backlog，不阻塞 verdict。

## 已验证通过的不变式

- `dpad-toggle` 已进入 `ButtonAction` union、Valibot variant 和默认 action registry；DI 优先级为 `context.toggleDpad ?? deps.toggleDpad`，缺失时 `console.error` 后抛错。
- 六键顺序/字节符合 spec，发送使用 `sendData(term, data)` / `term.input`。
- 六键均通过与 keyboard-toggle 共用的 `suppressSynthesisedMouse` 抑制合成鼠标；真实 Chromium 探针确认触摸前后 active element 均为 xterm textarea。
- d-pad 默认隐藏；按钮 48×48px；z-index 9999，低于 backdrop 10000、高于终端。
- 默认 toolbar row1 为 7 键且保留 ⏎；drawer 为 29 键并包含 ↑/↓ 兜底。
- × 位于 handle 右侧，触摸目标 44×44px；backdrop 和 handle swipe 代码仍在。
- 服务端、session、protocol 与 `CHANGELOG.md` 未改；未加入拖动、位置配置、清屏键，也未移走 toolbar ⏎。

## 验证记录

- `pnpm run check`：通过（109 files）。
- `pnpm run lint:knip`：通过。
- `pnpm exec vitest run --maxWorkers=1`：37 files / 492 tests 全通过。
- 默认并行 `pnpm test`：相关新增测试均通过；`tests/serve-abuse.test.ts` 两次在全量并行时超时，但单独运行及串行全量均通过，且本 diff 未改服务端，判为非本增量阻塞项。
- `pnpm run test:pw:chromium`：首跑 26/27，通过项覆盖现有触摸/键盘/客户端；唯一失败为 `page.goto` 超时，未进入断言。单独重跑该项通过（1/1）。
- 真实浏览器降层探针：d-pad 六键焦点安全通过；× 关闭焦点问题与双行重叠问题可稳定观察。

## 结论

核心 d-pad、默认按钮集合与 drawer × 的主体功能已实现，且没有 P1。合并前应修复 P2-1 的真实触摸焦点回归，并按熵增要求删除 P2-2 的镜像状态/单实现接口；因此本轮 verdict 为 `changes_requested`。
