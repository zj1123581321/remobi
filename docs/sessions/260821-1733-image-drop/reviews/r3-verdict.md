# Image-drop R3 独立审查 Verdict（T6 UX 增量 + H1..H2 收尾）

| 字段 | 值 |
|---|---|
| Reviewer | delegate big (Cursor executor) |
| 审查对象 | `fd20ae2..82d49f8`（增量）；T6 专项 `82d49f8` |
| Base (r2 头) | `fd20ae2` |
| Head | `82d49f8`（`feat(image-drop): promote the image button to the toolbar and make success a transient toast`） |
| 中间提交 | `b81f04b` HANDOFF 归档；`710d123` knip 去导出；`3bae6a4` r2 verdict 入库 |
| 风险等级 | personal（infra/状态机类 diff 提档例外；T6 为 UX 状态机微调） |
| 锁定决策 | T6：image-upload 默认 toolbar row1；成功态 ~2.5s 自动消失 toast；仅失败态显示 path/retry/copy/close |
| 本轮新证据 | ① `fd20ae2..82d49f8` 增量 diff 首次独立阅读；② 在 `feat/image-drop` checkout（`/home/zlx/projects/oss/remobi-worktrees/image-drop` @ `82d49f8`）实跑指定 vitest + Playwright |

## Verdict: **PASS**

T6 UX 重构与锁定决策一致；增量四问均通过。done toast 定时器复用 ackTimer 槽位，generation + state + disposed 三重守卫在代码审与单测交错时序下成立；registry/openImageDrop 路径未因按钮迁 toolbar 而断裂；config/测试/SKILL 计数与代码一致。无 P1/P2。

## 增量审四问（`fd20ae2..82d49f8`）

| 四问 | 结论 | 证据 |
|---|---|---|
| ① 是否只修登记在案 findings / 只做 T6 定稿改动？ | **是** | `b81f04b`/`3bae6a4` 仅 docs；`710d123` knip 登记项（`detectImageDropFormat`/`ImageDropFormat`/`ImageDropControllerDeps` 去 export）；`82d49f8` 仅 T6（toolbar 默认位 + done toast） |
| ② 是否新增未经批准的抽象？ | **否** | 仅增 `IMAGE_DROP_DONE_TOAST_MS` 常量；复用既有 `ackTimer` 槽，无新模块/接口/配置项 |
| ③ 状态/事实源/fallback 是否无依据增加？ | **否** | `showDetails = path !== null && next !== 'done'` 为 T6 定稿 UX；失败路径仍 file-ready + 可见 path/actions，符合 HANDOFF「插入失败保持 file-ready；路径可选择」 |
| ④ 是否留下双路径？ | **否** | image-upload 默认唯一入口迁至 row1；drawer 默认已移除；registry 仍单一 `image-upload` → `openImageDrop()` 路径（`src/actions/registry.ts:264-276`） |

**增量审结论：通过**（不记新增 P1）。

## T6 专项（四个重点）

### 1. done toast 2.5s 自动隐藏 + ackTimer 复用 + 三重守卫

**结论：安全。**

- **槽位复用**：`clearAckTimer()` 在每次新选择（`generation++`）、`close`、`attemptInsert`、ACK 回调入口统一清空；done 态新定时器写入同一 `ackTimer` 变量（`src/controls/image-drop-controller.ts:80-83,118,151-161,189-194`）。
- **守卫**：定时器回调检查 `disposed \|\| gen !== generation \|\| state !== 'done'`（`:159`）；`gen` 在 ACK accepted 时捕获当前 `generation`。
- **交错时序推演**：

| 场景 | 机制 | 结论 |
|---|---|---|
| toast 中途新选文件 | `change` → `generation++` + `clearAckTimer()` | 旧 timer 已清；若未清则 `gen !== generation` |
| toast 中途 Close | `closeBtn` → `generation++` + `clearAckTimer()` + `idle` | 同上 + `state !== 'done'` |
| rejected → Retry → accepted | rejected 无 done timer；retry 用 ACK timeout 槽；accepted 再 `clearAckTimer` 后设 toast timer | 无串扰 |
| toast 中途再 pick（单测） | `done toast: … newer pick survives the old timer` | 旧 timer 触发时 panel 仍为 `flex`（inserting 态） |

- **dispose**：`dispose()` 调用 `clearAckTimer()`（`:205`），无泄漏。

**实测**：`tests/image-drop-controller.test.ts`「done toast」用 fake timers 覆盖 2499ms/2500ms 边界与 mid-toast 再 pick。

### 2. done 态隐藏 path/actions 后 E2E 仍读 textContent

**结论：契约成立，E2E 锁死。**

- `setState('done', …)` 仍执行 `if (path !== null) pathText.textContent = path`（`:76`），仅 `pathText.style.display = 'none'`（`:73-75`）。
- E2E 在 status 为「Inserted into agent input.」后读 `.wt-image-drop-path` 的 `textContent` 断言路径与 TMPDIR/0600/PTY（`tests/playwright/image-drop.spec.ts:51-60`）——即「DOM 在、不可见、textContent 可读」契约。
- 单测断言 `display: none` 但未断言 textContent 仍 populated；E2E 已覆盖端到端，足够。

### 3. 按钮迁 row1 后 registry/drawer 路径完整性

**结论：完整；fail-loud 不变。**

- `image-upload` 与放置无关，经 `createDefaultActionRegistry` → `openImageDrop()`（registry 不区分 toolbar/drawer）。
- `client-entry.ts` 仍注入 `openImageDrop: imageDrop.open`；缺依赖仍 throw（`tests/action-registry.test.ts` 既有用例，本增量未改 registry）。
- drawer 默认移除 image-upload 不影响自定义 config 在 drawer 放置该 action（schema 仍接受）。

### 4. config 默认值与多处计数断言 / SKILL 文档

**结论：一致。**

| 断言位置 | 期望 | 代码 |
|---|---|---|
| `tests/buttons.test.ts` | row1 8 键含 `image-upload` | `defaultRow1` 8 ids（`:7-17`） |
| `tests/config.test.ts` | row1 有 🖼；drawer 无 image-upload；drawer 30 | `:156-160,152-154,177-179` |
| `tests/commands.test.ts` | drawer 30 commands | `:5-7` |
| `tests/keyboard-mode.test.ts` | row1 末尾 ⌨🖼☰ | 注释与顺序一致 |
| `.agents/skills/remobi-setup/SKILL.md` | row1 8 按钮 + drawer 30；image-upload 默认 row1 | T6 commit 已更新 |

## Findings

（无 P1/P2/P3 待修项）

## 自跑测试输出

**Vitest**（checkout `82d49f8` @ image-drop worktree）：

```bash
pnpm vitest run tests/image-drop-controller.test.ts tests/config.test.ts \
  tests/commands.test.ts tests/buttons.test.ts tests/keyboard-mode.test.ts
```

```
 Test Files  5 passed (5)
      Tests  99 passed (99)
  Duration  1.08s
```

含新增「done toast」单测 1 条；`image-drop-controller.test.ts` 共 4 tests。

**Playwright**：

```bash
pnpm playwright test tests/playwright/image-drop.spec.ts
```

```
  4 passed (6.8s)
  chromium-android + webkit-iphone × / 与 /remobi
```

## OCR

未跑。本卡为 r2 头之后增量专项（R1/R2 已全量 PASS）；增量无新公共 API 面。

## Backlog（定稿边界外 / 文档滞后，不占 review 循环）

| 项 | 级别 | 说明 |
|---|---|---|
| HANDOFF.md 架构图仍写「drawer image-upload」 | P3 | `b81f04b` 归档的是 r2 前 spec 快照；T6 锁定决策 + SKILL.md 已更新为 toolbar row1；合并前可选补一句 T6 注记 |
| done 态 path textContent 无单测显式断言 | P3 | E2E 已锁；可在 controller 单测加一行 `expect(pathText.textContent).toMatch(...)` 增强文档性 |
| R1/R2 backlog 项 | — | CL 挂起、/tmp 无 TTL 等仍有效，本增量未触及 |

## 与 R1/R2 的分工

R1（静态 + vitest）、R2（运行时探针 + E2E + H0..H1）已 PASS。本轮不重审 `5b25e1c..fd20ae2` 运行时代码；仅审 `fd20ae2..82d49f8` 增量与 T6 状态机。

## 结论

**PASS** — T6 UX 可随 feat/image-drop 进入 gate/合并；R3 无新增 P1，与 R1+R2 合计符合 infra 例外「连续 2 轮无新增 P1」收敛条件（本增量为第 3 轮专项，仍 0 P1）。
