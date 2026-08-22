# 任务卡：herdweb 转型 A — 包身份与外部身份面更名

## 目标

把项目的包身份与外部身份标识从 `remobi` 切换为 `herdweb`：npm 包名 / bin 命令名 /
仓库 URL / 安全披露渠道，并删除属于上游基础设施的一键安装脚本。与 B（代码运行时）、
C（文档）并行，文件范围零重叠。

背景：本仓是 upstream remobi 的独立 fork（`docs/decisions/2026-08-20-fork-herdr-focus.md`），
定位已收敛为 herdr 专属 WebUI，项目更名 herdweb。`package.json` 的 repository 目前仍指向上游
`connorads/remobi`，这是历史遗留错误，本卡一并修正为本仓实际地址。

## 非目标

- 不改任何 TypeScript 源码、测试、CLI 逻辑（B 卡的活）。
- 不改 README / AGENTS.md / skill / docs（C 卡的活）。
- 不改 systemd / 部署脚本（D 卡的活）。
- 不动 semantic-release 的发布机制：release job 继续驱动版本号 / changelog / GitHub
  Releases，npm publish 继续保持事实性 no-op（fork 决策已锁定，不新增也不移除 publish 配置）。
- 不做 GitHub 仓库改名（`gh repo rename` 是 D 卡 runbook 里的可选步骤，由主脑与用户执行）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：80
- **Diff-Lines-Hard**：180
- **阶段**：implementing
- **锁定决策**：
  1. 新名固定 `herdweb`（全小写、单词、无连字符）。
  2. 仓库地址用当前实际地址 `https://github.com/zj1123581321/remobi`（本地目录与 GitHub
     仓暂不改名，D 卡 runbook 处理；本卡不预写未来地址）。
  3. 配置文件名契约为 `herdweb.config.ts`（与 B 卡共享：B 负责让 cli.ts 搜索该文件名并
     回退读旧 `remobi.config.ts`；本卡只改 tsconfig include 引用）。
- **任务类型**：refactor-migration
- **复杂度**：S
- **Base commit**：origin/main（拆卡时 `1f1265f`；开工前 `git rev-parse origin/main` 校准，
  若已前进用新 sha 并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（同批并行的 B 卡只碰 `src/** tests/** cli.ts build.ts
  scripts/check-breaking-footer.ts`，C 卡只碰文档与 skill，与本卡零重叠）
- **执行器与模型**：grok（`delegate --class quick`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收；review 按仓 `risk-tier: personal`，P1 红线 = 数据丢失 /
  静默出错 / 崩溃。

## 修改边界

- **允许**：`package.json`、`tsconfig.json`、`SECURITY.md`、`install.sh`（删除）
- **禁止**：`src/**`、`tests/**`、`cli.ts`、`build.ts`、`README.md`、`AGENTS.md`、`docs/**`、
  `.agents/**`、`systemd/**`、`scripts/**`、`CHANGELOG.md`、`.github/**`、`spikes/**`
  （历史档案与并行卡范围，一律不碰）
- **Scope-Globs**：package.json tsconfig.json SECURITY.md install.sh
- **高风险区域**：
  - `package.json` 的 `exports` 子路径键（`./config`、`./types` 等）**保持不变**——包名变更后
    导入路径自然变为 `herdweb/config`、`herdweb/types`，不需要也不允许改 exports 键名。
  - `bin` 字段改名后，本地 `pnpm bin` 链接名变化；`tsx cli.ts serve` 的开发路径不受影响。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. `package.json` 的 `name` 为 `herdweb`，`bin` 键为 `herdweb`；
  2. `repository.url` / `homepage` / `bugs.url` 均指向 `zj1123581321/remobi`（github.com HTTPS
     或 git+https 形式，与原字段风格一致）；
  3. `description` 更新为 herdr 专属定位（建议 "Web UI for herdr — monitor and drive your
     coding agents from your phone"，可微调措辞但不提 tmux/zellij/npm 安装）；
  4. `tsconfig.json` include 中的 `remobi.config.ts` 改为 `herdweb.config.ts`；
  5. `SECURITY.md` 不再出现 `security@remobi.app`，漏洞披露改为本仓 GitHub 私有漏洞报告
     （`https://github.com/zj1123581321/remobi/security/advisories/new`），正文称谓 herdweb；
  6. `install.sh` 整文件删除（remobi.app 一键安装属上游基础设施）。
- **相关测试**：`pnpm test`（全量）。tsconfig include 引用的文件名变化不影响编译（include
  中其他条目仍匹配；显式文件名不存在时 tsc 不报错）。
- **跨发布边界不适用**：纯元数据字段变更，无 artifact 边界。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、
  `pnpm run build:dist`
- **截图或探活**：不需要。
- **现场还原**：停在卡分支；不改动主仓 checkout；无临时文件残留。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①package.json ②tsconfig+SECURITY ③删除 install.sh 至少 3 次提交。**
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言
  恒真性的红验，改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原
  刚改坏的那一处，禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
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
  - `origin/main` = `1f1265f`；工作区干净；本仓 remote =
    `git@github.com:zj1123581321/remobi.git`。
  - `package.json` 现状：`"name": "remobi"`、`"bin": {"remobi": "dist/cli.mjs"}`、
    `repository.url = git+https://github.com/connorads/remobi.git`（指向上游，错误）、
    homepage/bugs 同指上游。
  - `tsconfig.json` include 数组含 `"remobi.config.ts"`。
  - `SECURITY.md` 5 处 remobi 提法，披露邮箱 `security@remobi.app`（上游的）。
  - `install.sh` 13 处 remobi 提法，curl 源是 `http://remobi.app/install.sh`（上游域名）。
  - `.github/workflows/ci.yml` 无 remobi 字面量，不需要改。
- **已完成**：无（本卡全部待做）。
- **未完成**：本卡全部内容。
- **关键决策**：与 B/C 并行派发，零文件重叠；配置文件名 `herdweb.config.ts` 是与 B 卡的
  共享契约，双方独立实现，合并顺序任意。
- **已否决方案**：预写 GitHub 新地址（仓还没改名，会制造死链）；顺手修 release 机制
  （fork 决策已锁定现状）。
- **下一步唯一动作**：改 `package.json` 五个身份字段并提交。
