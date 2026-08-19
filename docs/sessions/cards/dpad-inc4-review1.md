# 审查卡：增量 4 独立 review（第 1 轮）

## 任务

**先读 `/home/zlx/projects/personal/agent-config/claude/skills/review-discipline/SKILL.md`**（评审纪律：P1/P2/P3 分级、收敛规则、熵增维度），再开始审查。

对 remobi 增量 4 的 diff 做独立代码审查。**只审 `955a900..bea80cc`**（H0 冻结：审查对象固定为该 SHA 范围，禁止用分支名；审查中出现的新提交不属于本轮）。

```bash
cd /home/zlx/projects/oss/remobi-worktrees/remobi-20260819-01
git log 955a900..bea80cc --format='%h %s'
git diff 955a900..bea80cc
```

## 项目与风险等级

remobi：手机浏览器控制 tmux/herdr 终端的 web overlay。纯 TypeScript + DOM API 无框架；浏览器端 overlay 由 esbuild 打包，Node 服务端 Hono + node-pty。**风险等级：personal**（自用单机工具；P1 红线 = 数据丢失、静默出错、崩溃）。安全/并发类意见若无不可信输入路径一律 ≤P2。

## 本次 diff 的 spec（验收基准）

增量 4 目标：
1. **悬浮 d-pad**：toolbar 新增 ✥ `dpad-toggle` 键切换浮窗显隐；浮窗六键 ←↑↓→⌫⏎（3×3 簇状排布，moshi 参照），发送字节分别为 `\x1b[D \x1b[A \x1b[B \x1b[C \x7f \r`。
2. **toolbar 默认 row1 收为 7 键**：Esc / C-c / Tab / ⏎ / ✥ / ⌨ / ☰More。↑↓ 移出 row1，进 drawer 默认列表兜底（drawer 29 键）。⏎ 保留在 toolbar。
3. **drawer × 关闭按钮**：把手区右侧可见 ×（≥44px 触摸目标），点按关闭；现有 backdrop 点按与把手下滑关闭保留。

关键不变式：
- `dpad-toggle` 是 ButtonAction discriminated union 新成员（`src/types.ts` + `src/config-schema.ts` valibot + `src/actions/registry.ts` dispatch），DI 模式同 keyboard-toggle（`context.toggleDpad ?? deps.toggleDpad`），缺失时 fail-loud（console.error + throw）。
- **焦点安全（硬要求）**：d-pad 六键不得抢终端 textarea 焦点、不得改变 manual 键盘锁定状态；实现为 touchend preventDefault 抑制合成 mousedown，且与 keyboard-toggle 共用同一 helper `suppressSynthesisedMouse`（`src/controls/keyboard-controller.ts`），禁止双路径。
- d-pad 发送走 `sendData(term, …)`（term.input 路径）；浮窗默认隐藏；z-index 低于 drawer backdrop(10000) 高于终端；触摸目标 ≥48px。
- 服务端（`src/serve.ts`/`src/session.ts`/`src/session-protocol.ts`）零改动；CHANGELOG.md 不在 diff。

非目标（不应出现在 diff）：浮窗拖动/位置配置、🧹清屏键、⏎ 移出 toolbar。

## 已知背景（中性事实）

- `onTap`（`src/util/tap.ts`）是仓内统一的 touch+click 封装（iOS Safari 兼容）。
- 既有约定：overlay 直接挂 `document.body`，不处于任何 form 内；toolbar/drawer 既有按钮均未设 `type="button"`。
- OCR 预扫已跑（4 条：1 条实为无问题备注；按钮 type 与 CSS margin 两条已被主脑判拒——理由如上既有约定与反过度设计；drawer 关闭逻辑重复一条已登记待修）。reviewer 仍全量审 diff，不受此清单限制。

## 审查要求

- 每条意见注明「违反 spec 哪条/哪个不变式」；无法溯源到 spec 的意见默认降一级（命中 personal 档 P1 红线的除外）。
- 与 README/spec 明文契约冲突的意见须先举证契约本身有问题，否则不成立。
- 只审本次 diff；存量代码问题记 backlog 不占循环。
- 熵增维度：对 diff 中每个新增抽象/文件/状态/配置项问一遍「是不是熵 +1」（单实现接口、转发层、无第二消费者的通用化）。
- 意见分级 P1/P2/P3 + backlog，给 verdict（approve / changes_requested）。

## 产出（完成条件）

verdict 写入 `/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-01/docs/sessions/260819-dpad-inc4/reviews/dpad-inc4-review1-verdict.md`（目录不存在则创建）。**只允许新增该一个文件**，禁止改动仓内任何其他文件（只读审查）。报告首行前恰好一行 `<!-- delegate-outcome: succeeded -->` 或 `<!-- delegate-outcome: failed -->`。该值描述的是执行器本次任务是否完成，与 review 的 pass/fail verdict 正交。

## 基线与所有权

- **Task-Id**：
- **任务类型**：review
- **执行器角色声明**：本会话就是执行器（implementer），全局 AGENTS.md「模型编排」段的主代理委派纪律不适用于本卡。
- **当前唯一产出写入**：上述 verdict 文件；代码区只读。
