# 任务卡：Mic 按钮从 hold-to-talk 改为 tap-to-toggle（moshi 式）

## 背景

remobi ASR 语音输入（增量 2，分支 `card/remobi-20260819-14`，worktree
`/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14`）真机实测发现：toolbar 里的
Mic 按钮**无法长按**——按钮在横向可滚动的 toolbar 内，CSS `touch-action: manipulation`
允许浏览器把手势判给滚动，手指微动即 `pointercancel` 取消录音。

设计裁决：移动端 web 上 tap 是唯一被平台契约保证的手势；且语音指令时长常达 10–60s，
hold-to-talk 模型（对讲机）与已有的 preview 确认模型（先录后审）不自洽。参照 moshi 的
「点击说话」，将交互从按住说话改为点按开关。

## 工作目录与分支

- 在 worktree `/home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14` 工作（已 checkout
  `card/remobi-20260819-14`），改动 commit 后 push 到同名远程分支（PR #8 会随之更新）。
- 该 worktree 有一个正在运行的 dev server（`tsx cli.ts serve --port 7691`），不要杀它；
  改完代码在报告里注明「需重启 7691 serve 生效」即可，主脑会处理。
- commit 遵循 Conventional Commits：`feat(asr):` 前缀合适（消费者可见的行为变更）。
- push 时若被 pre-push ownership 闸拦截，按提示用 `CC_PRE_PUSH_OWNERSHIP_ACK` 放行自己产生的 commit。

## 目标行为

Mic 按钮交互改为 tap-to-toggle：

- `idle` 态 tap → `permission-requesting` → `connecting` → `recording`（沿用现有引擎启动链路）
- `recording` 态 tap → `stopping` → `waiting-final` → `preview`（沿用现有停止/收尾链路）
- `permission-requesting` / `connecting` 态再 tap → 取消本次会话（等价现有 pointercancel 路径的语义，文案改为「Recording cancelled.」类）
- preview / error 态下 tap Mic 按钮不启动新会话（维持现状：必须先确认或取消 preview）

## 具体改动要求

1. `src/controls/mic-controller.ts`：
   - 删除 `HOLD_THRESHOLD_MS`、`holdTimer`、`activePointer`、pointer capture
     （`setPointerCapture`/`releasePointerCapture`）、`pointercancel` 处理，以及
     「Hold the microphone button for at least 300 ms.」文案。
   - `attach()` 不再绑 pointerdown/up/cancel，改用项目现有的 `onTap` util
     （`src/util/tap.ts`，iOS Safari 兼容的 touch+click 封装）分发 tap。注意与
     `src/controls/keyboard-controller.ts` 的 touchend focus-steal guard 共存——参考
     dpad 等 focus-safe 按钮的做法，Mic tap 不应把焦点抢走导致软键盘弹收异常。
   - `pointerDown` → `startSession`（tap 触发），`pointerUp`/`pointerCancel` 删除或合并为
     `tapToggle`：`recording`→停；`permission-requesting`/`connecting`→取消。
   - `aria-label` 改为 `Tap to speak`；保留 `aria-pressed` 与 `wt-mic-recording` class 切换。
   - 中断处理（`visibilitychange`、`audio-interrupted`、断线 preview 保留文本）全部保留不动。
2. `styles/base.css`：确认 recording 态有足够辨识度（红色/脉动均可，沿用现有
   `wt-mic-recording` 样式若已存在则检查其可见性；无则补一个简洁的红色态）。
3. 测试（happy-dom 单测为主）：
   - 更新/重写 `tests/` 下 mic-controller 相关测试到 tap 模型：tap 开录、recording 态
     tap 停止、connecting 态 tap 取消、preview 态 tap Mic 无效果、中断取消仍生效。
   - 若存在引用 hold/pointer 语义的 e2e（`tests/playwright/`），同步更新。
4. 文档：设计文档 `docs/designs/asr-voice-input.md` 中描述 hold-to-talk/PTT 的段落
   更新为 tap-to-toggle 模型（含改动理由一句话：移动 web 长按与滚动手势冲突）。

## 约束

- 新增行数预算 ≲450 行（含测试）。超限先停手报告，不自行扩卡。
- 禁引入与本次改动无关的重构；引擎（`src/asr/`）不动。
- fail fast：不新增防御式 try-catch。
- TypeScript strict，无 `any`（既有 oxlint-disable 桥接模式可沿用）。

## 验证命令（全绿才算完成）

```bash
cd /home/zlx/projects/oss/remobi-worktrees/remobi-20260819-14
pnpm test && pnpm run check && pnpm run lint:ox && pnpm run lint:knip
pnpm run test:pw -- --grep -i mic   # 若有 mic 相关 e2e；无则跳过并说明
```

## 报告要求

- 改动文件清单 + 行数统计（git diff --stat）
- 上述验证命令的实际输出结论
- 状态机改动前后对照（一段话即可）
- 遗留风险或未覆盖点
