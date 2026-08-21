# Image-drop R1 独立审查 Verdict

| 字段 | 值 |
|---|---|
| Reviewer | delegate big (Cursor/Codex executor) |
| 审查对象 | `5b25e1c..c38fc19`（H0 冻结） |
| Base | `5b25e1c774174e49acacbeb21833df88b439dc2e` |
| Head (H0) | `c38fc19`（`fix(image-drop): always clean the partial file and polish the status panel`） |
| 风险等级 | personal（infra/状态机类 diff 提档例外） |
| 本轮新证据 | H0 全量 diff 首次独立阅读 + 执行器在 H0 工作树自跑指定 vitest 套件（见下） |
| H0 之后新提交 | `git log c38fc19..origin/feat/image-drop` 为空，无未审新提交 |

## Verdict: **PASS**

H0 diff 与 HANDOFF「不变式」及任务卡 spec 一致。服务端落盘、客户端 session/generation/actionId 守卫、失败路径与测试矩阵均满足定稿边界；未发现 P1 或 P2 级 spec 违反。

## Findings

（无 P1/P2/P3 待修项）

## 降层三问

### 1. 终态写入成功之前已发生哪些不可逆动作？partial 清理与 `wx` 冲突行为？

| 阶段 | 不可逆动作 | 失败/冲突时的行为 |
|---|---|---|
| HTTP POST 到达服务端 | 无（仅校验 origin/host、限长、magic bytes） | 超限 413、空体 400、未知格式/HEIC 415、origin 403；**不写盘** |
| `writeImageDrop` | `open(path,'wx',0o600)` 后在 `/tmp/remobi-drop-<uuid>.<ext>` 写完整字节 | 写失败：`close`（吞 secondary 错误）→ `rm` **仅本次生成的 path** → 重抛原始错误（`src/serve.ts:326-336`）；测试 `writeImageDrop removes only its own partial file` 锁死 |
| `wx` 冲突（UUID 碰撞） | 无 partial（`open` 在写前失败） | 错误冒泡为 500；磁盘上无新文件 |
| HTTP 200 响应客户端 | 文件已完整落盘 | 客户端进入 file-ready；**不等于已插入** |
| `sendInputAction` | 路径进入 PTY 写队列（若 session 守卫通过） | 返回 false → 保持 file-ready + Retry；rejected/ACK 丢失 → file-ready |
| `input-accepted` | PTY 已写入 ` ${path} `（无 Enter） | 进入 done；agent 消费是 PTY 之后的事 |

partial 清理**只**指向 `writeImageDrop` 自己 `join(tmpdir(), 'remobi-drop-…')` 生成的路径，不接触客户端输入。

### 2. 守卫值（actionId、generation、sessionId）在单实例单用户、多标签页下是否足够？

- **sessionId**：服务端 `SharedTerminalSession` 每次 spawn 一个 `randomUUID()`（`src/session.ts:76`），经 snapshot 下发；客户端 `getSessionId()` 在 snapshot 前为 `null`，上传开始时 capture，与 spec「起始 sessionId 非空」一致——`null` 时 `maybeAutoInsert` 走 file-ready，不自动插入（`src/controls/image-drop-controller.ts:94-96`；测试 `gating` 用例 `session.id = null`）。
- **actionId**：每次新选图 `image-drop-${crypto.randomUUID()}`（`:118`）；同 session 重试复用同一 id（`:126-127` 测试）；新选图必换新 id。
- **generation**：每次 `change` / `close` 递增（`:110`, `:175`）；异步 upload/ACK 超时回调核对 `gen !== generation`（`:131`, `:88`）。
- **多标签页**：每标签独立 WebSocket 与 controller 状态；若连同一 terminal session 则共享 sessionId——两标签可能对同一上传各自动插入一次（不同 actionId，服务端各写 PTY 一次）。personal 单用户场景可接受，不构成 spec 违反。

ACK 处理器仅核对 `actionId`（`:142-143`），未显式核对 `generation`；但因新选图必换 `actionId`，与 generation 生命周期绑定，实测/推演 stale ACK 无法清除新选图（测试「stale ACK must not end a newer selection」）。**不构成 finding**。

### 3. 保护覆盖的是「写入」还是「行为」？HTTP 200 / input-accepted 语义边界是否在代码与测试中成立？

| 信号 | 语义（spec） | 代码 | 测试 |
|---|---|---|---|
| HTTP 200 | 文件已落盘 `{path,format,size}` + `no-store` | `handleImageDropRequest` 完整写完后 `c.json`（`:369-372`） | `serve.test.ts` 四格式字节/0600/no-store；`serve-abuse.test.ts` 10 MiB 精确边界 |
| `sendInputAction` 返回 true | 消息已入 WS 发送路径 | `client-entry.ts:295-318` 要求 synced + OPEN + freshness | controller 测试 unsynced 不发送 |
| `input-accepted` | 进入 PTY 写队列，非 agent 已消费 | `session.ts:279-284` | E2E 断言路径出现在 bash prompt 且无第二 prompt（无 Enter） |
| HTTP 200 ≠ 已插入 | 守卫失败时 file-ready | `maybeAutoInsert` / `attemptInsert` | session changed / not synced 用例 |
| 插入失败保持 file-ready | rejected / ACK 丢失 / 断线语义 | timeout → file-ready（`:86-90`）；rejected → file-ready（`:148-149`） | `failures` + `gating` 测试 |

边界在实现与测试中均成立。

## 熵增审查

| 新增抽象/状态/配置 | 第二消费者或必要性 |
|---|---|
| `createImageDropController` + 状态机 | 唯一消费者 `client-entry.ts`；spec 指定落点 |
| `openImageDrop` registry dep | spec 要求 app-level 注入；fail-loud 测试锁死 |
| `image-upload` ButtonAction + schema + default drawer | 用户可见入口；config/registry 测试 |
| `detectImageDropFormat` / `writeImageDrop` in `serve.ts` | spec 禁止独立 ImageUploadService；单测直接覆盖 |
| `ImageDropFormat` 类型 | `writeImageDrop` 签名所需 |
| `IMAGE_DROP_ACK_TIMEOUT_MS` | 可注入 `ackTimeoutMs` 供单测；生产默认 15s |
| `#wt-image-drop` CSS | 状态面板 + 44px 触控 + user-select:text |

无无依据的转发层或「单实现接口」坏味道；新增项均有 spec 或测试消费者。

## 测试自跑（H0 工作树）

**检出方式**：在 `card/remobi-20260821-10` 工作树执行 `git checkout c38fc19 -- .`（HEAD 仍为 `5b25e1c`，内容对齐 H0）。

**命令**：

```bash
pnpm vitest run tests/serve.test.ts tests/serve-abuse.test.ts \
  tests/image-drop-controller.test.ts tests/config.test.ts tests/action-registry.test.ts
```

**SHA**：审查内容与测试对象均为 `c38fc19`。

**输出**（2026-08-21，一次性通过；`serve-abuse` oversized websocket 用例未 flake）：

```
 ✓ |dom| tests/image-drop-controller.test.ts (3 tests)
 ✓ |dom| tests/config.test.ts (43 tests)
 ✓ |dom| tests/action-registry.test.ts (33 tests)
 ✓ |node| tests/serve-abuse.test.ts (4 tests)
 ✓ |dom| tests/serve.test.ts (23 tests)

 Test Files  5 passed (5)
      Tests  106 passed (106)
   Duration  6.23s
```

## Backlog（存量/定稿边界外，不占 review 循环）

| 项 | 说明 |
|---|---|
| `/tmp` 无 TTL 清理 | spec 定稿不做；personal 可接受累积 |
| 上传无 AbortController/超时 | spec 否决；长时间挂起时 UI 停在 uploading，需刷新 |
| `writeImageDrop` 成功后 `close` 失败 | 罕见；文件已完整但可能 500；孤儿 temp 文件 |
| 非 loopback 且无 Origin 的 POST | 复用现有 `isAllowedOrigin`；fetch POST 通常带 Origin |
| ACK 路径未显式读 generation | 与 actionId 生命周期等价；可观测性改进，非行为缺陷 |

## Diff 规模

`5b25e1c..c38fc19`：20 files, +970 / −20（审查范围，非本卡写入）。

## 审查覆盖摘要

- **Server**：origin/host、base-path、`10*1024*1024` 精确限、chunked/declare-only、magic bytes、HEIC 415、wx/0600、partial cleanup、JSON + no-store。
- **Client**：hidden input + accept + value reset、single-flight、raw POST、sessionId capture、synced/fresh 门控、` ${path} ` 无 Enter、generation/actionId、file-ready 重试/复制/aria-live/onTap/44px。
- **Wiring**：registry fail-loud、client-entry 接线、default drawer、文档/skill 同步。
- **E2E**（`tests/playwright/image-drop.spec.ts`）：代码审阅通过；本卡未重跑 Playwright（任务卡未要求）。

## 结论

**PASS** — 可进入下一轮修复增量审（若后续有 H0..H1 修复）或 gate 验收；本轮无登记在案的 P1/P2 findings。
