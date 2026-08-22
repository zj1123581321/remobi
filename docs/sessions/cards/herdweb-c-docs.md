# 任务卡：herdweb 转型 C — 文档与 setup skill 切换 herdr-only 叙事

## 目标

把全部**前瞻性文档**从「tmux 通用 overlay + zellij/herdr 附录」的上游叙事，重写为
「herdweb — herdr 专属 WebUI」的 fork 叙事；setup skill 从三路 onboarding（tmux/zellij/herdr）
收敛为 herdr 单路并更名目录。历史档案（sessions/decisions/designs/spikes）一律不动。

与 A（包身份）、B（代码）并行，文件范围零重叠。

## 非目标

- 不改任何代码、测试、package.json、systemd、部署脚本（A/B/D 卡）。
- 不改 `docs/sessions/**`、`docs/decisions/**`、`docs/designs/**`、`spikes/**`、`goals/M*.md`、
  `retro/**`、`CHANGELOG.md`——历史记录保持写作当时的原样。
- 不改 `docs/deploy-herdr.md`（D 卡）。
- 不做 GitHub 仓改名 / 本地目录改名（D 卡 runbook 的事）。
- 不重画 logo / 不新增图片资产（可作后续小卡，本卡只处理文字与既有链接）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：700
- **Diff-Lines-Hard**：1400
- **阶段**：implementing
- **锁定决策**：
  1. 项目名 `herdweb`；定位一句话："purpose-built Web UI for herdr — monitor and drive
     your coding agents from your phone"（措辞可微调，不得再出现 tmux/zellij 为一等公民）。
  2. fork 起源说明**允许**出现 "remobi" 字样，且仅限「本项目 fork 自上游
     connorads/remobi（2026-08-20 起独立）」这一事实句及其指向
     `docs/decisions/2026-08-20-fork-herdr-focus.md` 的链接；其余语境一律 herdweb。
  3. **README 的 CLI/配置/默认值表述必须按 B 卡命名契约书写**（契约要点：bin
     `herdweb serve`；默认命令 `herdr --session default`；配置文件 `herdweb.config.ts` /
     `.local` 覆盖 / XDG `~/.config/herdweb/`，旧 remobi 路径自动回退读取；抽屉默认 =
     herdr 键组 herdr-new-window/split-v/split-h/zoom/workspaces/sidebar/scrollback/
     kill-pane/help + prefix；手势标签 Next/Previous herdr tab；`serve --` 逃生口保留）。
     本卡不得发明与 B 不同的命名。
  4. AGENTS.md 里的 systemd unit 操作命令改为**指向 `docs/deploy-herdr.md`**，不内联具体
     unit 名——unit 更名由 D 卡在 deploy-herdr.md 内闭环，避免 C/D 两卡在 AGENTS.md 撞笔。
  5. `docs/architecture/how-remobi-works.md` 改名为 `how-herdweb-works.md`
     （`networking-and-websockets.md` 文件名不含项目名，保留）；README 链接同步。
  6. skill 目录 `.agents/skills/remobi-setup/` → `git mv` 为
     `.agents/skills/herdweb-setup/`；AGENTS.md/README 中路径同步。
  7. 发布口径：semantic-release 继续驱动版本/changelog/GitHub Releases，npm 不发布
     （fork 决策现状），README 不再出现任何 `npm install -g` 指引。
- **任务类型**：tests-docs
- **复杂度**：L
- **Base commit**：origin/main（拆卡时 `1f1265f`；开工前 `git rev-parse origin/main` 校准，
  若已前进用新 sha 并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（同批 A 卡碰 package.json 等 4 文件、B 卡碰
  `src/** tests/** cli.ts build.ts`，与本卡零重叠）
- **执行器与模型**：codex（`delegate --class big`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收；review 按仓 `risk-tier: personal`，P1 红线 = 文档给出的
  命令/路径不可用（读者照做必失败）。

## 修改边界

- **允许**：`README.md`、`AGENTS.md`（CLAUDE.md 是指向它的软链，只改这一份）、
  `demo.md`、`docs/architecture/**`（含改名）、`.agents/skills/remobi-setup/**` 与
  `.agents/skills/herdweb-setup/**`（git mv 后的新路径）
- **禁止**：`src/**`、`tests/**`、`cli.ts`、`build.ts`、`package.json`、`tsconfig.json`、
  `install.sh`、`SECURITY.md`、`systemd/**`、`scripts/**`、`docs/deploy-herdr.md`、
  `GOALS.md`（主脑维护的全局层，执行器禁碰，主脑自行更新提法）、
  `docs/sessions/**`、`docs/decisions/**`、`docs/designs/**`、`spikes/**`、`goals/M*.md`、
  `retro/**`、`CHANGELOG.md`、`.github/**`
- **Scope-Globs**：README.md AGENTS.md demo.md docs/architecture/** .agents/skills/remobi-setup/** .agents/skills/herdweb-setup/**
- **高风险区域**：
  - **README 内链完整性**：重写后所有相对链接（skill references、docs/architecture、
    deploy-herdr、designs）必须指向真实存在的路径；skill 改名后
    `.agents/skills/remobi-setup/references/*` 的引用全部要跟着改。
  - **AGENTS.md 是 agent 操作手册**（CLAUDE.md 软链同源）：Key Commands、Local Development、
    Publishing、Conventions 各节改写时不得删掉对执行器有约束力的规则（conventional
    commits 类型表、测试命令、config 形状约定），只换叙事与名字。
  - skill 的 herdr 键位参考表是**权威内容**，重写时原样保留键位表本身。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. README 通读为 herdr 专属 WebUI 的 fork 项目 README：无 npm 安装指引、无 remobi.app、
     无 zellij/tmux 章节、无 `set -g mouse on` 教程；安装方式 = clone + pnpm + tsx/cli 或
     build:dist，部署指向 `docs/deploy-herdr.md`；CLI 参考节与 B 卡契约一致。
  2. AGENTS.md：tagline herdr 专属；模块布局叙述无 tmux 语气；skill 路径指向
     herdweb-setup；systemd 操作指向 deploy-herdr.md；conventional commits 规则完整保留。
  3. skill：herdr 单路（环境检查只查 herdr + Node；无 tmux config 检查、无 mouse-on
     警告、无 zellij/herdr 分支选择）；herdr 键位表保留；配置文件名 herdweb.config.ts；
     onboarding 流程产出 herdweb.config.ts。
  4. `docs/architecture/how-herdweb-works.md` 与 networking 文内 tmux 表述改 herdr
     （PTY 图中的默认命令、示例）。
  5. demo.md 更新（若内容纯属上游演示脚本则删除并在报告说明理由）；GOALS.md 不在
     本卡范围（主脑另行更新）。
  6. 封笔扫描（贴报告）：`grep -rni remobi README.md AGENTS.md GOALS.md demo.md
     docs/architecture/ .agents/skills/herdweb-setup/` → 除锁定决策 2 允许的 fork 起源
     句外**零命中**。
  7. 链接检查：README/AGENTS.md 中所有相对链接目标文件存在（脚本或手工清单均可）。
- **相关测试**：`pnpm test`（确认文档改动零破坏）、`pnpm run check`。
- **跨发布边界不适用**。
- **lint / typecheck / build**：`pnpm run check`。
- **截图或探活**：不需要。
- **现场还原**：停在卡分支；不改动主仓 checkout。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①README 重写 ②AGENTS.md+GOALS+demo ③架构文档改名与改写 ④skill 单路化至少
  4 次提交**，每步 `pnpm run check` 绿了就提交。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言
  恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原
  刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。
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

- **现场事实（主脑预取，2026-08-22）**：
  - `origin/main` = `1f1265f`；CLAUDE.md → AGENTS.md 软链（改 AGENTS.md 即可）。
  - README ~59 处 remobi：结构为「tmux 主体 + zellij/herdr 附录 + npm/remobi.app 安装 +
    AI onboarding 三方式 + Release channels + FAQ + Public API（import 'remobi'）」。
    「Using with herdr」节（约 133-155 行）含 herdr 键位与默认关闭的 swipe 说明——这是
    重写后的主体素材。
  - AGENTS.md ~16 处：tagline "Touch controls for tmux (or zellij, herdr) over the web"；
    fork 说明与 npm 不发布口径已存在（Publishing 节）；`set -g mouse on` 警告在 169 行
    （tmux-only，删）。
  - skill 8 文件 ~104 处：SKILL.md 三路分支（tmux 检查 96-150、zellij 59-76、herdr
    78-94），herdr 键位表 583-595（权威内容，保留）；references/ 含 mobile-tmux.md、
    mobile-panes.md、tailscale-serve.md、keep-awake.md、ttyd-flags.md。
  - `docs/architecture/how-remobi-works.md`（9 处，PTY 图 "default: tmux new-session -A -s
    main"）、`networking-and-websockets.md`（9 处）。
  - demo.md 5 处 remobi 提法。（GOALS.md:5 "remobi/Herdr" 由主脑更新，不在本卡。）
- **已完成**：无（本卡全部待做）。
- **未完成**：本卡全部内容。
- **关键决策**：demo.md 去留由执行器按内容判断（上游演示素材→删，通用素材→改），报告写明。
- **已否决方案**：保留 zellij/herdr 附录式结构（与 herdr-only 定位冲突）；内联 systemd
  unit 名进 AGENTS.md（会与 D 卡撞笔）。
- **下一步唯一动作**：重写 README 主体（herdr-only 叙事 + B 卡契约的 CLI/配置节）。
