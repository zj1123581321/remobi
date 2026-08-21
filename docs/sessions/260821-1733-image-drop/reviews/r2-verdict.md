# Image-drop R2 独立审查 Verdict（运行时 / 对抗视角）

| 字段 | 值 |
|---|---|
| Reviewer | delegate big (Cursor executor) |
| 审查对象 | `5b25e1c..fd20ae2`（全量）；H0..H1 增量 `c38fc19..fd20ae2` |
| Base | `5b25e1c774174e49acacbeb21833df88b439dc2e` |
| Head (H1) | `fd20ae2`（`docs(image-drop): add r1 independent review verdict (PASS)`） |
| 分支 tip 注记 | 当前 `origin/feat/image-drop` 在 H1 之上另有 `b81f04b`（仅新增 HANDOFF.md 归档），无运行时代码 diff；探针与 E2E 在含该 docs 提交的 checkout 上执行，行为与 H1 一致 |
| 风险等级 | personal（infra/状态机类 diff 提档例外） |
| 本轮新证据 | ① 真实 `pnpm exec tsx cli.ts serve` + 隔离 `TMPDIR` 对抗性 HTTP 探针（见下）；② `pnpm playwright test tests/playwright/image-drop.spec.ts` 实跑；③ H0..H1 增量 diff 首次阅读 |

## Verdict: **PASS**

`fd20ae2` 实现与 HANDOFF「不变式」一致。运行时探针与 E2E 均未发现 spec 违反；H0..H1 增量审四问均通过。无 P1/P2。

## H0..H1 增量审（`c38fc19..fd20ae2`）

| 四问 | 结论 | 证据 |
|---|---|---|
| ① 是否只修登记在案的 findings？ | **是** | `212d6d7` 移除 `image-drop-controller.ts` 两处 `as` 类型断言（oxlint 登记项）；`fd20ae2` 仅入库 R1 verdict 文档 |
| ② 是否新增未经批准的抽象？ | **否** | 无新模块/接口/配置项；`readImageDropBody` 由 `Blob` 合并改为手动 `Uint8Array` 拼接（同函数内实现替换） |
| ③ 状态/事实源/fallback 是否无依据增加？ | **否** | 无新状态机分支或 fallback 路径 |
| ④ 是否留下双路径？ | **否** | body 读取仅保留一条合并路径 |

**增量审结论：通过**（不记新增 P1）。

## Findings

（无 P1/P2/P3 待修项）

## 运行时探针（`tsx cli.ts serve --port 19777 -- bash --norc`，`TMPDIR=$(mktemp -d)`）

命令：`/tmp/r2-probes-fixed.sh`（审查专用，未入库）；完整原始输出见 `/tmp/r2-probe-output.txt`。

| # | 探针 | 命令摘要 | 原始输出摘要 | 预期 / 结论 |
|---|---|---|---|---|
| 1a | 无 Origin（loopback） | `curl POST /api/image-drop` 无 Origin | `HTTP 200` + `{"path":"…/remobi-drop-….png","format":"png","size":11}` | `isAllowedOrigin` 对 loopback 无 Origin 放行（`src/serve.ts:187-190`）✓ |
| 1b | Origin 与 Host 不同域 | `Origin: https://evil.example` | `HTTP 403` `Forbidden` | ✓ |
| 1c | Origin 匹配 | `Origin: http://127.0.0.1:PORT` | `HTTP 200` + JSON path | ✓ |
| 1d | localhost 变体 | Host/Origin `localhost:PORT` | `HTTP 200` + JSON path | ✓ |
| 2a | CL 报小实大 | `Content-Length: 4`，body 11B | `HTTP 400`，body 空，无新 drop 文件 | HTTP 层拒收，未落盘 ✓ |
| 2b | CL 报大实小 | `Content-Length: 999`，body 11B，`--max-time 5` | `curl: (28) Operation timed out`，`HTTP 000` | 服务等待剩余字节直至客户端超时；**未超写、未崩溃**；spec 未要求 fast-fail → backlog P3 |
| 3a | declare-only 10 MiB+1 | `Content-Length: 10485761`，零 body | `HTTP 413` `image drop too large: 10 MiB maximum` | 短路拒绝 ✓ |
| 3b | 精确 10 MiB | Python socket 发送 10485760B PNG magic+padding | `HTTP/1.1 200 OK`（chunked 响应；探针未完整读 body，与 `serve-abuse.test.ts` 10 MiB 用例一致） | 接受 ✓ |
| 3c | chunked 10 MiB+1 | Python chunked 发送 10485761B | `HTTP/1.1 413 Payload Too Large` | ✓ |
| 4a | PNG 截断 4B | body `\x89PNG` | `HTTP 415` unrecognized format | ✓ |
| 4b | RIFF 非 WEBP | `RIFF….NOTW` | `HTTP 415` unrecognized format | ✓ |
| 4c/d | GIF87a / GIF89a | 各 7B | `HTTP 200` `format:gif` | `detectImageDropFormat` `GIF8` 前缀 ✓ |
| 4e–g | HEIC brands | Python socket：`ftypheic/heix/mif1` | 各 `HTTP/1.1 415 Unsupported Media Type`（curl/bash 传 NUL 前缀失败为探针 artifact，非服务缺陷） | spec HEIC 415 ✓ |
| 5 | 并发两文件 | 并行 POST PNG + JPEG | 两路径不同；`cmp` 字节各自匹配 | 无串扰 ✓ |
| 6 | 落盘证据 | 成功 POST PNG | `cache-control: no-store`；JSON `{path,format,size}`；`mode=600`；path 前缀为隔离 TMPDIR | ✓ |

探针结束后 serve 进程与 `mktemp` 目录已清理（脚本 `trap cleanup EXIT`）。

## E2E

**命令**：

```bash
pnpm playwright test tests/playwright/image-drop.spec.ts
```

**输出**（2026-08-21）：

```
Running 4 tests using 2 workers
  ✓ [chromium-android] … (base path /) (2.5s)
  ✓ [webkit-iphone] … (base path /) (2.5s)
  ✓ [chromium-android] … (base path /remobi) (2.3s)
  ✓ [webkit-iphone] … (base path /remobi) (2.6s)
  4 passed (7.0s)
```

chromium-android + webkit-iphone × `/` 与 `/remobi` 共 4 用例全绿。

## Backlog（定稿边界外 / 存量，不占 review 循环）

| 项 | 级别 | 说明 |
|---|---|---|
| CL 大于实际 body 时连接挂起 | P3 | 探针 2b：`Content-Length: 999` 仅发 11B，服务读流阻塞至客户端断开；personal + Access 边界下可接受；非 spec 条款 |
| `/tmp` 无 TTL | — | R1 已记；spec 定稿不做 |
| 无 AbortController / 上传超时 | — | spec 否决 |
| `writeImageDrop` 成功后 `close` 失败 | — | R1 已记 |
| bash/curl 传 NUL 前缀 HEIC 探针 | — | 探针限制；Python socket 已证实 415 |

## 与 R1 的分工

R1（静态 spec + vitest）已 PASS。本轮不重做逐行静态审或单测复跑；仅补运行时对抗 + E2E + H0..H1 增量。

## 结论

**PASS** — 可进入 gate 验收 / 合并流程；连续 2 轮（R1+R2）无新增 P1，符合 infra 例外收敛条件。
