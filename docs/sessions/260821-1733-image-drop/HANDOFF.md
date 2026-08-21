## 新 Session Prompt（直接复制）

```text
在 /home/zlx/projects/oss/remobi 实现「手机浏览器选择图片，上传到服务端临时目录，并把路径插入 coding agent 输入」功能。

先遵守仓库 AGENTS.md：运行 pickup 并检查协作现场（git fetch、gh pr list、gh pr list --state merged --limit 20、git log origin/main --oneline -20）；用 worktree-bootstrap 建隔离工作区。主代理只规划、拆卡和验收，写入与测试委派 implementer。按 TDD 做，一个 PR；开分支即建 draft PR，commit 即 push。不要覆盖其他会话改动。

用户可感知的完成定义：在 iOS Safari、Android Chrome 和桌面 Chrome 的 remobi 抽屉点「上传图片」，选择一张 PNG/JPEG/WebP/GIF；上传成功后，若仍是上传开始时的同一个、已同步且新鲜的 terminal session，就把带前后空格的临时路径（例如 " /tmp/remobi-drop-<uuid>.png "）插入当前 coding agent 输入，但绝不发送 Enter。若断线、切换 session、插入被拒或 ACK 丢失，文件仍是 ready，界面显示可选择的路径，并提供「重试插入 / 复制 / 关闭」。coding agent 能实际读取该路径对应的原始字节。

产品边界已经定稿，不要重新发散：这是 personal 单用户功能，Cloudflare Access 是认证边界；不做多租户或通用上传服务。抽屉新增 image-upload action。使用隐藏的单文件 input，accept PNG/JPEG/WebP/GIF；每次选择后重置 value，允许重选同一文件；全流程 single-flight。客户端直接 POST 原始 File 到 {basePath}/api/image-drop，不用 multipart，也不用 WebSocket 传文件。

服务端复用现有 origin/host 检查和 base-path 路由；bodyLimit 为精确 10 MiB，拒绝 0 字节。只按 magic bytes 识别 PNG/JPEG/WebP/GIF，忽略客户端 MIME 和文件名；HEIC 返回 415 和大白话提示。写入 `${tmpdir()}/remobi-drop-${randomUUID()}.<ext>`；生产环境 tmpdir() 是 /tmp，E2E 可用 TMPDIR 隔离。以 wx 创建、权限 0600，完整写完后才返回 200；失败只精确删除本次 partial。响应必须 no-store，JSON 为 {path,format,size}。不要做 fsync、streaming、自动重试、TTL/cleaner、数据库、quota 或杀毒。helper 只放 src/serve.ts（如 detectImageDropFormat/writeImageDrop），不要创建 ImageUploadService 或 src/image-drop.ts。

客户端上传开始时捕获 sessionId。fetch(file) 成功后，仅当起始 sessionId 非空、当前 sessionId 仍相同且连接状态 synced/fresh，才调用已有 sendInputAction(actionId, ` ${path} `)。HTTP 200 只表示文件已落盘；input-accepted 只表示输入已进入 PTY 写队列。rejected、ACK 丢失、断线或切 session 都不得丢掉 file-ready 状态。原 session 内重试复用同一 actionId；新 session 禁止自动插入。用 selection/generation 与 actionId 共同守卫，旧 ACK 不得清掉新选择。复制失败要明确提示，且路径文本始终可选择。UI 使用 aria-live、onTap 和现有触控尺寸规范。

工程落点已经定稿：ButtonAction、config、schema、default drawer、registry 增加 image-upload；把 openImageDrop 作为 app-level dependency 注入 createDefaultActionRegistry，不放进 ActionExecutionContext，也不在 drawer 内特判。新增 src/controls/image-drop-controller.ts 并导出 createImageDropController。client-entry 只负责接线 controller、getSessionId、sendInputAction、onInputActionResult 和 base path，不另建连接状态机。样式写 styles/base.css。同步更新 .agents/skills/remobi-setup/SKILL.md 与 docs/architecture/networking-and-websockets.md。

按以下卡执行并守住新增行数预算：
T1 server（可与 T2 并行、独立 worktree）：src/serve.ts、tests/serve.test.ts、tests/serve-abuse.test.ts，≤290 行。
T2 wiring（可与 T1 并行、独立 worktree）：src/types.ts、src/config.ts、src/config-schema.ts、src/actions/registry.ts、src/client-entry.ts、tests/config.test.ts，≤180 行。
T3 controller（依赖 T2）：src/controls/image-drop-controller.ts、styles/base.css、tests/image-drop-controller.test.ts，≤300 行。
T4 E2E（依赖 T1+T3）：tests/playwright/image-drop.spec.ts、tests/playwright/isolated-serve.ts，≤180 行。
T5 docs（收尾）：上述 skill 与 networking 文档，≤80 行。

测试契约：server 覆盖精确 10 MiB、10 MiB+1、chunked、0 字节、HEIC、四种格式、伪 MIME、origin、base path、落盘字节、0600、no-store、写失败 partial cleanup。controller 覆盖 cancel、input value reset、single-flight、raw fetch、HTTP 状态、畸形 200、同 session、session 改变、unsynced、accepted、rejected、ACK 丢失、同 ID 重试、旧 ACK、clipboard denied。E2E 在 Pixel 5 Chromium 与 iPhone 13 WebKit，分别覆盖根路径和 /remobi；setInputFiles 后走真实 HTTP，断言隔离 TMPDIR 的字节和 0600，再走真实 input-action 到 PTY/bash echo，并证明没有自动回车。

最终验证依次运行 pnpm test、pnpm run test:pw、pnpm run check、pnpm run build:dist。再在 debug /remobi 环境冒烟，最后经 Cloudflare Access 的生产环境，用 iOS Safari、Android Chrome、桌面 Chrome 各测一次，并确认 coding agent 能读路径。推荐提交：feat(image-drop): add mobile image path insertion。

不做：预览、多图、拖拽、粘贴剪贴板图片、Web Share Target、自动回车、通用 composer，以及任何上面明确排除的服务端设施。

现有代码锚点：src/serve.ts origin/host 约 181-200、routeVariants 约 273-279；src/client-entry.ts sendInputAction 约 294-318、getSessionId 约 373-385、消息处理约 619-660；src/session.ts 去重约 253-285；src/session-protocol.ts accepted 约 60-65；src/base-path.ts joinBasePath 约 26-35；src/actions/registry.ts 约 35-69、DefaultActionDeps 约 104；src/drawer/drawer.ts 约 55-106；Playwright devices 约 16-29，并复用 tests/playwright/isolated-serve.ts。

本地漏斗全绿后才把 PR 标 ready。进入 review 前先读 review-discipline。仓库 risk-tier 为 personal，普通改动连续 1 轮无新增 P1 即收敛；本功能集中在状态/失败路径，按 infra 例外执行连续 2 轮无新增 P1。确认完整 gate 非 SKIPPED 且全绿后再合并。
```

## 持久参考

### 结果与边界

用户最终拿到的是一个「选图并插入本机临时路径」动作，不是图片消息或附件系统：

1. 选图并上传成功，服务端返回真实可读的临时路径。
2. 会话条件仍安全时，路径以 ` ${path} ` 插入输入区；不回车。
3. 无法安全插入时，文件和路径仍保留，用户可重试或复制。
4. Cloudflare Access 负责认证；remobi 继续复用已有 host/origin 防护。

明确不做：图片预览、多图、拖拽、剪贴板图片、Web Share Target、自动回车、通用 composer、多租户、通用上传、fsync、streaming、自动重试、TTL/清理器、数据库、quota、杀毒。

### 不变式

- 接受格式只由 magic bytes 决定：PNG、JPEG、WebP、GIF；客户端 MIME 和文件名不可信。
- body 上限是精确 `10 * 1024 * 1024` 字节；0 字节必拒绝；HEIC 用 415 大白话说明不支持。
- 生产文件名为 `/tmp/remobi-drop-<randomUUID>.<ext>`；用 `wx` 和 0600，写完才 200。
- 失败清理只能指向本次服务端生成的 partial 路径，绝不能删除客户端提供的路径。
- 成功响应为 `{path,format,size}` 且 `Cache-Control: no-store`。
- HTTP 200 ≠ 已插入；`input-accepted` ≠ agent 已消费，只表示进入 PTY 写队列。
- 自动插入要求：上传开始的 session 非空、结束时仍是同一 session、状态 synced/fresh。
- 一个文件选择对应一个稳定 actionId；同 session 重试复用它，服务端现有去重保证至多写入一次。
- session 改变后不能自动插入；旧 action ACK 不能结束或清除更新一代的选择。
- 任何插入失败都保持 file-ready；复制失败必须可见，路径文本必须可选择。
- 选择器是单文件、single-flight；关闭/取消后重置 input value，允许再次选择相同文件。

### 架构与状态流

```text
drawer image-upload
  -> openImageDrop（registry 的 app-level dependency）
  -> image-drop-controller 打开 hidden file input
  -> POST raw File 到 joinBasePath(basePath, "/api/image-drop")
  -> serve.ts 校验 host/origin、限长、magic bytes、wx/0600 落盘
  -> 200 {path,format,size}，客户端进入 file-ready
  -> 同 session 且 synced/fresh：sendInputAction(actionId, ` ${path} `)
  -> input-accepted：完成；rejected/断线/超时/切 session：仍为 file-ready
```

建议 controller 的可见状态保持简单：`idle -> uploading -> file-ready -> inserting -> done`。上传或解析错误进入可见 error；插入错误回到 file-ready。每次新选择增加 generation，异步回调必须同时核对 generation 和 actionId。

### 拆卡与依赖

| 卡 | 范围 | 预算 | 依赖 |
|---|---|---:|---|
| T1 | `src/serve.ts`、`tests/serve.test.ts`、`tests/serve-abuse.test.ts` | ≤290 | 无 |
| T2 | types/config/schema/registry/client-entry/config test | ≤180 | 无 |
| T3 | controller、base.css、controller test | ≤300 | T2 |
| T4 | Playwright spec、isolated-serve helper | ≤180 | T1+T3 |
| T5 | setup skill、networking 文档 | ≤80 | 收尾 |

T1 与 T2 可在独立 worktree 并行；随后 T3，再 T4，最后 T5。所有卡汇入一个 PR；超预算先停下审视设计，不直接扩卡。

### 测试矩阵

| 层 | 必测内容 |
|---|---|
| server | 10 MiB 边界、10 MiB+1、chunked、空体、HEIC、四格式、伪 MIME、origin、base path、原字节、0600、no-store、写错清 partial |
| controller | cancel/reset、single-flight、raw body、HTTP/畸形 JSON、session 同/变/空、fresh/synced、accepted/rejected/丢 ACK、同 ID 重试、旧 ACK、复制拒绝 |
| E2E | Pixel 5 Chromium、iPhone 13 WebKit；root 与 `/remobi`；真实 HTTP/文件/权限/input-action/PTY；确认无 Enter |

E2E 通过 `isolated-serve` 给服务端设置独立 `TMPDIR`，避免污染真实 `/tmp`；生产仍由 `tmpdir()` 落到 `/tmp`。测试需读回文件并逐字节比较，权限断言为 0600。

### 真实环境验收

- debug 服务的 `/remobi`：完成一次选择、上传、自动插入、复制、同文件重选和断线后保留路径。
- Cloudflare Access 后的生产：iOS Safari、Android Chrome、桌面 Chrome 各跑一次 PNG/JPEG，至少一端验证 WebP/GIF。
- 在 coding agent 中读取返回路径并核对文件可识别；确认选择图片后不会自动提交 prompt。
- 人工切换 session 或制造断线，确认不向新 session 自动插入，且路径仍可复制/重试。

### 开工与 PR 清单

1. `pickup`，再完成 fetch/open PR/merged PR/origin main log 四项协作检查。
2. 用 `worktree-bootstrap.sh` 建工作区；核对主干上缺口仍存在。
3. 按 TDD 执行 T1-T5；主代理把写入和测试交给 implementer，并审查实际 diff。
4. 建 draft PR；每个绿色增量小步 commit 并 push。推荐 commit：`feat(image-drop): add mobile image path insertion`。
5. 跑 `pnpm test`、`pnpm run test:pw`、`pnpm run check`、`pnpm run build:dist`。
6. 本地漏斗绿后标 ready；检查完整 gate 的 job 不是 SKIPPED。
7. review 前读 `review-discipline`；本功能按状态/失败路径的 infra 例外，连续 2 轮无新增 P1 才收敛。
8. 完成真实设备验收、完整 gate 全绿后合并；最后运行 worktree doctor 并写 handoff。

### 代码参考点

- `src/serve.ts`：origin/host 约 181-200，routeVariants 约 273-279。
- `src/client-entry.ts`：sendInputAction 约 294-318，getSessionId 约 373-385，消息处理约 619-660。
- `src/session.ts`：action 去重约 253-285；`src/session-protocol.ts`：accepted 约 60-65。
- `src/base-path.ts`：joinBasePath 约 26-35；`src/actions/registry.ts`：registry 约 35-69、DefaultActionDeps 约 104。
- `src/drawer/drawer.ts`：渲染约 55-106；Playwright devices 约 16-29；复用 `tests/playwright/isolated-serve.ts`。
