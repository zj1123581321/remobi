# 任务卡：键盘主权增量 2 —— 独立 review 第 1 轮（全量审）

## 任务一句话

对 remobi 仓库中一个已完成的特性 diff 做独立代码审查，产出 verdict 文件。你不改任何实现代码——**唯一允许的写入**是 verdict 产出文件。

## 审查对象（H0 冻结）

- 仓库：`/home/zlx/projects/oss/remobi-worktrees/remobi-20260818-02`（分支 `card/remobi-20260818-02`）
- diff 范围：**`e8b9ba6..a242992`**（9 个 commit，987 insertions / 24 deletions，17 文件）。只审这个范围；范围外的存量问题记 backlog 节，不计 finding。
- 用 `git diff e8b9ba6..a242992` 与 `git log e8b9ba6..a242992` 取审查对象。

## Spec（必读，finding 必须溯源到 spec 条款）

1. `docs/designs/keyboard-sovereignty.md`（worktree 内，git 跟踪）——「增量 2」节 + Scope Decisions 表（T-A/T-B/T-E/V1/V2/V3/V6）。
2. spike 定案：`/home/zlx/projects/oss/remobi/docs/sessions/260818-kb-spike-results.md`（主仓绝对路径，不在本 worktree）。关键结论：机制 `inputmode="none"`；锁定必须先 blur() 再设属性；解锁清属性后用户手势内 focus()；键盘可见性 = `innerHeight - visualViewport.height > 150` 只驱动指示器。
3. 仓规：`AGENTS.md`（conventions 节）与全局反过度设计红线：禁 fallback/重试/防御式 try-catch；新抽象须有第二个调用方或已发生的失败。

## 风险等级与审查纪律

- 项目风险等级：**internal**；diff 核心含状态机（三信号模型）→ 收敛条件提档：按 saas 对待。
- P1 红线（internal + 状态机语境）：数据丢失、静默出错（结果错但不报错）、崩溃、越权访问。两问过滤：该缺陷在本项目真实使用方式（手机浏览器覆盖层，单用户自用）下会被触发吗？触发了后果可接受吗？
- 每条 finding 注明「违反 spec 哪条/哪个不变式」；无法溯源到 spec 的意见默认降一级。
- **熵增审查（必含维度）**：对 diff 中每个新增的抽象/文件/状态/配置项问「这是不是熵 +1」（单实现接口、转发-only 层、与现有状态镜像、无第二消费者的通用化）。
- **降层三问（必答，写进 verdict）**：①键盘从「锁」到「开」的状态迁移完成之前，已发生哪些不可逆/可观察动作（blur 已弹键盘、inputmode 已改、指示器已亮）？中途失败会怎样？②controller 的守卫值（permission/focus/visible 三信号）在真实浏览器事件序列下是否存在读旧值的窗口？③保护覆盖的是「状态写入」还是「用户可感知行为」——manual 锁定态下，有没有绕过 textarea 的输入路径（如 paste action、mobile initData）与锁定语义矛盾？

## 指定审查角度（本轮新证据方向）

1. **三信号状态机迁移穷举**：mode(auto/manual) × 事件(toggle/focus/blur/viewport-resize/系统手势) 的组合是否都落在 spec 语义上；重点 ★系统手势收键盘 permission 不变★ 与「manual 解锁后用户直接点终端（xterm 自发 focus）」路径。
2. **touchend preventDefault 修复**（`src/toolbar/toolbar.ts` keyboard-toggle 分支）：正确性、对按钮其他行为（click 合成、onTap 的 click fallback、无障碍）的副作用。
3. **CSS 副作用**：`.wt-row` 的 `justify-content: safe center` 兼容性（旧浏览器不认 safe 关键字时的表现）；横屏豁免选择器 `button:not(.wt-keyboard-toggle)` 是否误伤/漏伤。
4. **逃生入口纯度与时机**：`withKeyboardEscapeHatch` 是否真纯；注入发生在渲染前还是渲染后；floatingButtons/drawer 里有 ⌨ 时 row2 不注入的判定是否完整。
5. **fail-loud 链路**：机制不可用时 overlay + 按钮错误态是否可达；auto 模式缺 blur 的判定是否合理。
6. **client-entry bridge**：`setKeyboardSuppressed`/`onFocusChange` 的 throw 路径、事件监听泄漏、与 xterm 自身 focus 管理的交互。

## 验证命令（可跑，worktree 已 pnpm install）

`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist`、`pnpm run test:pw`（webkit 项目本机缺系统库起不来，chromium 可跑）。

## OCR 预扫结果（主脑已逐条核实，供你参考而非结论——请独立判断是否认可降级）

OCR（minimax 主腿，status=reviewed）扫出 20 条：3 high / 9 medium / 8 low。主脑核实后认为**无 P1**，三条 high 的降级理由：

- **[H3] 机制不可用时逃生入口仍注入 ⌨ → 点按 throw**：已核实 throw 会被 `wireButton` 的 `.catch` 接住（`src/toolbar/toolbar.ts:149-153`，console.error + `wt-action-error` 按钮错误态）——这正是仓内 fail-loud 约定，无静默无崩溃。降 P3。
- **[H7] `reportKeyboardUnavailable` 在 createToolbar 之后才跑，窗口内按钮可点**：窗口为同步微任务级（仅隔一个 hooks await），且点按后果同上（错误态）。降 P3。
- **[H8] controller 的 visualViewport 监听 + onFocusChange 订阅未接入 index.ts 的 dispose()**：属实。页面级 teardown（pagehide/beforeunload）下无实际后果，但嵌入消费者同页重复 init 会泄漏。**主脑判 P2，已列入待修**（修复方向：dispose 闭包内调 `keyboard.dispose()`，不新增机制）。

medium 中值得你再独立看一眼的：[M14] ⌨ 按钮 touchend preventDefault 与 `src/util/tap.ts` 文档（d40fa46 移除记录）的张力——主脑已核实 onTap 双通道（touchend + click + touchFired 护栏）下按钮不死、lock 路径 programmatic blur 兜底，判无需修；[M5] 无 visualViewport 平台指示器冻结（目标平台全有该 API，判接受）；[M9] hooks 收原始 config 而非 effectiveConfig（仅差 row2 注入项，无语义后果，判接受）。

## 产出（唯一允许的写入）

写到 worktree 内：**`docs/sessions/kb-sovereignty-inc2/reviews/inc2-review1-verdict.md`**（目录不存在则创建）。结构：verdict（pass/fail）→ P1 findings（逐条：位置、违反的 spec 条款、触发路径、证据）→ P2/P3（可判接受不修）→ 降层三问的回答 → 熵增审查结论 → backlog。每个 finding 给出文件:行号与最小复现/推理。

- **不 commit、不 push、不开 PR、不改任何实现/测试文件。**
- 报告正文首行前必须恰好一行机读 outcome（HTML 注释，顶格，二选一）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 非目标

- 不审增量 1 已合并内容（e8b9ba6 之前）；不审 docs/sessions 下的卡与文档；不要求补测试（测试充分性意见记 P3）；不修任何 finding。
