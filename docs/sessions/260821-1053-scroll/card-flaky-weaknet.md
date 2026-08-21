# 任务卡：诊断并修掉 webkit-iphone 弱网 e2e 的时序 flaky

## 背景与证据

`tests/playwright/weak-network.spec.ts` 在 `webkit-iphone` project 上随机失败，
已确认是**既有 flaky**，与任何具体改动无关。证据：

| 场景 | 失败的测试 | 该提交是否含相关改动 |
|---|---|---|
| PR #27 首次 | `:163` offline event invalidates an OPEN socket（Expected 2, Received 3）| 只改了一个滚动配置默认值 |
| PR #27 重跑 | `:93` plain page load constructs exactly one terminal WebSocket（Expected 1, Received 2）| 同上 |
| **主干 `623ab05`** | `:163`（同 PR #27 首次）| **只加了 `spikes/` 与 `docs/`，零生产代码** |
| PR #27 第三次重跑 | 全绿 | — |

主干在没有任何相关改动的提交上红在同一个测试，而同一个 PR 两次失败命中不同测试——
这是 flaky 的确证，不是回归。

主干最近 12 次 CI 有 2 次 failure，全部落在这个 spec。

## 目标

先**定位根因**，再修。两次失败的共同形态是「多了一个」——多一帧、多一个 WebSocket，
指向同一类时序竞态。要求给出根因判断再动手，不要直接加 `waitForTimeout` 糊过去。

## 已知线索

- `src/client-entry.ts` 的 `HEARTBEAT_INTERVAL_MS = 10_000`：若测试执行跨过心跳周期，
  离线期间可能多出一帧，正好对应 `:163` 的「Expected 2, Received 3」
- `:93` 断言的双连接问题正是 PR #19（`fix(client): stop building a second WebSocket
  on every page load`）修过的；在 webkit 上又冒出来，怀疑
  `pageshow` / `visibilitychange` / `freeze` / `resume` 在 webkit 的派发时序与
  chromium 不同，`queueImmediateConnect` 的去重条件在该时序下不成立
- 相关实现集中在 `src/client-entry.ts` 的 `onPageShow` / `onVisibilityChange` /
  `queueImmediateConnect` / `connect`

## 要求

1. **先诊断**：在报告里写清根因——是测试断言没排除心跳帧（测试侧问题），
   还是客户端在 webkit 时序下真的会建第二条连接（生产侧问题）。
   两者的修法完全不同，判断错了修了也白修。
2. **按根因修**：
   - 若是测试侧：让断言排除心跳/非输入帧（例如按帧内容过滤，而不是数总数），
     或把测试从心跳周期的时序耦合中解出来。**不许用 `waitForTimeout` 拖时间掩盖。**
   - 若是生产侧：那是真 bug（用户在手机上息屏再唤醒就可能撞上），
     按最小改动修 `src/client-entry.ts`，并补一条能在 CI 稳定复现的回归测试。
3. **证明修好了**：不能只跑一次绿就宣称修复。要求**连续跑同一 spec ≥10 次全绿**
   （`pnpm exec playwright test --project=webkit-iphone tests/playwright/weak-network.spec.ts --repeat-each=10`
   或等价方式），并在报告里贴出汇总结果。
   若本机缺 webkit 系统依赖（`libavif16` / `libwoff1` 等）导致跑不了，
   **在报告里明说跑不了**，不要用单次 CI 绿冒充稳定性证明。

## 非目标

- 不改滚动相关任何代码（`src/gestures/**`、滚动配置）——另有卡在并行修改这些文件。
- 不重写整个 spec，不引入新的测试框架或辅助层。
- 不为了让测试绿而放宽断言的约束力（例如把精确值改成范围）——
  那等于把 flaky 变成永久失明。

## 基线与所有权

- **Task-Id**：
- **Verify-Command**：pnpm test && pnpm run check && pnpm exec tsc --noEmit
- **Diff-Lines-Target**：250
- **Diff-Lines-Hard**：500
- **阶段**：debug
- **锁定决策**：
  1. 先给根因判断，再改代码。
  2. 禁止 `waitForTimeout` 式掩盖。
  3. 禁止放宽断言。
- **任务类型**：debug
- **复杂度**：M
- **Base commit**：69db19e
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 创建
- **当前唯一写入者**：本卡执行器
- **执行器角色声明**（原样抄）：本会话就是执行器（implementer 角色），
  全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是
  委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑拆卡与验收

## 修改边界

- **允许**：`tests/playwright/weak-network.spec.ts`、`tests/playwright/`（辅助文件）、
  `src/client-entry.ts`（仅当根因确认在生产侧）、
  `tests/client-connection.test.ts`（仅当需要补单测回归）
- **禁止**：`src/gestures/**`、`src/config*.ts`、`src/types.ts`、`src/session*.ts`、
  `src/serve.ts`、`spikes/**`、`.github/workflows/`
- **Scope-Globs**：tests/playwright/** src/client-entry.ts tests/client-connection.test.ts
- **高风险区域**：`src/client-entry.ts` 的连接生命周期刚在 PR #17/#19 重构过
  （epoch 隔离 + freshness proof）。改动前先读懂 `currentEpoch` /
  `lastProvenFreshAt` / `queueImmediateConnect` 的既有不变式，
  不要为修 flaky 破坏它们——那会引入比 flaky 严重得多的问题。

## 完成条件

1. 报告里有明确的根因判断（测试侧 / 生产侧），并附支撑证据。
2. 按根因完成修复，未使用 `waitForTimeout` 掩盖，未放宽断言。
3. 稳定性证明：同 spec 连续 ≥10 次全绿的汇总输出；跑不了则明确说明原因。
4. 若判定为生产侧 bug，有一条回归测试锁死，且该测试在修复前必须失败
   （**贴出反证输出**）。
5. `pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit` 全绿。

## 提交与 PR

- 小步提交；分支即开 draft PR，commit 即 push。
- 归因 trailer 由 hook 自动注入，不要手写。
