# 任务卡：弱网 T1 修复 1 — 写入路径不该沿用恢复期规则，恢复草稿不该开面板

## 目标

修掉主脑验收 T1 时实测复现的两条缺陷。两条同源：**「恢复（读）」的规则和副作用被带进了
「写入」和「呈现」路径**。

## 非目标

- 不改 T1 已经做对的部分：schema、key、写入时机、partial 不落盘、`pageshow` 的
  「textarea 非空就不覆盖」冲突规则、三类失败提示文案。
- 不实现 pending 的发送与确认（仍是 T4）。
- 不改 `autoEnter`、不改提交守卫、不碰 `src/client-entry.ts` / `src/session*.ts`。
- 不引入 store/repository 抽象。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：90
- **Diff-Lines-Hard**：220
- **阶段**：repairing
- **锁定决策**：
  1. **F1 修法**：`persistDraft()` 遇到 `readComposerStore()` 返回 `invalid` 时，
     **必须照常写入当前草稿**。理由：坏 JSON 里没有任何用户能手工抢救的东西，
     而「用户此刻正在打的长草稿」是活数据，优先级更高——本卡的整个存在理由就是它不能丢。
     同时把提示改成**说明真实后果**的那一句（见决策 3）。
     「不覆盖原值」这条规则**只适用于恢复路径**（`restoreDraft()`），
     写入路径不适用；卡面原文「绝不覆盖存储里的原值」写在决策 5「恢复失败」小节下，
     指的就是恢复期，是主脑当时没写清楚，不是你理解错。
  2. **F2 修法**：`restoreDraft()` **只负责恢复文本，不负责打开面板**——删掉里面的
     `setOpen(true)`。恢复后 composer 的开合状态保持原样（初始化时是关、
     `pageshow` 时是原来是开就开、是关就关）。
     理由：用户回到页面的第一件事是确认终端画面新不新鲜（这是整个弱网设计的第一条不变式），
     一刷新就被 composer 盖住终端与它直接冲突。草稿留在 textarea 里，
     用户点开 composer 就能看到，不会丢。
     注意 `resizeInput()` 仍要调用（textarea 高度要跟上恢复的内容），只是不改 open 状态。
  3. **提示文案**：坏数据场景现在有两种含义，要分开：
     - **恢复**时读到坏数据（`restoreDraft()`）：保持现有
       `Draft could not be restored; stored copy left untouched.`
     - **写入**时读到坏数据（`persistDraft()`）：改用
       `Draft storage was corrupt and has been reset; your text is saved.`
       ——必须让用户知道①旧的坏数据没了②当前文本已经存上了。
       不许继续用 `Draft could not be restored; …`，那句话会让用户以为"现在打的也在保存"，
       而实际上（修复前）根本没在保存。
  4. `clear()` / `resetDraft()` 的语义不变。`openComposer()` 不再 `resetDraft()` 这条**保持**
     （那是 T1 卡轴表要求的，主脑卡面里「现有 `open()` 语义不变」那句是自相矛盾的笔误，
     以轴表那一格「`open()` 打开 composer → 草稿不被清空」为准）。

- **任务类型**：frontend-ui
- **复杂度**：S
- **Base commit**：`152126d`（`card/wnet-t1` 当前 HEAD，即 T1 的产物）
- **Branch**：继续用 `card/wnet-t1`（本卡走 `delegate resume`，同一 worktree 续修）
- **Worktree**：`/home/zlx/projects/oss/remobi-worktrees/wnet-t1`
- **当前唯一写入者**：本卡执行器
- **执行器与模型**：codex（`delegate resume`，同一执行器第 1 轮修复）
- **计划者与审查者**：主脑 claude-opus5；review 按仓 `risk-tier: personal`。

## 修复卡必填

- **root_cause_group**：读路径的规则与副作用被复用到写路径 / 呈现路径。
  F1 是「恢复期的『不覆盖坏数据』被套进写入期」，F2 是「恢复数据顺手做了打开面板这个 UI 动作」。
- **introduced_by_commit**：
  - F1：`40ea80c feat(asr): persist composer draft schema`（引入 `persistDraft` 的 invalid 早退）
  - F2：`a9c4fff feat(asr): restore composer drafts on page return`（引入 `restoreDraft` 里的 `setOpen(true)`）
- **open_findings**：只修下面两条，不得超出。

### F1（P1，数据丢失）存储损坏后，用户后续打的字全部静默不落盘

`persistDraft()` 在 `readComposerStore()` 返回 `invalid` 时直接 `return`，不写入。

**主脑实测复现**（在 `card/wnet-t1@152126d` 上跑，探针已删）：

```
localStorage[remobi:composer:v1:/] = '{ corrupt json'
createAsrPreview() → 用户输入「用户回来后新打的一大段长草稿」→ dispatch('input')

  stored after typing = "{ corrupt json"          ← 用户打的字一个都没存进去
  visible message     = "Draft could not be restored; stored copy left untouched."
```

用户看到的提示只说"上次的恢复失败了"，于是以为当前草稿是安全的；实际刷新一次全没。
这跟本卡要消灭的失败模式**完全一样**，只是换了个触发前提。

### F2（P2，UX 回归）恢复草稿会强行弹开 composer 盖住终端

`restoreDraft()` 里的 `setOpen(true)` 会在初始化和 `pageshow` 时把面板打开。

**主脑实测复现**（同上）：

```
localStorage[remobi:composer:v1:/] = {"version":1,"draft":"上次留下的草稿","pending":null}
createAsrPreview()

  isOpen after init   = true
  element display     = flex                      ← composer 自动盖住终端
```

用户离开几十分钟回来，第一眼应该是终端画面（判断它新不新鲜），而不是一个弹出来的输入面板。

## 修改边界

- **允许**：
  - `src/controls/asr-preview.ts`
  - `tests/composer-draft.test.ts`
  - `tests/mic-controller.test.ts`
- **禁止**：其余全部，包括 `src/controls/mic-controller.ts` 的生产代码
  （`pageshow` 注册与 `onVisibilityChange` 的 baseDraft 保留都已验收通过，不要动）、
  `src/client-entry.ts`、`src/session*.ts`、`src/index.ts`、`styles/base.css`、
  `.github/`、`package.json`
- **Scope-Globs**：src/controls/asr-preview.ts tests/composer-draft.test.ts tests/mic-controller.test.ts
- **高风险区域**：
  - 修 F1 时**不要**顺手让 `restoreDraft()` 也去覆盖坏数据——恢复路径必须继续保留原值，
    两条路径的行为从此不同，这是有意的。
  - 修 F2 后要确认 `pageshow` 那条链仍然生效：composer **开着**时回到前台，
    草稿要能恢复进去（原来是开的就保持开）。

## 不变式轴表

轴：存储内容 × 触发路径 × composer 开合

| 存储内容 | 路径 | composer 原状态 | 期望 |
|---|---|---|---|
| 坏 JSON | 用户打字（写入） | 开 | **写入成功**，存储变成合法 `{version:1,draft:<新文本>,pending:null}`；提示 `Draft storage was corrupt and has been reset; your text is saved.` |
| 坏 JSON | 用户打字第二次 | 开 | 正常写入；不重复弹提示 |
| 坏 JSON | 初始化（恢复） | 关 | 存储原值**一字不改**；提示 `Draft could not be restored; stored copy left untouched.`；composer **保持关闭** |
| `{version:2,…}` | 用户打字（写入） | 开 | 同第一行（schema 不匹配等同坏数据） |
| `{version:2,…}` | 初始化（恢复） | 关 | 同第三行 |
| 合法且有 draft | 初始化（恢复） | 关 | textarea 恢复文本；composer **保持关闭**；`resizeInput()` 已按新内容跑过 |
| 合法且有 draft | `pageshow`，textarea 空 | 开 | textarea 恢复文本；composer **保持开启** |
| 合法且有 draft | `pageshow`，textarea 非空 | 开 | **不覆盖**；composer 保持开启 |
| 合法且有 pending | 用户打字（写入） | 开 | `pending` 原样保留 |
| getter/setItem 抛错 | 用户打字（写入） | 开 | 提示 `Draft is not protected on this device.`（不变）；textarea 内容保留 |

表驱动测试必须覆盖每一格。**「composer 开合状态」这一列必须有显式断言**
（`preview.isOpen()`），不能只断言文本——F2 就是因为没人断言它才漏掉的。

## 完成条件

- **产物入库**：提交到 `card/wnet-t1`；报告贴出 `git log --oneline -1` 与
  `git show --stat HEAD`（**不要用 `--format=` 空值那种写法**，你上一轮已经证明它在本机
  git 版本会把 `HEAD` 当成 format 的值而报错；主脑已知悉，用等价命令即可）。
- **行为验收**：
  1. 存储被塞坏 JSON → 打字 → 刷新 → **草稿还在**（这是修复前做不到的）。
  2. 有草稿时刷新页面 → 先看到终端，composer **没有**自动弹出；点开 composer 草稿在里面。
  3. composer 开着时切后台再回来 → 草稿仍在，面板仍开。
- **相关测试**：`pnpm test` 全量绿（禁止 `-k` 子集）。轴表每格有断言。
- **跨发布边界验收**：仍然断言**实际写入 localStorage 的字符串**（`JSON.parse` 后逐字段比对），
  F1 的那一格尤其要断言"坏值已被合法 JSON 取代且 draft 等于用户输入的原文"。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **现场还原**：停在 `card/wnet-t1`；不要动主仓 checkout。
- **提交纪律**（固定条款，原样保留）：必须在本卡分支上小步 commit，未提交的工作按未完成处理。
  **本卡按 ①F1 写入路径 + 新提示文案 ②F2 去掉 setOpen ③轴表补齐 isOpen 断言 三次提交。**
- **红验安全**（固定条款，原样保留）：红验前先 commit 已验证的真修复；还原只还原改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：不新增抽象；说不出第二个消费者就撤。
- **执行器自声明 outcome**（固定条款，原样保留）：报告首个二级标题之前恰好一行：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

## 当前状态

- **已完成**：T1 主体已验收通过——schema、key、写入时机、partial 不落盘、
  `pageshow` 冲突规则、存储不可用的三处 catch 与单次提示、`open()` 不再清草稿、
  `onVisibilityChange` 保留 baseDraft，主脑都逐条核对过 diff 且全量 670 测试绿。
- **未完成**：上面两条 finding。
- **关键决策**：本轮走 `delegate resume` 由同一执行器续修，保留上下文。
- **下一步唯一动作**：先修 F1 的写入路径并让轴表第一行有断言。
