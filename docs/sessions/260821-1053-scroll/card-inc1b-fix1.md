# 任务卡：修复探针的环境泄漏，并改掉一条站不住的推荐依据

## 说明

测量数据本身可信——主脑独立复现过，结构性指标完全对得上（饱和上限 56-58Hz、
1:1 边界 40Hz、>40Hz 开始合并）。本卡处理的是两个**方法层**问题。

## 修复卡必填

- **root_cause_group**：F1 是「用白名单枚举去覆盖一个开放集合」；F2 是「把单次运行的
  噪声读成信号」。
- **introduced_by_commit**：F1 存在于 `spikes/scrollback/lib.mjs`（已在主干）并被
  `spikes/wheel-latency/lib.mjs` 复用；F2 为 `a70c119`。
- **open_findings**：F1 / F2。修复不得超出这两条。

## 待修 findings

### F1（P1）：`ptyEnv` 的清理清单漏了 `HERDR_ENV`，探针在 herdr pane 内无法启动

`spikes/scrollback/lib.mjs` 的 `NESTED_MUX_ENV_VARS` 枚举了 `TMUX` / `TMUX_PANE` /
`ZELLIJ` / `ZELLIJ_PANE_ID` / `ZELLIJ_SESSION_NAME` / `HERDR_SESSION` /
`HERDR_SOCKET_PATH` / `HERDR_PANE_ID` / `HERDR_TAB_ID` / `HERDR_WORKSPACE_ID`，
**唯独漏了 `HERDR_ENV`**。

实测复现（主脑执行）：

- 在 herdr pane 内直接跑 `node spikes/wheel-latency/probe.mjs run` → 连续两次
  `Error: timeout waiting for herdr alternate screen enter`，探针根本起不来
- 同一命令加 `env -u HERDR_ENV` → 完整跑通，产出全部三项指标

**这个缺陷有个危险性质：它只在特定运行环境发作。** 派发执行器跑在 systemd 单元里，
环境干净，所以「探针可重跑」这条完成条件在你那边是真的通过了；而人工复核在 herdr
pane 内进行，必然失败。参见 `core.md`「环境依赖验证」：结论随运行上下文变化的探针，
必须在真实消费环境各跑一次。

**修法（换抽象层，不要继续枚举）**：把清理规则从「变量名白名单」改成
**前缀匹配**——凡以 `TMUX`、`ZELLIJ`、`HERDR` 开头的环境变量一律剥离。

理由：变量名是**开放集合**，herdr 将来新增任何 `HERDR_XXX` 都会再漏一次。逐个补名字
是穷举形态，前缀规则是一次性收口。这同时删掉了那份会持续腐化的清单，是做减法。

改在 `spikes/scrollback/lib.mjs`（`spikes/wheel-latency/lib.mjs` 复用其导出，无需改）。

**必须有测试锁死**：给 `ptyEnv` 喂一个同时包含
`HERDR_ENV`、`HERDR_SOCKET_PATH`、`HERDR_SOME_FUTURE_VAR`、`TMUX`、`TMUX_PANE`、
`ZELLIJ_SESSION_NAME` 以及 `PATH`、`HOME` 的对象，断言：
1. 六个复用器变量**一个都不剩**（尤其 `HERDR_SOME_FUTURE_VAR`——它锁的正是「前缀规则
   而非枚举」这个性质，用枚举实现必然漏掉它）
2. `PATH` / `HOME` 原样保留
3. `TERM === 'xterm-256color'`

这个测试**不依赖运行环境**，在 CI 里就能跑。放 `tests/` 下（`.ts` 可以 import `.mjs`）。
若这样做会触发 `lint:knip` 或 `lint:ox` 报错，在报告里说明具体报错，改为在探针内加
启动前自检（断言 `ptyEnv` 输出无复用器变量，否则 fail-loud），不要静默放弃校验。

### F2（P2）：证据文档的推荐依据是噪声，不是信号

`docs/sessions/260821-1053-scroll/wheel-latency-evidence.md` 第一行写着推荐 30 Hz，
依据是「≤40Hz 档位中输出间隔标准差最小，σ=2.0ms」。

主脑独立复现后，σ 在两次运行间完全不稳定：

| 发送 Hz | 首次 σ | 复现 σ |
|---|---|---|
| 120 | 3.0 | 2.9 |
| 60 | 3.4 | 4.1 |
| 40 | 4.3 | 5.5 |
| 30 | 2.0 | 3.1 |
| 20 | 3.1 | **6.3** |
| 15 | **5.3** | 3.9 |
| 10 | 2.5 | **6.4** |

σ 的大小排序整个被打乱（20Hz 翻倍、10Hz 涨 2.5 倍、15Hz 反而降低）。
把单次运行的最小值当选型依据，是把噪声读成了信号。

**修法**：推荐值**仍然是 30 Hz**（不要改推荐值），但把依据换成：

> 1:1 映射边界实测在 40 Hz（两次运行一致），30 Hz 相对该边界留约 25% 余量；
> 真机链路（WebSocket + Safari + xterm.js 渲染）比本机 node-pty 直连更长，
> 贴边界运行很可能越过饱和点。

同时在文档里**加一节「复现与稳定性」**，如实记录：
- 哪些指标两次运行一致（饱和上限 56–58Hz、1:1 边界 40Hz、>40Hz 合并比例）——**可信**
- 哪些指标不稳定（各档 σ）——**不可作为选型依据**
- 并注明第二次运行需要 `env -u HERDR_ENV`（即 F1 修复前的绕过方式）

## 非目标

- 不改推荐值 30 Hz 本身。
- 不实现发送节流（那是下一张卡）。
- 不碰 `src/**` 任何生产代码。
- 不重跑完整测量（已有两次运行的数据足够）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit && pnpm run lint:ox && pnpm run lint:knip
- **Diff-Lines-Target**：160
- **Diff-Lines-Hard**：320
- **阶段**：repairing
- **锁定决策**：
  1. F1 走前缀匹配，不许继续往白名单里加名字。
  2. F2 只改依据与新增「复现与稳定性」节，推荐值保持 30 Hz。
  3. 不碰生产代码。
- **任务类型**：debug
- **复杂度**：S
- **Base commit**：a70c119（本分支 HEAD，在其上追加提交）
- **Branch**：沿用 `card/remobi-20260821-06`
- **Worktree**：沿用 `/home/zlx/projects/oss/remobi-worktrees/remobi-20260821-06`
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`spikes/scrollback/lib.mjs`、`spikes/wheel-latency/`、
  `docs/sessions/260821-1053-scroll/wheel-latency-evidence.md`、
  `tests/`（仅新增 `ptyEnv` 的测试文件）
- **禁止**：`src/**` 全部、`styles/**`、`.github/workflows/`、其余既有 `tests/**` 文件
- **Scope-Globs**：spikes/scrollback/lib.mjs spikes/wheel-latency/** docs/sessions/260821-1053-scroll/wheel-latency-evidence.md tests/spike-pty-env.test.ts
- **高风险区域**：`spikes/scrollback/lib.mjs` 已在主干且被已合并的 scrollback 探针使用，
  改 `ptyEnv` 时确认 `spikes/scrollback/scenario.mjs` 的调用方式不受影响。

## 完成条件

1. `ptyEnv` 用前缀匹配实现，`NESTED_MUX_ENV_VARS` 白名单已删除。
2. 测试断言 `HERDR_SOME_FUTURE_VAR`（一个清单里绝不可能有的名字）也被剥离。
3. **反证**：把实现改回按固定名单枚举，第 2 条断言必须变红。
   **在报告里贴出反证的实际失败输出。**
4. 证据文档的推荐依据已替换，新增「复现与稳定性」节，推荐值仍是 30 Hz。
5. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
   `pnpm run lint:knip` 全绿。
6. 生产代码 `git diff` 为空。

## 提交与 PR

- 在现有分支追加提交，push 到同一 draft PR（#26）。
- 归因 trailer 由 hook 自动注入，不要手写。
