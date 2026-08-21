# 任务卡：Spike — 验证能否从服务端帧差分重建 herdr 的 scrollback 历史

## 目标

产出一份 **GO / NO-GO 证据**，回答一个问题：

> remobi 服务端的 xterm headless mirror 看到的是 herdr 的 alternate-screen ANSI 流。
> 能否通过「逐帧比对屏幕内容、检测整体上移」被动重建出滚出屏幕的历史，
> 且做到**零错误插入**？

结论决定增量 2 走哪条路：GO → 实现服务端影子历史 + 客户端原生滚动层（真正跟手）；
NO-GO → 降级为翻页式滚动（消卡顿但不跟手）。

背景与两条路的完整设计见 `docs/designs/mobile-scroll-experience.md`（本 worktree 内，**动手前必读**）。

## 非目标

- **不实现**影子历史功能本身，不碰任何生产代码。
- 不改协议、不改客户端。
- 不追求重建完整历史，只求判定「算法是否可靠」。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && test -f docs/sessions/260821-1053-scroll/spike-scrollback-evidence.md
- **Diff-Lines-Target**：500
- **Diff-Lines-Hard**：800
- **阶段**：planning
- **锁定决策**：
  1. 只做被动观察，**禁止**向 herdr 注入按键去刮取历史（会污染用户会话状态）。
  2. 保守原则：帧间对不齐就不追加历史。宁可漏，不可错插。
  3. 本卡不改生产代码，只产出 `spikes/` 下的探针与证据文档。
- **任务类型**：debug
- **复杂度**：M
- **Base commit**：e39b206
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 创建
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：按 envelope 实际值回填
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`spikes/scrollback/`（新建目录，探针脚本与临时产物）、
  `docs/sessions/260821-1053-scroll/spike-scrollback-evidence.md`（新建，证据文档）
- **禁止**：`src/**` 全部、`tests/**` 全部、`styles/**`、`.github/workflows/`、
  `docs/designs/mobile-scroll-experience.md`（主脑产物）。本卡一行生产代码都不改。
- **Scope-Globs**：spikes/scrollback/** docs/sessions/260821-1053-scroll/spike-scrollback-evidence.md
- **高风险区域**：**绝对不要 attach 或干扰用户当前正在运行的 herdr 会话**。
  当前会话 workspace 是 `w15`，主脑正在里面工作。必须用独立 session 名
  （例如 `herdr --session spike-scrollback`），跑完用 `herdr session` 相关命令清理掉。
  误操作会打断主脑会话。

## 探针设计

### 步骤

1. **确认 alternate screen**：用 node-pty 起一个独立 herdr 会话，抓原始 ANSI 流，
   grep `\x1b[?1049h`。记录 herdr 是否使用 alternate screen（这是「alternate buffer
   无 scrollback」这一硬约束是否成立的前提）。

2. **搭重放管线**：把抓到的 ANSI 流喂给 `@xterm/headless` 的 `Terminal`
   （与 `src/session.ts:102` 同样的配置：`scrollback: 5000`），
   每次 `write()` 完成后读取 `term.buffer.active` 的全部行
   （`buffer.getLine(i)?.translateToString(true)`），得到帧序列。

3. **实现差分对齐算法**：对相邻两帧 `prev` / `curr`，寻找最小 `n > 0` 使得
   `curr[0..k] === prev[n..n+k]`（k 取足够大，建议至少 rows/2 行且允许尾部空行不参与比较）。
   命中则判定「上移 n 行」，把 `prev[0..n-1]` 追加进影子历史；对不齐则不追加。

4. **确定性取证**：在 herdr pane 里跑 `seq 1 5000`（输出 5000 行已知内容），
   跑完后检查重建出的影子历史。

   **硬判据**：重建历史中的数字行序列必须是 1..N 的**严格连续递增**，
   允许首尾截断，**不允许中间缺行、重复行、错序**。

5. **干扰场景取证**：在同一会话上依次做以下动作，每次都检查影子历史是否被污染：
   - 切换 tab（`herdr tab` 相关命令）
   - 终端 resize
   - pane split
   - 运行一个全屏 TUI（如 `htop` 或 `less` 某文件）后退出

   **硬判据**：这些动作**不得**向影子历史插入任何非滚动内容（零错误插入）。
   漏记历史可以接受，错插不可以。

6. **真实负载取证**：跑一段真实的 agent 输出（≥5 分钟连续输出即可，
   例如 `find / -type f 2>/dev/null | head -20000` 这类持续滚屏），
   记录重建历史的行数、检测到的滚动事件数、对不齐（跳过）的帧数占比。

### 产出

- `spikes/scrollback/` 下的探针脚本（可重跑，带 README 说明怎么跑）
- `docs/sessions/260821-1053-scroll/spike-scrollback-evidence.md`，必须包含：
  1. **GO / NO-GO 结论**，写在文档第一行
  2. herdr 是否用 alternate screen（附抓到的证据）
  3. 步骤 4 确定性取证的结果：重建行数、是否严格连续、有无缺/重/错序
  4. 步骤 5 每个干扰场景的结果：有无错误插入（逐场景一行结论）
  5. 步骤 6 真实负载的统计：滚动事件数、跳过帧占比
  6. **已知误判场景清单** —— 算法在哪些情况下会对不齐或判错
  7. 若 NO-GO，说明是哪一条判据没过、卡在哪

## 完成条件

1. 探针脚本可重跑，README 写明运行方式。
2. 证据文档六个必含项齐全，GO/NO-GO 结论明确（不许写「基本可行」这种模糊话）。
3. 每条结论都附可核对的数据或抓到的原始片段（截断展示即可，不要整段回显日志）。
4. 用户的 `w15` herdr 会话全程未被干扰；spike 用的独立 session 已清理。
5. `git status` 干净：除允许范围外无改动；`pnpm test` 仍全绿。

## 提交与 PR

- 小步提交。
- 分支即开 draft PR，commit 即 push。
- 归因 trailer 由 hook 自动注入，不要手写。
