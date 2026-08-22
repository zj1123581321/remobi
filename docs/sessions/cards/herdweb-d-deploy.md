# 任务卡：herdweb 转型 D — 部署面更名与迁移 runbook（串行收尾，A+B 合并后派发）

## 目标

部署面从 remobi 更名为 herdweb：systemd unit、安装脚本、公网暴露检查、部署 runbook，
并产出一份「从 remobi 迁移到 herdweb」的操作手册。**本卡只改文件 + 跑文件级测试，
绝不执行任何影响线上服务的 systemctl 操作**——生产切换由主脑与用户按 runbook 执行。

派发时机：**串行**，等 A（bin 名）与 B（测试基线）合入 main 后再派；与 C 无文件重叠，
但为了 runbook 里的命令真实可用，同样等 C 合入。

## 非目标

- 不动线上 `remobi.service`（此刻正承载 `herdr.zlxlabs.com` 生产流量）。
- 不做 GitHub 仓改名、本地目录改名（写进 runbook 作为可选步骤）。
- 不改 Tailscale 侧 `/remobi/` 外部入口 URL（锁定决策：外部契约不动，runbook 提供
  可选的变更指引）。
- 不改 src/tests 代码（B 卡已完成更名基线）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：250
- **Diff-Lines-Hard**：450
- **阶段**：implementing
- **锁定决策**：
  1. unit 更名：`systemd/remobi.service` → `systemd/herdweb.service`、
     `systemd/remobi-debug.service` → `systemd/herdweb-debug.service`（git mv + 内容更新）。
  2. 生产 unit 的 `WorkingDirectory` 与路径**保持 `/home/zlx/projects/oss/remobi`**——
     本地目录不改名（改名收益纯审美，代价是 unit/脚本/runbook 全链条路径 churn；
     runbook 里写为可选后续步骤）。
  3. 生产 ExecStart 不变（`serve-prod.sh serve --host 127.0.0.1 --port 7681 -- herdr
     --session default`）；调试 ExecStart 三处变化：`--base-path /remobi` **保留**
     （Tailscale 外部契约）、`--config .omo/remobi-debug.config.ts` →
     `.omo/herdweb-debug.config.ts`（本地文件由 runbook 的 mv 步骤同步）、
     `herdr session attach remobi-dev` → `herdweb-dev`（调试草稿会话，无保留价值）。
  4. `scripts/install-prod.sh` / `install-debug.sh`：unit 源/目标路径与提示文案改
     herdweb；`scripts/check-exposure.sh`：特征 grep `remobi|xterm` → `herdweb|xterm`，
     中文提示文案同步。
  5. `docs/deploy-herdr.md`：unit 名、调试 config 路径、`herdweb-dev` 会话名、重启检查
     命令同步；**追加「从 remobi 迁移」章节**（步骤见完成条件）。
  6. AGENTS.md 不改（C 卡已把 systemd 操作指向 deploy-herdr.md，本卡在 runbook 内闭环）。
- **任务类型**：refactor-migration
- **复杂度**：M
- **Base commit**：bc7b8ce17a3d7785035e64a43cad74ff689b9dca（A+B+C 合并后的 origin/main，PR #36/#38/#37）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：grok（`delegate --class quick`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收；review 按仓 `risk-tier: personal`，P1 红线 = runbook
  步骤照做会导致生产不可用或无法回滚。

## 修改边界

- **允许**：`systemd/**`、`scripts/install-prod.sh`、`scripts/install-debug.sh`、
  `scripts/check-exposure.sh`、`tests/deploy/**`、`docs/deploy-herdr.md`
- **禁止**：`src/**`、`tests/*.ts`、`tests/playwright/**`、`README.md`、`AGENTS.md`、
  `package.json`、`cli.ts`、`.github/**`、`CHANGELOG.md`、`docs/sessions/**`
- **Scope-Globs**：systemd/** scripts/install-prod.sh scripts/install-debug.sh scripts/check-exposure.sh tests/deploy/** docs/deploy-herdr.md
- **高风险区域**：
  - **生产 unit 正在运行**：任何 `systemctl --user start/stop/enable/disable`、任何
    `install-*.sh` 实际执行都禁止（脚本改完只靠 tests/deploy 断言验证）。
  - 迁移章节必须包含**回滚路径**（旧 unit 文件保留策略、恢复命令）。
  - `check-exposure.sh` 的 grep 模式改名后，PASS/FAIL 判定语义不变（检测应用特征是否
    暴露在公网）。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. `systemd/herdweb.service` / `herdweb-debug.service` 存在且旧文件删除（git mv）；
     Description 为 herdweb 语气；ExecStart 符合锁定决策 3。
  2. 三个 `tests/deploy/*.sh` 全绿（断言新 unit 内容、安装脚本目标路径、exposure 行为）。
  3. `docs/deploy-herdr.md` 新增迁移章节，含且不限于：
     a. 前置检查（当前 `systemctl --user is-active remobi.service`）；
     b. `systemctl --user stop remobi.service && systemctl --user disable remobi.service`；
     c. `rm ~/.config/systemd/user/remobi.service ~/.config/systemd/user/remobi-debug.service`
        （如存在）+ `systemctl --user daemon-reload`；
     d. `mv .omo/remobi-debug.config.ts .omo/herdweb-debug.config.ts`（本地文件，
        如存在）；
     e. `scripts/install-prod.sh --enable` 启动 `herdweb.service`；
     f. 验证：`systemctl --user is-active herdweb.service`、`ss -ltn | grep 127.0.0.1:7681`、
        `scripts/check-exposure.sh https://herdr.zlxlabs.com`；
     g. 回滚：重装旧 unit 文件的恢复步骤（从 git 历史取 `systemd/remobi.service@<sha>`）；
     h. 可选后续：`gh repo rename herdweb`（及 package.json URL 跟改）、本地目录改名
        （全链条路径同步清单）、Tailscale 入口 `/remobi/` → `/herdweb/`（含 base-path 与
        Tailscale serve 配置双侧步骤）。
- **相关测试**：`bash tests/deploy/test-prod-unit.sh && bash tests/deploy/test-debug-unit.sh
  && bash tests/deploy/test-check-exposure.sh` 三个脚本全绿；`pnpm test` 全量（确认零破坏）。
- **跨发布边界不适用**（文件级改动 + shell 断言）。
- **lint / typecheck / build**：`pnpm run check`。
- **截图或探活**：不需要；**报告必须显式声明"未执行任何 systemctl/install 脚本"**。
- **现场还原**：停在卡分支；不改动主仓 checkout；不触碰本机 `~/.config/systemd/user/`。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①unit 更名+安装脚本 ②check-exposure+deploy 测试 ③runbook 迁移章节至少
  3 次提交。**
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

- **现场事实（主脑预取，2026-08-22，unit 文件全文已核）**：
  - 生产 unit：`Description=remobi production bridge for the default herdr session`，
    WorkingDirectory=/home/zlx/projects/oss/remobi，ExecStart=serve-prod.sh serve
    --host 127.0.0.1 --port 7681 -- herdr --session default。
  - 调试 unit：ExecStart=...tsx cli.ts serve --host 127.0.0.1 --port 7691 --base-path
    /remobi --config /home/zlx/projects/oss/remobi/.omo/remobi-debug.config.ts --
    herdr session attach remobi-dev。
  - `scripts/serve-prod.sh` 无 remobi 字面量（路径全部动态求值），不需要改。
  - `install-prod.sh` / `install-debug.sh`：UNIT_SOURCE/UNIT_TARGET 用 unit 名拼路径。
  - `check-exposure.sh:37,42,84`：`grep -aEic 'remobi|xterm'` 与中文提示。
  - 外部契约：Cloudflare 入口 `https://herdr.zlxlabs.com` → 127.0.0.1:7681；
    Tailscale 调试 `https://<tailnet>/remobi/` → 127.0.0.1:7691（/remobi 前缀 = base-path）。
- **已完成**：无（本卡待 A/B/C 合并后派发）。
- **未完成**：本卡全部内容。
- **关键决策**：外部 URL `/remobi/` 保留（锁定决策 3）；调试会话改 `herdweb-dev`；
  本地目录与 GitHub 仓改名仅为 runbook 可选项。
- **已否决方案**：本卡内顺带执行生产切换（明确禁止）；本地目录改名（路径 churn 收益低）。
- **下一步唯一动作**：等主脑派发（前置：A+B+C 合入 main）。
