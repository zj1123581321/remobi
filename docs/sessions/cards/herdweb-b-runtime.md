# 任务卡：herdweb 转型 B — 代码与测试全面更名 + herdr 专属默认值 + 一次性数据迁移

## 目标

三个子目标一次完成：

1. **更名**：`cli.ts`、`build.ts`、`src/**`、`tests/**` 里所有 remobi 身份标识（类型名、
   运行时字符串、全局变量、事件名、DOM id、localStorage 键、worklet 名、临时文件前缀）
   全部改为 herdweb，测试断言同步。**收尾硬指标：本卡范围内 `grep -rni remobi` 零命中。**
2. **herdr 专属默认值**：默认启动命令、抽屉按钮、滑动手势标签、env 剥离规则从 tmux 通用
   叙事切换为 herdr 专属；`serve -- <任意命令>` 逃生口保留。
3. **一次性数据迁移**：localStorage 旧键（`remobi:fontSize`、`remobi:composer:v1:*`）与
   旧配置路径（`remobi.config.ts`、`~/.config/remobi/`）在首次运行 herdweb 时自动读取迁移，
   保证「字号设置不丢、语音草稿不丢（M1 里程碑成果）、现有配置继续生效」。

与 A（包身份）、C（文档）并行，文件范围零重叠。

## 非目标

- 不改 `package.json`、`tsconfig.json`、`SECURITY.md`、`install.sh`（A 卡）。
- 不改 README / AGENTS.md / skill / `docs/**`（C 卡；`docs/sessions/**` 是历史档案永不在乎）。
- 不改 `systemd/**`、`scripts/install-*.sh`、`scripts/check-exposure.sh`、`tests/deploy/**`、
  `docs/deploy-herdr.md`（D 卡）。
- 不删 `serve -- <command>` 尾参机制（Playwright 测试基建依赖它 spawn bash）。
- 不改协议语义、不改弱网（wnet）已合入的逻辑——只允许字符串/标识符层面的机械替换。
- 不做 herdr 输出解析（PTY 管道保持透明，spike 已证伪）。
- 不动 `CHANGELOG.md`、`spikes/**`、`goals/**`、`retro/**`（历史档案）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：900
- **Diff-Lines-Hard**：1600
- **阶段**：implementing
- **锁定决策**（命名契约，C/D 卡文档引用同一份，不得偏离）：

  1. **新名** `herdweb`（全小写单词）。CLI 命令 `herdweb serve`（bin 由 A 卡接）。
  2. **默认命令**：`DEFAULT_COMMAND = ['herdr', '--session', 'default']`
     （`src/serve.ts:26`，与生产 unit 的 ExecStart 一致）。
  3. **CLI 文案**：`cli.ts:57` 版本串 "mobile terminal overlay for tmux" →
     "web UI for herdr"；`:62` 默认命令说明与 `:93` 示例同步改 herdr。
  4. **配置解析**（`cli.ts`）：
     - 搜索顺序：cwd 的 `herdweb.config.ts|js` → `~/.config/herdweb/herdweb.config.ts|js`
       → **legacy 回退**：cwd 的 `remobi.config.ts|js` → `~/.config/remobi/remobi.config.ts|js`
       （命中 legacy 时 console 输出一行提示建议改名，不自动复制）。
     - `.local` 覆盖同理：`herdweb.config.local.ts` 优先，legacy `remobi.config.local.ts` 回退。
     - `herdweb init` 脚手架生成 `herdweb.config.ts`，模板内 `name`/`shortName` 用
       `herdweb`。
  5. **localStorage 一次性迁移**（模式统一：读新键 → 空则读旧键 → 写新键 → 删旧键）：
     - `herdweb:fontSize` ← `remobi:fontSize`（`src/actions/registry.ts:86` 一带）
     - `herdweb:composer:v1:${basePath}` ← `remobi:composer:v1:${basePath}`
       （`src/controls/asr-preview.ts:30` 的前缀常量处实现，basePath 逐实例迁移）
     - 新键已有值时**忽略**旧键（新值为准），不反向覆盖。
  6. **window 全局**：`__remobiConfig` / `__remobiVersion` / `__remobiBasePath` /
     `__remobiSockets` / `__remobiResize`（`src/types.ts` Window 声明 + `src/client-entry.ts`
     注入）及测试专用 `__remobiSentFrames` / `__remobiPendingAtActionSend` /
     `__remobiBufferedSamples` / `__remobiSocketConstructs`（playwright 用）→ 全部 `__herdweb*`。
  7. **事件与 DOM**：`remobi-connection-notice` → `herdweb-connection-notice`；
     `remobi-reconnect-overlay` → `herdweb-reconnect-overlay`；
     `remobi-session-status` → `herdweb-session-status`；
     `data-remobi-action` / `data-remobi-control` → `data-herdweb-action` /
     `data-herdweb-control`。
  8. **ASR**：worklet 处理器名 `remobi-pcm-processor` → `herdweb-pcm-processor`
     （engine.ts:14 与 worklet-entry.ts:111 两处注册名必须一致）；类
     `RemobiPcmProcessor` → `HerdwebPcmProcessor`；`protocol.ts:111` `uid: 'remobi'` →
     `uid: 'herdweb'`。
  9. **类型名**：`RemobiConfig` → `HerdwebConfig`、`RemobiConfigOverrides` →
     `HerdwebConfigOverrides`，其余一切 `Remobi*` 标识符 → `Herdweb*`（含
     `serialiseThemeForTtyd` 等导出的文档签名引用处）。
  10. **用户可见字符串**：console 前缀 `remobi:` → `herdweb:`（`src/**` 约 40 处）；
      `Terminal failed; restart remobi.` → `Terminal failed; restart herdweb.`（session.ts:10）；
      `Session ended — restart remobi to start a new one.` → herdweb 版（client-entry.ts）；
      临时文件前缀 `remobi-drop-` → `herdweb-drop-`（serve.ts:333）。
  11. **PWA 名**：serve.ts / build.ts 调 `generateManifest`/`generatePwaHtml` 传的
      `name` 参数 `'remobi'` → `'herdweb'`；`src/config.ts` 的 `defaultConfig.name` 同步。
  12. **抽屉默认按钮**（`src/config.ts:155-215` 重写为 herdr 键组，序列出处 =
      README「Using with herdr」节，herdr prefix 同为 Ctrl-B）：

      | 保留/新增 id | 序列 | 说明 |
      |---|---|---|
      | `herdr-new-window` | `\x02c` | 新窗口（herdr 绑定同 tmux） |
      | `herdr-split-v` | `\x02v` | 左右分屏（替换 tmux-split-vertical `\x02%`） |
      | `herdr-split-h` | `\x02-` | 上下分屏（替换 tmux-split-horizontal `\x02"`） |
      | `herdr-zoom` | `\x02z` | 面板放大 |
      | `herdr-workspaces` | `\x02w` | 工作区选择（替换 tmux-sessions + tmux-windows） |
      | `herdr-sidebar` | `\x02b` | 侧栏开关（新增） |
      | `herdr-scrollback` | `\x02e` | 滚动编辑（替换 tmux-copy `\x02[`） |
      | `herdr-kill-pane` | `\x02x` | 关面板 |
      | `herdr-help` | `\x02?` | 帮助 |
      | `prefix` | `\x02` | 发 Prefix（id 去掉 tmux- 前缀） |

      中性按钮（combo-picker、font±、guide/drawer 等）不变。旧 `tmux-*` id 全部消失
      （README 已文档化这些 id 可被用户 config 引用——本卡是 herdr-only 转型，
      破坏性接受，不加兼容映射）。
  13. **滑动手势默认**（config.ts:33-34）：序列 `\x02n`/`\x02p` 不变（herdr 的
      next/previous tab 绑定，默认关闭），标签 `Next tmux window` → `Next herdr tab`、
      `Previous tmux window` → `Previous herdr tab`。
  14. **`mobile.initData` `\x02z`**：序列保留（herdr 有 zoom），注释从 tmux 语气改 herdr。
  15. **env 剥离**（session.ts:53-64）：`NESTED_MUX_ENV_VARS` 枚举表替换为**前缀规则**——
      剥离一切以 `HERDR` 开头的 env 键（模式已在 `spikes/scrollback/lib.mjs:25-37` 验证）；
      删除 TMUX/ZELLIJ 条目；注释改为 herdr 语境（嵌套 client 标记剥离）。
  16. **`scripts/check-breaking-footer.ts`** 错误前缀 `remobi:` → `herdweb:`。
  17. **测试同步**：`tests/**`（不含 `tests/deploy/**`）所有断言字符串、临时目录前缀
      （`remobi-serve-test-`、`remobi-drop-test-`、`remobi-worklet-`、`remobi-spawn-helper-`、
      `remobi-cli-validation-`、`remobi-playwright-home-`、`remobi-playwright-tmp-` 等 →
      herdweb 前缀）、`__remobi*` 全局、事件名、DOM id、PWA name 参数、
      `config.test.ts:209` 的 `defaultConfig.name === 'remobi'` 断言、
      `config.test.ts` "default drawer uses stock tmux bindings only" 用例重写为
      "default drawer uses herdr bindings only"（保持断言意图：默认抽屉只含 herdr 键组）、
      `session.test.ts` env 剥离用例改为 HERDR 前缀规则用例（含"未来新增 HERDR_XXX
      变量也被剥离"的正例）、playwright 各 spec（`smoke`/`session-exit`/`multi-client`/
      `keyboard-toggle`/`image-drop` 的 `/remobi` basePath 测试值改 `/herdweb`、
      `asr.spec` 选择器、`weak-network.spec` 全局名、`isolated-serve.ts` 临时 HOME 前缀与
      提示文案）。

- **任务类型**：refactor-migration
- **复杂度**：L
- **Base commit**：origin/main（拆卡时 `1f1265f`；开工前 `git rev-parse origin/main` 校准，
  若已前进用新 sha 并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（同批 A 卡只碰 package.json/tsconfig/SECURITY/install.sh，
  C 卡只碰文档与 skill，零重叠）
- **执行器与模型**：codex（`delegate --class big`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **子代理 fan-out**：允许派 explorer 子代理并行扫描，fork_turns=none 防上下文污染。
- **计划者与审查者**：主脑拆卡与验收；review 按仓 `risk-tier: personal`，P1 红线 = 数据丢失 /
  静默出错 / 崩溃。**本卡含数据迁移路径（localStorage/config），等同失败路径敏感：收敛条件
  连续 2 轮无新增 P1。**

## 修改边界

- **允许**：`cli.ts`、`build.ts`、`scripts/check-breaking-footer.ts`、`src/**`、
  `tests/*.ts`、`tests/playwright/**`
- **禁止**：`tests/deploy/**`（D 卡）、`package.json`、`tsconfig.json`（A 卡）、
  `README.md`、`AGENTS.md`、`GOALS.md`、`demo.md`、`docs/**`、`.agents/**`（C 卡）、
  `systemd/**`、`scripts/install-prod.sh`、`scripts/install-debug.sh`、
  `scripts/check-exposure.sh`（D 卡）、`CHANGELOG.md`、`spikes/**`、`goals/**`、`retro/**`、
  `.github/**`、`pnpm-lock.yaml`
- **Scope-Globs**：cli.ts build.ts scripts/check-breaking-footer.ts src/** tests/*.ts tests/playwright/**
- **高风险区域**：
  - **两处注册名必须同步**：worklet 处理器名在 engine.ts 与 worklet-entry.ts 各出现一次，
      改漏一处 ASR 静默失效。
  - **localStorage 迁移只许在读取入口做一次**：fontSize 在 registry 读取处、composer 在
      asr-preview 的 storage 封装处；不许散落多处各自迁移造成双写漂移。
  - **`src/types.ts` 的 Window 全局声明**与 client-entry 注入点、全部测试引用必须一次改齐；
      封笔前 `grep -rn "__remobi\|__herdweb" src/ tests/` 逐条核对两侧一致。
  - **weak-network.spec.ts / client-connection.test.ts 引用的全局名是弱网协议的挂钩**，
      只改名不改语义。
  - **`tests/image-drop.spec.ts` 的 `/remobi` 是任意 basePath 测试值**，改 `/herdweb` 时
      同步改断言里的 URL 拼接；别误当成部署前缀。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. `pnpm exec tsx cli.ts serve --port 7799 -- bash --norc` 起服务，浏览器/console 中
     版本串、错误前缀均为 herdweb；默认命令说明为 herdr。
  2. 预置 `localStorage['remobi:fontSize']='18'` 后启动 → 读到 18、写入
     `herdweb:fontSize`、旧键被删；`herdweb:fontSize` 已有值时旧键不覆盖新值。
  3. composer 草稿键同上（按 basePath 维度）。
  4. cwd 放 `remobi.config.ts`（无 herdweb 配置）→ serve 能加载并打 legacy 提示；
      同时存在时 herdweb 配置优先。
  5. 抽屉默认按钮为 herdr 键组（上表），无任何 `tmux-*` id。
- **相关测试**：`pnpm test`（全量，禁止 `-k` 子集）；`pnpm run test:pw`（chromium+webkit；
      若执行环境缺浏览器，如实报告并在分支上留绿的单测证据，playwright 由主脑补跑）。
  新增测试最低要求：
  - localStorage 迁移：旧键存在→迁移+删旧键 / 旧键不存在→无副作用 / 新键已有→旧键被忽略，
      fontSize 与 composer 两处都要；
  - 配置回退：legacy 命中提示 / herdweb 优先 / 双双缺席走默认；
  - env 前缀规则：`HERDR_SESSION`/`HERDR_SOCKET_PATH`/假想的 `HERDR_FUTURE_VAR` 均被剥离，
      `HOME`/`PATH` 不受影响。
  封笔扫描（结果贴报告）：
  `grep -rni remobi cli.ts build.ts scripts/check-breaking-footer.ts src/ tests/*.ts tests/playwright/`
  → **必须零命中**。
- **跨发布边界不适用**：全局名/事件名/键名是浏览器内私有契约，producer 与 consumer 同包
  同测试覆盖。
- **接口契约**：本卡「锁定决策」节的命名表即契约正文，C 卡文档与 D 卡 unit 引用以它为准；
  `DEFAULT_COMMAND = ['herdr', '--session', 'default']` 为最终形态。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、
  `pnpm run lint:ox`、`pnpm run build:dist`
- **截图或探活**：不需要截图；报告贴 `grep` 封笔扫描零命中原文与一次
  `tsx cli.ts serve -- bash --norc` 的启动日志片段。
- **现场还原**：停在卡分支；不改动主仓 checkout；测试起的 PTY 进程必须 dispose。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①类型/标识符机械改名（src+单测） ②运行时字符串/全局/事件/DOM（含 playwright
  同步） ③localStorage+配置迁移逻辑与测试 ④herdr 默认值（DEFAULT_COMMAND/抽屉/手势/
  env 前缀） 至少 4 次大提交**，每步全量单测绿了就提交。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言
  恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原
  刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支（legacy 配置回退与 localStorage 迁移是本卡明确要求的迁移路径，
  不属于此列）。
- **执行器自声明 outcome**（固定条款，原样保留）：报告文件（report.md）正文中、首个
  二级标题之前，必须恰好出现一行机读 outcome：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

- **执行器在途 blocked 上行**：遇到卡面未交代清楚、无法自行决定的阻塞问题时，在 report.md
  正文首个二级标题之前写恰好一行（无阻塞时写 0 行），行首顶格、大小写敏感：

```
<!-- delegate-blocked: 这里是阻塞问题原文 -->
```

## 当前状态

- **现场事实（主脑预取，2026-08-22，来自全仓 grep 盘点）**：
  - `origin/main` = `1f1265f`；工作区干净；弱网 T1-T4 已全部合入 main
    （`1aeca5f` "all four increments merged"），本卡是其后第一个大改动。
  - 本卡范围内 remobi 命中分布（约数）：`src/**` ~85 处（serve.ts 14、actions/registry 8、
    index 4、toolbar 2、controls/* ~10、client-entry 8、asr 4、其余散布）；
    `tests/*.ts` + `tests/playwright/**` ~180 处；`cli.ts` ~25 处；`build.ts` ~10 处。
  - 关键锚点：`src/serve.ts:26` DEFAULT_COMMAND；`src/config.ts:155-215` 抽屉默认；
    `src/config.ts:33-34` 手势标签；`src/session.ts:53-64` env 枚举、`:10` 会话错误串；
    `src/types.ts:313-315` Window 全局声明；`src/actions/registry.ts:86` fontSize 键；
    `src/controls/asr-preview.ts:30` composer 键前缀；`src/asr/doubao/engine.ts:14` 与
    `src/asr/worklet-entry.ts:111` worklet 注册名；`cli.ts:57/62/93` CLI 文案、
    `:123-180` 配置解析与 XDG 路径、`:258-330` init 脚手架。
  - README「Using with herdr」节已给出 herdr 键位权威表（split `\x02v`/`\x02-`、
    spaces `\x02w`、sidebar `\x02b`、scrollback `\x02e`；prefix+n/p 为 tab 切换、默认关）。
  - `spikes/scrollback/lib.mjs:25-37` 是 HERDR 前缀剥离规则的已验证实现参照。
- **已完成**：无（本卡全部待做）。
- **未完成**：本卡全部内容。
- **关键决策**：旧 `tmux-*` 抽屉 id 不做兼容映射（herdr-only 转型，用户 config 自担）；
  `--` 逃生口保留；配置回退只读不复制。
- **已否决方案**：herdr 输出解析（spike NO-GO）；旧 id 兼容层；自动迁移复制旧配置文件。
- **下一步唯一动作**：先做第 ① 步类型/标识符机械改名并跑全量单测。
