# 任务卡：弱网 T1 — 语音草稿持久化（长文本不静默丢失）

## 目标

让手机上敲了几分钟的长语音草稿，在刷新、`pagehide/pageshow`（含 bfcache）、断线、切网之后
**逐字还在**。当前 composer 的 draft 只活在 `asr-preview.ts` 那个 textarea 的内存里，
`reconnect.ts` 的"重连"是 `location.reload()`，一刷就全没了——这是设计文档三条用户可感知
不变式里的第二条「长语音草稿不会静默丢失」。

交付对象：用 herdr/remobi 在手机上语音驱动 coding agent 的人（就是本仓唯一用户）。

设计出处：`docs/designs/weak-network-experience.md` §2「草稿不丢」+ Implementation Tasks · T1。

## 非目标

- **不实现 pending action 的发送与确认**——那是 T4。本卡只把 `pending` 字段作为 schema 的一部分
  定死并**原样透传**，自己永远只写 `null` 或读到什么写回什么。
- 不改 WebSocket 协议、`src/client-entry.ts`、`src/reconnect.ts`、`src/session*.ts`。
- 不改 ASR 引擎 / PCM / AudioWorklet（`src/asr/` 整棵禁止）。
- 不修 `autoEnter` 当前"正文一次、`\r` 一次"的两次写（`mic-controller.ts:416-422`）——那是 T4。
  本卡只**锁死**「sanitize 后正文为空则整条不发送、也不发孤立回车」这条现有行为不回归。
- 不引入 IndexedDB、不新增 store/repository 类、不新增配置项、不做本地加密、不做多标签页协同。
- 不做草稿历史、不做多草稿、不做云同步。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：280
- **Diff-Lines-Hard**：520
- **阶段**：implementing
- **锁定决策**：

  1. **存储 key** 固定 `remobi:composer:v1:${basePath}`。origin 由浏览器隔离，basePath 用来区分
     生产 `/` 与调试 `/remobi/` 两个实例。basePath 取客户端已注入的那个全局值——读法照抄
     `src/client-entry.ts:19-23`（`__remobiBasePath ?? '/'`）。**不新增配置项、不新增函数参数
     去传它**；若 `src/controls/` 内确实拿不到该全局，就在 `src/index.ts` 现有 init 链路里读一次
     传进 `createMicController`，并在报告里写明为什么这是唯一可行路径。
  2. **schema 一次定死**（T4 不得再改格式）：
     ```ts
     type ComposerStore = {
       version: 1
       draft: string
       pending: null | {
         id: string
         sessionId: string
         sourceText: string
         data: string
         status: 'pending' | 'unknown' | 'rejected'
         reason?: string
       }
     }
     ```
     本卡写入时 `pending` 取「读到的原值」，读不到就 `null`。**禁止**因为本卡用不上就把
     `pending` 从 schema 里删掉——删了 T4 得改两遍格式，存量草稿会失配。
  3. **写入时机**（同步写，不做去抖/延迟落盘）：
     - 用户在 textarea 里打字（`input` 事件）；
     - ASR **final** 文本落进 draft（现有 `preview.show(text)` 路径）；
     - 用户显式清空 / 发送完成后清空（现有 `resetDraft()` / `clear()` 路径）。

     **partial（`setPartial`）中间结果不写**。理由写进报告：partial 走 rAF 每帧刷新，
     每帧同步写 localStorage 会阻塞主线程；partial 本来就已经在 `visibilitychange → hidden`
     时被 `cancelSession` 丢弃（`mic-controller.ts:449-455`），它不是用户手打的长草稿。
  4. **恢复时机与冲突规则**：
     - 初始化时（composer 创建，textarea 必为空）：从存储恢复 draft。
     - `pageshow` 事件（含 `persisted=true` 的 bfcache 恢复）：**只有当 textarea 当前为空时**
       才从存储恢复。textarea 非空说明内存态是更新的（bfcache 保留了它，或用户刚打完字），
       此时覆盖它就是数据丢失。这条不许改成"存储永远赢"。
  5. **恢复失败**（`JSON.parse` 抛错、不是对象、`version !== 1`、`draft` 不是 string）：
     - **绝不覆盖**存储里的原值（用户可能事后想手动抢救）；
     - textarea 保持当前内容不动；
     - 通过现有 `preview.showMessage(...)` 显示 `Draft could not be restored; stored copy left untouched.`
  6. **存储不可用**（取 `window.localStorage` 的 getter 抛 `SecurityError`、`getItem` 抛、
     `setItem` 抛 `QuotaExceededError` —— iOS 隐私模式与配额都真实存在）：
     - 走**同一条**可见失败路径，显示 `Draft is not protected on this device.`；
     - textarea 里的文本**照常保留**、照常可编辑、照常可发送；
     - 后续每次变化仍然尝试写（存储可能恢复），但**不要每次都重复弹提示**——同一 composer
       生命周期内提示一次即可，第二次起静默重试。
     - 现成的 try/catch 写法模板：`src/actions/registry.ts:85-98` 与 `src/index.ts:52-60`
       （`remobi:fontSize` 那套），照抄它的防御姿势，别另发明一套。
  7. **打开 composer 不清草稿**。现有 `open()` 语义不变。
  8. **sanitize 后为空不发送**（现有行为，本卡只加测试锁死，不许回归）：
     `mic-controller.ts:378-381` 的 `Type or speak something to send.` 与
     `mic-controller.ts:398-401` 的 `Speech contained no printable text.` 两条守卫都必须仍然
     `return`，因此 `autoEnter` 的 `\r` 也不会被发出去。轴表里每格都要有断言。

- **任务类型**：frontend-ui
- **复杂度**：M
- **Base commit**：ba25ddf9cc9d7de6d3288869ffed133e68c7b3bb（origin/main；若已前进，用新的 origin/main sha 作 base 并在报告写明）
- **Branch**：由 delegate 分配（`card/<worktree 名>`），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑会话只读；同批并行的 T2 卡只碰 `src/session*.ts`，与本卡零重叠）
- **执行器与模型**：codex（`delegate --class big`，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理
  委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——
  子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 claude-opus5 拆卡与验收；review 按仓 `risk-tier: personal`，
  P1 红线 = 数据丢失 / 静默出错 / 崩溃；收敛 = 连续 1 轮无新增 P1。
  **本卡核心就是"数据不丢"，草稿在任何一条路径上被静默清掉都是 P1。**

## 修改边界

- **允许**：
  - `src/controls/asr-preview.ts`
  - `src/controls/mic-controller.ts`
  - `src/index.ts`（**仅当**锁定决策 1 的兜底分支成立：把 basePath 传进 `createMicController`）
  - `tests/mic-controller.test.ts`
  - `tests/asr-preview.test.ts`
  - `tests/composer-draft.test.ts`（本卡可新增；也可以把用例并进上面两个文件，二选一）
- **禁止**：`src/asr/`、`src/session.ts`、`src/session-protocol.ts`、`src/serve.ts`、
  `src/client-entry.ts`、`src/reconnect.ts`、`src/types.ts`、`src/config.ts`、`styles/base.css`、
  `.github/`、`CHANGELOG.md`、`package.json`、`pnpm-lock.yaml`
- **Scope-Globs**：src/controls/asr-preview.ts src/controls/mic-controller.ts src/index.ts tests/mic-controller.test.ts tests/asr-preview.test.ts tests/composer-draft.test.ts
- **高风险区域**：
  - `mic-controller.ts` 的 `generation` 代际机制（`:106-114`、`canSendComposerText`）用于作废迟到
    的异步回调。持久化的写入点若挂在异步回调里，必须一起过 generation 检查，否则一个迟到的
    旧会话回调会把新草稿覆盖成旧文本——**这就是本卡的 P1 形态**。
  - `finishSend()`（`mic-controller.ts:172-180`）会 `generation++` 并 `resetDraft()`。它清 textarea
    的同时必须清存储 draft，否则下次刷新会把已发送的文本又变回草稿。
  - `startSession()`（`:307-318`）的 `baseDraft` 追加语义（`joinDraft`，`:81-87`）要保持：
    新一轮语音追加在既有 draft 之后，追加后的完整文本才是要落盘的 draft。
  - happy-dom 的 localStorage 是真实现，测 SecurityError 要用
    `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })`
    并在 afterEach 还原；模板见 `tests/font-persistence.test.ts`、`tests/action-registry.test.ts`。

## 不变式轴表

### 轴 1：存储可用性 × 存储内容 × 用户动作

| 存储可用性 | 存储内容 | 动作 | 检测点 |
|---|---|---|---|
| 正常 | 空 | 在 textarea 打字 | 写入 key `remobi:composer:v1:/`，**断言解析后的对象**为 `{version:1,draft:<原文>,pending:null}` |
| 正常 | `{version:1,draft:"长草稿",pending:null}` | 重新创建 composer（模拟刷新） | textarea 逐字等于 `"长草稿"` |
| 正常 | 同上 | `pageshow`，textarea 为空 | 恢复为 `"长草稿"` |
| 正常 | 同上 | `pageshow`，textarea 已有 `"更新的内容"` | **不覆盖**，textarea 仍为 `"更新的内容"` |
| 正常 | 有 draft | `open()` 打开 composer | 草稿不被清空 |
| 正常 | 有 draft | 用户显式清空（`resetDraft`/`clear`） | 存储 draft 变为 `""`，`pending` 原值保留 |
| 正常 | 有 draft | ASR final 落入 draft（`show(text)`） | 存储 draft = 追加后的完整文本 |
| 正常 | 有 draft | `setPartial("中间结果")` | 存储**不变**（partial 不落盘） |
| 正常 | `{version:1,draft:"x",pending:{id:"a",...}}` | 打字改 draft | 写入后 `pending` **原样保留**（本卡不碰它） |
| 正常 | `"{ 坏 JSON"` | 初始化 | 存储原值一字不改；textarea 保持空；显示 `Draft could not be restored; stored copy left untouched.` |
| 正常 | `{"version":2,"draft":"x"}` | 初始化 | 同上（version 不匹配） |
| 正常 | `{"version":1,"draft":123}` | 初始化 | 同上（draft 不是 string） |
| getter 抛 SecurityError | — | 初始化 | 显示 `Draft is not protected on this device.`；textarea 内容保留；不抛异常到调用方 |
| `getItem` 抛 | — | 初始化 | 同上 |
| `setItem` 抛 QuotaExceededError | — | 打字 | 同上；textarea 文本保留且仍可发送；**第二次打字不重复弹提示** |

### 轴 2：提交守卫 × autoEnter

| draft 内容 | sanitize 后 | `asr.autoEnter` | 检测点 |
|---|---|---|---|
| `""` | — | false | 不发送，显示 `Type or speak something to send.` |
| `""` | — | true | 同上，且**没有任何** `\r` 被发出 |
| `"\u0000\u007f"`（全不可打印） | `""` | true | 不发送，显示 `Speech contained no printable text.`，**没有孤立 `\r`** |
| `"hello"` | `"hello"` | false | 正常发送一次正文 |
| `"hello"` | `"hello"` | true | 现状保持（正文 + `\r` 两次写）——本卡不改，只确保不回归；T4 会把它并成一个 action |

表驱动测试必须覆盖上面两张表的每一格。现有 37 个 `mic-controller.test.ts` 用例必须全绿，
尤其 `:725`（断线保留 preview 且不入队）与 `:740`（after-send hook 期间断线阻断 autoEnter）。

## 完成条件

- **产物入库**：本卡产生的全部落盘产物均提交到 delegate 分配的 `card/<worktree 名>` 分支，
  验收以该分支上的提交为准；报告中贴出 `git log --oneline -1` 与
  `git show --stat --format= HEAD` 的实际输出。若 pre-commit 守卫拦下提交，处置权归主脑：
  执行器把守卫的完整报错原样贴进报告并就此停下，保留现场。
- **行为验收**：
  1. 在 composer 里输入 3 行中文长草稿 → 刷新页面 → 草稿逐字还在。
  2. 输入草稿 → 触发 `pageshow` → 草稿不被旧值覆盖。
  3. 存储被塞坏 JSON → 打开 composer → 看到恢复失败提示，且存储里的坏值原封不动。
  4. localStorage 被禁用 → composer 仍能正常打字和发送，只是多一条"未受保护"提示。
  5. 发送成功后草稿清空，刷新不会把已发送的文本变回草稿。
- **相关测试**：`pnpm test`（全量，禁止用 `-k` 子集代替）。轴表每一格都要有断言。
  另外 grep 一遍被改符号的引用并全跑：
  `grep -rn "resetDraft\|getText\|showMessage\|createMicController\|createAsrPreview" tests/ src/`
- **跨发布边界验收**：localStorage 是**真实的序列化边界**——存进去的是字符串，取出来要 parse。
  测试**必须断言实际写入 localStorage 的字符串内容**（`JSON.parse(localStorage.getItem(key))`
  后逐字段比对），不许只断言 `preview.getText()` 这类同进程返回值。只测内存态等于没测持久化。
- **接口契约**：
  ```ts
  // AsrPreview / MicController 的公开接口尽量不变。确需扩展时只允许这一种形状，
  // 且必须说得出第二个消费者（T4 会消费 pending 读写）：
  interface AsrPreview {
    // 现有成员全部保留语义不变
    // 若新增，只允许围绕 draft 持久化，不得引入通用 storage 抽象
  }
  ```
  **禁止**新增 `ComposerStore` / `DraftRepository` / `StorageAdapter` 之类的类或模块——
  设计文档明确写了「不新增单消费者 store 类」。读写就是 controller 内的两个私有函数。
- **lint / typecheck / build**：`pnpm run check`、`pnpm exec tsc --noEmit`、`pnpm run lint:ox`、
  `pnpm run lint:knip`、`pnpm run build:dist`
- **截图或探活**：不需要截图。但报告里必须贴一段**实际的 localStorage 内容**
  （测试中 dump 出来的 JSON 字符串），证明格式与锁定决策 2 一致。
- **现场还原**：停在卡分支；不要改主仓 checkout；不要提交任何 `remobi.config.local.ts`、
  密钥或 `/tmp` 探针。
- **提交纪律**（固定条款，原样保留）：执行器必须在本卡分支上小步 commit（署名/归因由
  delegate 自动注入），未提交的工作按未完成处理，不得把提交留给验收方。
  **本卡按 ①schema 读写 + 初始化恢复 ②pageshow 恢复与冲突规则 ③三类失败路径与提示
  ④轴表 2 的提交守卫测试 至少 4 次提交**，每次测试绿了就提交，不要攒到最后。
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

## 当前状态

- **现场事实（主脑预取，2026-08-20，来自只读代码勘查）**：
  - `origin/main` = `ba25ddf`；工作区干净；PR #1–#11 全部已合并，无 open PR。
  - **草稿目前零持久化**：`src/controls/asr-preview.ts:150-162` 的 `resetDraft()` / `clear()`
    直接清 `input.value`；`asr-preview.ts` 与 `mic-controller.ts` **均未使用 localStorage**。
  - 全仓 localStorage 只用在字体尺寸一处（key `remobi:fontSize`）：
    `src/index.ts:52-60`（读）、`src/actions/registry.ts:85-98`（写，已有 iOS 隐私模式 catch）、
    `src/gestures/pinch.ts:69-71`（写）。**这是本卡要照抄的防御姿势。**
  - draft 唯一载体是 `asr-preview.ts:61-67` 创建的 textarea；`getText()` 在 `:198`，
    `show(text)` 在 `:129`，`setPartial` 在 `:135-143`（rAF 合帧）。
  - `MicController` 现有接口（`mic-controller.ts:23-29`）：
    `preview` / `state` / `attachComposerToggle` / `attachMicButton` / `dispose`。
  - 提交路径 `confirmPreview()` 在 `mic-controller.ts:363-425`；三处 `isConnected()` 守卫在
    `:382` `:402` `:417`；`autoEnter` 的独立第二次写在 `:421`。
  - `finishSend()` 在 `:172-180`：`generation++` → 清 `baseDraft` → `preview.resetDraft()` → `idle`。
  - `visibilitychange → hidden` 时取消录音在 `:449-455`。
  - 现有断线文案统一是 `'Terminal disconnected; text is kept here until it reconnects.'`
    （`:383/403/418/462`）——**"kept here" 目前是句空话**，只指内存里的 textarea，本卡把它做实。
  - 客户端 basePath 读法：`src/client-entry.ts:19-23`，`joinBasePath(__remobiBasePath ?? '/', '/ws')`。
  - 测试模板：`tests/font-persistence.test.ts`、`tests/action-registry.test.ts` 里已有
    localStorage 失败降级用例。`tests/mic-controller.test.ts` 现有 799 行 / 37 个用例。
- **机理/根因陈述**：
  - `草稿在刷新后消失` 的直接原因是重连实现就是整页刷新（证据锚点：`src/reconnect.ts:84-88`
    `triggerReconnect() = location.reload()`），而 draft 只存在于 DOM textarea
    （证据锚点：`src/controls/asr-preview.ts:61-67, 198`）。两者叠加 ⇒ 弱网下每次重连都清空草稿。
- **已完成**：设计文档已过 CEO + Eng review（`docs/designs/weak-network-experience.md`，
  状态 APPROVED / CLEAR，无未决产品决策）。
- **未完成**：本卡的全部实现。
- **关键决策**：本卡与 T2（服务端协议）并行派发——两张卡的文件范围零重叠
  （本卡 `src/controls/**`，T2 `src/session*.ts`），不存在产物依赖。
- **已否决方案**（不得重新提起）：IndexedDB outbox、通用 store/repository 层、本地加密、
  多标签页协同、多设备草稿同步、延迟落盘/去抖写入、把 pending 字段从 schema 里省掉。
- **下一步唯一动作**：实现 localStorage schema 的读写与三类失败路径，先让轴表 1 的每一格有断言。
