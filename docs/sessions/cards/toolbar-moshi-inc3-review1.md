# 任务卡：增量 3（单行 toolbar + 字号三件套）—— 独立 review 第 1 轮（全量审）

## 任务一句话

对 remobi 仓库一个已完成的特性 diff 做独立代码审查，产出 verdict 文件。你不改任何实现代码——**唯一允许的写入**是 verdict 产出文件。

## 审查对象（H0 冻结）

- 仓库：`/home/zlx/projects/oss/remobi-worktrees/remobi-20260818-03`（分支 `card/remobi-20260818-03`）
- diff 范围：**`81cb468..dc5c736`**（6 个 commit，18 文件，+515/−252）。只审这个范围；范围外存量问题记 backlog。
- `git diff 81cb468..dc5c736` 与 `git log 81cb468..dc5c736` 取审查对象。

## Spec（finding 必须溯源）

1. 任务卡规格（主脑拆卡，本 diff 的验收标准）：`/home/zlx/projects/oss/remobi/docs/sessions/cards/toolbar-moshi-inc3.md`（主仓绝对路径，不在本 worktree）。
2. 前序设计文档：`docs/designs/keyboard-sovereignty.md`（worktree 内）——键盘主权/逃生入口/横屏豁免（F1/V2）条款对本 diff 的迁移部分仍然有效。
3. 仓规 `AGENTS.md` + 反过度设计红线：禁 fallback/重试/防御式 try-catch（唯一批准例外：localStorage 读写的窄 try/catch，iOS 隐私模式已知平台行为）。

## 核心 spec 摘要

1. 单行 10 键默认（Esc/Ctrl(ctrl-modifier)/Tab/Prefix/↑/↓/Enter/Paste/⌨/☰More）；`defaultRow2=[]`；空行不渲染；被砍键全部进 drawer 保持可达。
2. 逃生入口注入点 row2→row1 末尾；可达性规则不变。
3. 横屏规则：只隐藏真正的第二行，单行不得整行消失；⌨ 恒豁免。
4. 默认字号 13；font-size action 写 `localStorage['remobi:fontSize']`；init 读 persisted > config。
5. drawer 内 font-size/help 不关闭 drawer，其他 action 维持关闭。

## 风险等级与纪律

- internal。P1 红线：数据丢失、静默出错、崩溃、越权。两问过滤（真实使用方式=单用户手机浏览器覆盖层）。
- 每条 finding 注明违反的 spec 条款；无法溯源默认降一级。
- 熵增审查必含：每个新增抽象/状态/配置项问「是不是熵 +1」。
- 降层检查点：①localStorage 写入失败/读到坏值的真实路径（坏值、超 sizeRange 值、隐私模式）；②单行化后横屏 CSS 选择器（`:not(:first-child):last-child`）在 row2 非空/为空两种 DOM 下的命中面；③drawer 连点改动后，原有「点 action 关 drawer」的键盘焦点/conditionalFocus 语义是否被破坏。

## 主脑已登记的待修/待议项（核实而非照搬）

- **pinch 手势改字号不持久化**（`src/gestures/pinch.ts` 直写 `term.options.fontSize`，不走 registry 的 changeFontSize）——与「字号持久化」用户目标不一致。请判定级别与修复方向（候选：pinch 结束时持久化一次，避免 move 期间频繁写）。
- `readPersistedFontSize` 不按 config `sizeRange` clamp——主脑判 P3，可异议。
- OCR 预扫结果若已附在卡尾，逐条核实。

## 验证命令（worktree 已 pnpm install）

`pnpm test`、`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run build:dist`、`pnpm run lint:knip`（需先 build:dist）、`pnpm run lint:publint`、`pnpm run lint:ox`、`pnpm run test:pw`（chromium；本机有模拟器争资源，偶发 flake 单跑复验）。

## OCR 预扫结果（status=reviewed，主脑已核实，供参考非结论）

8 条（1 medium / 7 low），无 P1/P2：

- [M6]+[L3] persisted 字号不按 sizeRange clamp（两处说的是同一条）——主脑原判 P3，现 OCR 重复命中，**列入待修**（一行 clamp，不新增机制）。
- [L0] localStorage 键字面量两处重复（registry 写 / index 读）——可抽共享常量，有真实第二调用方，**列入待修**（P3）。
- [L1] console.error variadic 风格、[L4]/[L5] 注释文风、[L7] Esc 缺 keyLabel、[L8] 位置型 CSS 选择器脆弱性——全部 P3 接受不修， reviewer 可异议。
- [L2] keepsDrawerOpen 谓词配置化——**明确否决**：无第二调用方， speculative generality 违反反过度设计红线。

## 产出（唯一允许的写入）

写到 worktree 内：**`docs/sessions/toolbar-moshi-inc3/reviews/inc3-review1-verdict.md`**（目录不存在则创建）。结构：verdict（pass/fail）→ P1 → P2/P3（逐条：位置、spec 条款、触发路径、证据）→ 降层检查点回答 → 熵增结论 → backlog。不 commit、不 push、不改实现/测试。

报告首行前恰好一行机读 outcome（HTML 注释，顶格，二选一）：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```
