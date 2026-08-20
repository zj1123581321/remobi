# 任务卡：ASR 增量 3 — Moshi 式二层语音作曲器

## 目标

把语音从「工具栏上一个立刻开录的 Mic + 浮着的 preview 气泡」改成 Moshi 式两层：

1. **表层 toolbar** 只留一个入口（气泡/作曲器图标），点它**不开始录音**。
2. **二层作曲器**盖住 toolbar：可打字、可点按麦克风、可发送/取消。麦克风的 tap-to-toggle 状态机仍在二层里。

交付对象：手机上用 herdr/remobi 语音驱动 coding agent 的人。解决的问题是当前录音、预览、终端控制键挤在同一层，入口还会被 CSS 拉成一条椭圆。

## 非目标

- 不改 ASR 引擎 / 协议 / PCM / AudioWorklet（`src/asr/` 整棵禁止）。
- 不翻案 hold-to-talk；不新增 action 类型；不把 `voice-input` 放进 drawer/floating。
- 不做 Moshi 的 `+` 附件、撤回/undo、热词、Web Speech fallback、语音命令。
- 打开作曲器时**不**自动开始录音，也**不**自动 focus 输入框（键盘主权）。
- 不改 serve/CSP/session 协议，不改 CHANGELOG，不引入新依赖。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：700
- **Diff-Lines-Hard**：1100
- **阶段**：implementing
- **锁定决策**：
  1. `{ type: 'voice-input' }` 仍是 toolbar-only；语义从「点按开始录音」改为「打开/关闭二层作曲器」。不新增 action 类型。
  2. 麦克风 tap-to-toggle 状态机（idle → permission-requesting → connecting → recording → stopping → waiting-final → preview / error / cancelled）保持现有迁移表、generation、sanitize、pending-Send、error 可重试。改的是**谁接收 tap**：toolbar 入口不再 `attach` 到 `tapToggle`。
  3. 二层壳抄 `combo-picker`：全屏半透明 backdrop + 底栏圆角面板，z-index 高于 toolbar/drawer（combo 是 10004，作曲器取 10005 或复用 preview 的 10002 但必须盖住 toolbar）。点 backdrop = 点关闭。
  4. 作曲器控件：输入框（placeholder `Speak or type…`）+ 状态文案 + 关闭（×）+ 圆形 Mic + Send。录音中 Mic 红色脉动。不要 `+`、不要 undo。
  5. 打开作曲器**禁止** `input.focus()`（combo-picker 那行不要抄）。用户点输入框才弹系统键盘。录音中输入框 `readOnly`，partial 可以覆盖；preview/error 才可编辑。
  6. 成功 Send 后关闭作曲器回表层；× / backdrop 走现有 `cancelPreview`（活动会话取消，preview 丢弃）然后关闭。
  7. `asr.enabled === true` 且 toolbar 两行都没有 `voice-input` 时，自动注入入口。插入位置：`keyboard-toggle` 之后、`drawer-toggle` 之前；两者都没有则 append 到 row1。函数形态与 `withKeyboardEscapeHatch` 一样纯函数，从 `index.ts` 在 hatch 之后调用。用户已经手写了 `voice-input` 则不注入。
  8. toolbar 入口渲染为作曲器/气泡 SVG 图标（不是麦克风），`aria-label` 用 `Voice composer`。CSS 选择器特异性必须压过 `#wt-toolbar .wt-row:last-child button { flex: 1 0 auto }`，入口保持 44×44 圆，禁止再被拉成椭圆。
  9. 打开作曲器时若 drawer / d-pad / combo-picker 开着，先关掉它们。
  10. E6 仍成立：作曲器输入框是普通 `<input>`/`<textarea>`，不要给终端 textarea 做白名单。
- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：5508a6721e654cae15895bca656b40b9faa959d5（origin/main；若已前进，用新的 origin/main sha 作 base，并在报告写明）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读）
- **执行器与模型**：kimi（delegate --class frontend，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead 拆卡与验收；review 按仓 `risk-tier: personal`，P1 红线 = 数据丢失 / 静默出错 / 崩溃；收敛 = 连续 1 轮无新增 P1。

## 修改边界

- **允许**：
  - `src/controls/asr-preview.ts`（改造成作曲器壳，可保留 `#wt-asr-preview` id 或改 id 并同步测试）
  - `src/controls/mic-controller.ts`（入口 toggle 与内部 Mic attach 拆开；open/close composer）
  - `src/toolbar/toolbar.ts`（voice-input 渲染为作曲器入口，不再把 toolbar 按钮 `attach` 成 tapToggle）
  - `src/index.ts`（注入入口、把 composer 挂到 body；必要时关掉 dpad/drawer）
  - `src/config.ts`（仅当注入辅助函数放这里；默认 row1 **不要**静态塞 voice-input）
  - `src/util/dom.ts`（仅当入口/Mic SVG 放到既有 svg helper）
  - `styles/base.css`（作曲器 + 入口 44px 圆，修 last-child flex 特异性）
  - `docs/designs/asr-voice-input.md`（把 E7 从「toolbar 最右绑 tapToggle」改成「toolbar 入口打开二层；Mic 在作曲器内」）
  - `README.md`、`AGENTS.md`、`CLAUDE.md`、`.agents/skills/remobi-setup/SKILL.md`（删掉仍在的 Hold/PTT/300ms 文案，改为二层作曲器）
  - 配套测试：`tests/mic-controller.test.ts`、`tests/integration.test.ts`、`tests/playwright/asr.spec.ts`、`tests/playwright/asr.config.ts`、`tests/config.test.ts`（若注入函数在 config）、以及本卡为作曲器新增的 `tests/asr-preview.test.ts` 或等价文件
- **禁止**：`src/asr/`、`src/serve.ts`、`src/session.ts`、`src/session-protocol.ts`、`.github/`、`CHANGELOG.md`、`package.json`、`pnpm-lock.yaml`、`tests/fixtures/asr/`（只读）
- **Scope-Globs**：src/controls/asr-preview.ts src/controls/mic-controller.ts src/toolbar/toolbar.ts src/index.ts src/config.ts src/util/dom.ts styles/base.css docs/designs/asr-voice-input.md README.md AGENTS.md CLAUDE.md .agents/skills/remobi-setup/SKILL.md tests/mic-controller.test.ts tests/integration.test.ts tests/playwright/asr.spec.ts tests/playwright/asr.config.ts tests/config.test.ts tests/asr-preview.test.ts
- **高风险区域**：
  - 键盘主权：打开作曲器不得抢终端焦点、不得 `input.focus()`。
  - CSS 特异性：`#wt-toolbar .wt-row:last-child button { flex: 1 0 auto }` 现在会盖掉 `.wt-mic { flex: 0 0 44px }`（主脑 Pixel 5 实测：单独一个 voice-input 被拉成整行椭圆）。
  - Playwright 现在点 `#wt-toolbar [data-remobi-action="voice-input"]` 就期望 `data-mic-state=recording`——必须改成「点入口 → 作曲器可见且仍 idle → 点作曲器内 Mic 才 recording」。
  - schema 继续拒绝 drawer/floating 的 voice-input，不要为了二层去改这条。

## 不变式轴表

轴：作曲器开合 × Mic 状态 × 用户手势

| 作曲器 | Mic 状态 | 手势 | 检测点 |
|---|---|---|---|
| 关 | idle | 点 toolbar 入口 | 作曲器打开，状态仍 idle，engine.start 次数不变 |
| 开 | idle | 点作曲器 Mic | recording（或 connecting），partial 可写入输入框 |
| 开 | recording | 再点作曲器 Mic | waiting-final → preview，输入框可编辑 |
| 开 | recording | 点 Send | 现有 pending-send：停录，final/超时后发送并**关闭作曲器** |
| 开 | preview | 点 Send | 文本进终端，作曲器关闭，idle |
| 开 | 任意非 idle | 点 × 或 backdrop | cancelSession，作曲器关闭，idle |
| 开 | idle | 点 × 或 backdrop | 作曲器关闭，不调用 engine |
| 开 | preview | 点 toolbar 入口 | 入口被盖住不可点；若测试直接调 API，忽略或视为 no-op |
| 关 | idle | asr.enabled 且配置无 voice-input | row1 在 keyboard-toggle 后注入入口 |
| 关 | idle | 配置已有 voice-input | 不重复注入 |
| 开 | recording | 输入框 | readOnly=true；preview 后 readOnly=false |
| 开 | idle | 刚打开 | 输入框不是 document.activeElement |

表驱动测试必须覆盖上表每一格。Mic 原有状态机测试（sanitize、断线不入队、error 重试、visibilitychange）保持绿，不得删减。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与 `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  - Pixel 5 视口：表层入口是 44×44 圆图标，不是椭圆。
  - 点入口打开二层，toolbar 被盖住；此时尚未录音。
  - 点二层 Mic 才进入 connecting/recording；再点停止并出 preview。
  - 可在 preview 编辑后 Send；Send 后二层关闭。
  - × / backdrop 丢弃并关闭。
  - asr.enabled 的默认 7 键配置自动出现入口；用户已配置 voice-input 时不出现两个。
  - asr.enabled=false 或无 getUserMedia 时入口不渲染（现有降级保留）。
- **相关测试**：`pnpm test`、`pnpm exec playwright test tests/playwright/asr.spec.ts --project=chromium-android`。禁止用 `-k` 子集代替全量 vitest。新轴表每一格都要有断言。
- **跨发布边界不适用**：同一进程 DOM，无跨仓 artifact。
- **接口契约**：
  ```ts
  // MicController 必须能表达「入口打开作曲器」与「内部 Mic tap」两条路径。
  // 推荐（不要再加一层无第二消费者的包装）：
  interface MicController {
    readonly preview: AsrPreview
    readonly state: MicState
    attachComposerToggle(button: HTMLButtonElement): void
    attachMicButton(button: HTMLButtonElement): void
    dispose(): void
  }
  interface AsrPreview {
    readonly element: HTMLElement
    open(): void          // 空闲打开，不 startSession
    close(): void
    readonly isOpen: () => boolean
    // 现有 getText/show/setPartial/showMessage/clear/onConfirm/onCancel 保留语义
  }
  ```
  若函数名略有差异，报告写明映射；禁止另造第三套 controller。
- **lint / typecheck / build**：`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、`pnpm run lint:knip`、`pnpm run build:dist`
- **截图或探活**：Playwright 在 `test-results/` 留下 idle 入口、作曲器打开（未录音）、recording、preview 四张 Pixel 5 截图，路径写进报告。
- **现场还原**：停在卡分支；不要改主仓 checkout；不要提交任何 `remobi.config.local.ts` / 密钥 / `/tmp` 探针。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  本卡按 ①CSS 入口圆 + 作曲器壳 ②mic-controller 入口/Mic 拆分 + 轴表测试 ③自动注入 ④Playwright e2e ⑤文档/skill 五次提交。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言
  恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原
  刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
- **代码可检索**：导出符号 2–4 词且含领域词（`createAsrPreview` / `withVoiceComposerEntry` / `attachComposerToggle`）；文件名带领域前缀。日志与错误串写完整字面量。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个
  二级标题之前，必须恰好出现一行机读 outcome：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **现场事实（主脑预取，2026-08-20）**：
  - `origin/main` `5508a67`；工作区干净；PR #8 ASR 增量 2 已合并。
  - 默认 row1 7 键无 Mic（`src/config.ts:42-80`）；`asr.enabled` 默认 false。7681 调试实例（`.omo/remobi-debug.config.ts`）也没有 ASR。
  - Pixel 5 探针（`/tmp/remobi-voice-ux/*.png`，asr.config 把 voice-input 作为 **row1 唯一按钮**）：
    - 入口被 `#wt-toolbar .wt-row:last-child button { flex: 1 0 auto }` 拉成整行椭圆（特异性 121 > `.wt-mic` 的 111）。
    - 点 Mic 立刻 recording，preview 气泡 `bottom:72px` 叠在仍可见的工具栏上方；录音时 Cancel/Send 与巨大粉色椭圆 Mic **双入口并存**。
    - preview 是对话框不是二层菜单；toolbar 不被盖住。
  - README:339、skill、AGENTS.md 仍写 Hold/PTT/300ms，与 tap-to-toggle 实现漂移。
  - combo-picker（`src/controls/combo-picker.ts` + `styles/base.css` `#wt-combo-backdrop`）是可抄的二层壳；**不要抄它的 `input.focus()`**。
  - Playwright `tests/playwright/asr.spec.ts:79-96` 锁死「toolbar voice-input click → recording」。
  - 已否决：hold-to-talk；voice-input 进 drawer；新增 action 类型；打开即录音；打开即弹键盘。
- **下一步唯一动作**：实现作曲器壳，并把 toolbar voice-input 改成入口。
