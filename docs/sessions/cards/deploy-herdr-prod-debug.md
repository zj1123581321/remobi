# 任务卡：把 herdr 生产/调试部署契约收进 remobi 仓

## 目标

`herdr.zlxlabs.com` 生产和 Tailscale 调试的 systemd、启动脚本、暴露检查、runbook 归本仓所有。Agent Config 不再持有运行时。本机现场已经在 7681=default、7691=remobi-dev 上跑着；本卡只把契约落进 git，使 `install` 之后 reboot 仍是这套拓扑。

## 非目标

- 不改 overlay/ASR/toolbar 业务代码。
- 不改 Cloudflare Access / tunnel（已有 302 登录门）。
- 不改 Tailscale 现网（主脑已把 `/remobi` 指到 7691）。
- 不把 API key 写入 git。
- 不 enable 调试 unit。
- 不删 Agent Config 里的文件（另卡）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：350
- **Diff-Lines-Hard**：600
- **阶段**：implementing
- **锁定决策**：
  1. 生产 `systemd/remobi.service`：`--host 127.0.0.1 --port 7681`，禁止 `0.0.0.0`。`herdr --session default`。`WorkingDirectory=/home/zlx/projects/oss/remobi`。`ExecStart` 走本仓 `scripts/serve-prod.sh`（先确认当前分支是 `main`，否则 fail-loud），再 `pnpm exec tsx cli.ts "$@"`。PATH 用 fnm `aliases/default/bin` + `~/.local/bin`，禁止写 `node-versions/`。
  2. 调试 `systemd/remobi-debug.service`：无 `[Install]`。`--host 127.0.0.1 --port 7691 --base-path /remobi --config /home/zlx/projects/oss/remobi/.omo/remobi-debug.config.ts -- herdr session attach remobi-dev`。WorkingDirectory 同上。ExecStart 直接 `pnpm exec tsx cli.ts`（不要 serve-prod.sh，否则 worktree/非 main 调试起不来）。
  3. `scripts/install-prod.sh [--enable]` 只装生产 unit；`scripts/install-debug.sh` 只 install + daemon-reload，不 enable/start。
  4. 把 Agent Config 的 `scripts/herdr/check-remobi-exposure.sh` 与 `tests/herdr/test-remobi-exposure-check.sh` **迁过来**（可改路径为 `scripts/check-exposure.sh`、`tests/deploy/test-check-exposure.sh`），行为保持：未认证首页不得返回 remobi/xterm 特征、未认证 `/ws` 不得 101。
  5. runbook：`docs/deploy-herdr.md`。生产 URL `https://herdr.zlxlabs.com`；调试 `https://<tailnet>/remobi/` → 127.0.0.1:7691。写明禁止调试占用 7681。
  6. CLAUDE.md「Local Development」下加一小节 Production / Debug，只写命令与端口，不写密钥。
- **任务类型**：glue-scaffold
- **复杂度**：M
- **Base commit**：ce213f86086ae65b06f46073479a8eaf196d72e8
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（--class big）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 grok-lead

## 修改边界

- **允许**：`systemd/remobi.service`、`systemd/remobi-debug.service`、`scripts/serve-prod.sh`、`scripts/install-prod.sh`、`scripts/install-debug.sh`、`scripts/check-exposure.sh`、`docs/deploy-herdr.md`、`docs/decisions/2026-08-20-fork-herdr-focus.md`（仅可加一句部署落点）、`CLAUDE.md`、`tests/deploy/` 下新测试、`package.json` 仅当增加 `test:deploy` 脚本
- **禁止**：`src/`、`styles/`、`.github/`、`CHANGELOG.md`、`.omo/`
- **Scope-Globs**：systemd/remobi.service systemd/remobi-debug.service scripts/serve-prod.sh scripts/install-prod.sh scripts/install-debug.sh scripts/check-exposure.sh docs/deploy-herdr.md docs/decisions/2026-08-20-fork-herdr-focus.md CLAUDE.md tests/deploy/** package.json
- **高风险区域**：
  - 生产 unit 路径必须是主仓 `/home/zlx/projects/oss/remobi`，禁止 worktree 路径。
  - serve-prod.sh 的 main 检查用 `git symbolic-ref`，detached 要 fail-loud。
  - 暴露检查测试只打本地假服务器，禁止打真实 `herdr.zlxlabs.com` 把响应体打进日志。

## 完成条件

- **产物入库**：提交到 delegate 分配分支；报告贴 `git log --oneline -1` 与 `git show --stat --format= HEAD`。
- **行为验收**：
  - 生产 unit：127.0.0.1、7681、无 0.0.0.0、default session、serve-prod.sh。
  - 调试 unit：127.0.0.1、7691、base-path /remobi、remobi-dev、无 Install、无 serve-prod.sh。
  - `bash tests/deploy/test-prod-unit.sh`（或同等路径）与 debug/exposure 测试绿。
  - `pnpm run check` 若碰到新 md/json 也要绿。
- **相关测试**：本卡新增的 deploy shell 测试。
- **提交纪律**：①scripts+units ②tests ③docs/CLAUDE。
- **红验安全**（固定条款，原样保留）：改坏前先 commit；还原只许还原刚改坏的那一处。
- **反熵条款**（固定条款，原样保留）：不要第三套启动器；不要 REMOBI_USE_FORK（那是 agent-config 路径闸的权宜，本仓不需要）。
- **执行器自声明 outcome**（固定条款，原样保留）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- 现场：`remobi-prod-7681` → 127.0.0.1:7681 default；`remobi-debug-7691` → 127.0.0.1:7691 remobi-dev。
- Agent Config 仍有旧 npm remobi unit（enabled 但 inactive）。迁仓后由另一张卡删除。
- **下一步唯一动作**：落地 `scripts/serve-prod.sh` 与生产 unit。
