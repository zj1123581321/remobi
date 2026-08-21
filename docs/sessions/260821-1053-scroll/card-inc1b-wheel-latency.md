# 任务卡：实测 herdr 的滚轮响应延迟与重绘饱和点

## 背景

移动端滚动引擎（`src/gestures/scroll.ts`）现在用 rAF 驱动，**每帧发一次**滚轮序列，
在 60Hz 屏上即每秒 60 次。真机实测反馈：手指拖动时比例正常，但**松手后的惯性阶段
一卡一卡**。

怀疑发送频率高于 herdr 的重绘吞吐，请求堆积后被合并，画面更新变得不规则。
（旧实现是 24ms 限流 ≈ 41 次/秒，新实现 60 次/秒，涨了约 46%。）

**先测再改**：上一次拍 tmux 惯例值把 `linesPerWheel` 猜成 3、实际是 1，错了 3 倍。
herdr 的行为不靠猜。

## 目标

产出一份数据，回答：**惯性阶段应该以多高的频率发送滚轮事件？**

判据是「输出间隔最平稳」而不是「吞吐最大」——用户感知的卡顿来自画面更新的**不规则**，
不是来自滚得慢。

## 非目标

- **不改任何生产代码**。本卡只产出探针与证据文档。
- 不实现节流本身（那是下一张卡，依据本卡数据）。
- 不碰 `spikes/scrollback/` 既有文件（只读复用其导出）。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && test -f docs/sessions/260821-1053-scroll/wheel-latency-evidence.md
- **Diff-Lines-Target**：400
- **Diff-Lines-Hard**：700
- **阶段**：planning
- **锁定决策**：
  1. 复用 `spikes/scrollback/lib.mjs` 的 `startCleanSession` / `HerdrCapture` /
     `teardown` / `ptyEnv`，不重写 herdr 会话管理。
  2. 会话隔离沿用既有机制（`HERDR_SOCKET_PATH` 指向 spike 专用 socket）。
  3. 只测量、不优化。
- **任务类型**：debug
- **复杂度**：M
- **Base commit**：bdfa7e4
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 创建
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`spikes/wheel-latency/`（新建目录）、
  `docs/sessions/260821-1053-scroll/wheel-latency-evidence.md`（新建）
- **禁止**：`src/**` 全部、`tests/**` 全部、`styles/**`、`.github/workflows/`、
  `spikes/scrollback/**`（只读复用，不修改）
- **Scope-Globs**：spikes/wheel-latency/** docs/sessions/260821-1053-scroll/wheel-latency-evidence.md
- **高风险区域**：**绝对不要触碰用户正在使用的 herdr 会话**。用户当前在 `default`
  会话的 `w15`，另有 `remobi-dev` 会话正被 remobi debug 服务占用。必须用独立 session
  名（例如 `spike-wheel`）并把所有 herdr CLI 调用钉在该 session 的 socket 上，
  跑完清理。

## 测量设计

### 准备

1. 用独立 session 起 herdr（node-pty，80×24 或与真机相近的尺寸）。
2. 在 pane 内跑 `seq 1 500` 之类填满 scrollback，使 pane 处于**可向上滚动**状态
   （否则滚轮事件不产生重绘，测出来全是 0）。**必须先验证这一点**：
   发一个滚轮事件确认确实有输出，再开始正式测量。

### 指标一：单次滚轮的响应延迟

发送单个 SGR 滚轮序列 `\x1b[<64;40;12M`，记录发送时刻到**首个** PTY 输出事件的时间差。
两次发送之间留足静默期（≥300ms）确保不互相干扰。重复 ≥50 次，报 p50 / p90 / p99 与最大值。

### 指标二：发送频率 → 有效重绘频率（核心）

对每个目标发送频率 `f ∈ {120, 60, 40, 30, 20, 15, 10}` Hz：

- 以该频率持续发送滚轮序列 **3 秒**
- 统计：实际发送次数、PTY 输出事件次数、输出总字节数
- 计算**有效重绘频率** = 输出事件次数 / 时长
- 计算**输出间隔的均值与标准差**（抖动），这是与「一卡一卡」最直接对应的量

**关键产出：饱和点** —— 发送频率超过某个值后有效重绘频率不再增长，说明 herdr 已饱和，
多发的请求只会堆积。

### 指标三：每次重绘的字节量

指标二各频率下，报每个输出事件的字节数分布（p50 / p90 / max）。
用于判断回传体积是否也是瓶颈之一。

### 推荐值

综合三项，给出一个**推荐的惯性期发送频率**，并写明推荐依据是哪一项数据。
判据优先级：输出间隔抖动最小 > 有效重绘频率不明显损失。

## 完成条件

1. 探针可重跑，带 README 说明运行方式，与 `spikes/scrollback` 的用法风格一致。
2. `docs/sessions/260821-1053-scroll/wheel-latency-evidence.md` 包含：
   - **推荐的惯性期发送频率，写在第一行**，并注明依据
   - 指标一的延迟分位数表
   - 指标二的频率扫描表（发送频率 / 有效重绘频率 / 间隔均值 / 间隔标准差）
   - **饱和点在哪**，以及超过饱和点后多发的请求去了哪里（合并？排队？丢弃？）
   - 指标三的字节量分布
   - 测量的已知局限（本机 vs 真机、node-pty vs 浏览器 WebSocket 链路的差异）
3. 数据来自真实运行，不得估算或外推；每张表注明样本量。
4. 用户的 `default`（w15）与 `remobi-dev` 两个 herdr 会话全程未被触碰；
   spike 用的独立 session 已清理。
5. `git status` 干净（除允许范围外无改动），`pnpm test` 仍全绿。

## 提交与 PR

- 小步提交；分支即开 draft PR，commit 即 push。
- 归因 trailer 由 hook 自动注入，不要手写。
