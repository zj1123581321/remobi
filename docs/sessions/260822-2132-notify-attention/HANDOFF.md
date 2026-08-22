# HANDOFF · 注意力层 v1（通知桥接）— herdweb 全量落地

> 本会话（CEO + Eng review 已 CLEAR）只做决策与交接；新 session 在 /home/zlx/projects/oss/herdweb
> 执行全部代码落地。计划全文（含处置账本）：`~/.gstack/projects/zlxlabs-herdweb/ceo-plans/2026-08-22-attention-notify.md`。
> 本文档自包含，不依赖计划文件也可实施。

## 新 Session Prompt（直接复制）

```text
在 /home/zlx/projects/oss/herdweb 实现「注意力层 v1」：agent 需要用户时手机会响。
herdweb serve 新增本地事件入口 POST {basePath}/api/events，收到事件后经 Web Push
推到已订阅的手机 PWA；自带静默兜底车道（PTY 忙→静默检测）、服务健康自通知、
页内事件历史、测试按钮。agent-config 侧的 badge 出站车道已开 issue 交接
（zlxlabs/agent-config#495），本 session 绝不改 agent-config 仓——只做 herdweb 侧，
且 herdweb 三条自有车道（静默/健康/测试）独立构成完整产品，不依赖 badge 车道。

先遵守仓库 AGENTS.md：运行 pickup 检查协作现场；用 worktree 建隔离工作区分卡实施。
主脑只规划、拆卡、验收；实现与测试委派执行器，按 TDD。分支 feat/notify-attention，
开分支即建 draft PR，commit 即 push，conventional commits（feat(notify): …）。
不要覆盖其他会话改动。

用户可感知的完成定义：手机（Android Chrome；iOS 须添加到主屏幕的 PWA）打开 herdweb，
在 ☰ 抽屉进入「通知」面板完成订阅，点「发送测试通知」立刻收到系统通知，点通知
聚焦/打开 herdweb；agent 持续输出后停下 ≥3 分钟收到「可能完工/卡住」；herdweb 服务
重启/会话死亡收到通知且一次事故只有一条；错过的通知打开面板能在历史列表回看。
README 与 herdweb-setup skill 同步（如实写明通知延迟 60-90 秒节律、iOS 主屏前提）。

设计已定稿，不要重新发散。核心决策（全部经过 CEO+Eng review 定案，工程审查另有
27 条外部意见已折叠，见持久参考节）：

1. 状态目录按实例分仓：~/.local/state/herdweb/{port}/（生产 7681 与 debug 7691 并发，
   共享会互丢事件；VAPID 与订阅本就 origin 绑定）。
2. 事件 kinds：asking|done|ci-red（外部源，badge 车道）|silence|health（内部）|test。
   没有 failed——badge 证据体系里不存在该概念。schema v1：
   {v:1, id, kind, session?, title, body?, reason?, ts}；无 tool 字段；
   title≤120、body≤200、reason≤120（服务端截断）；payload ≤4 KiB 超限 413；
   禁止携带终端输出内容。
3. POST /api/events：回环边界 + 可选 bearer token（config）；单桶限流 60 events/min
   →429；按 id 去重（内存有界集合 1000 FIFO，进程内生命周期，重启清空）；校验+落盘
   后立即 202，推送异步发送。内部事件确定性 id：silence:{session}:{分钟取整}、
   health:{session}:{启动时间戳}、test:{自增}（test 绕过去重，连点两次都到）。
4. Web Push：pnpm add web-push（钉版本）。VAPID 存 {stateDir}/vapid.json（0600，
   serve 检测缺失自动生成+启动日志提示）；config.local 可选 notify.vapid.* 覆盖
   （轮换用）。订阅数组存 push-subscriptions.json（多设备预留，v1 UI 单设备）；
   推送 401/404/410 删该订阅；90 天未成功推送按龄清理（serve 内 24h setInterval 顺扫）；
   逐订阅 Promise.allSettled 隔离。
5. 首个 service worker：serve.ts 加 {basePath}/sw.js 路由（现无，走 routeVariants）；
   client-entry.ts 加 SW 注册调用（现无）。SW 无 fetch handler（永不 respondWith，
   不引 Workbox）；handler 全集=install/activate(no-op)、push、notificationclick
   （client.matchAll({type:'window'}) 聚焦已有窗口，空则 clients.openWindow(basePath)
   冷启动）、pushsubscriptionchange（先 DELETE 旧订阅再 POST 重订阅）。v1 不用
   skipWaiting。SW 内相对 URL 以 self.registration.scope 为基解析。
6. CSP：buildSecurityHeaders 工厂（serve.ts 约 156 行，CSP 串约 168 行）加
   worker-src 'self'；同步更新 tests/serve.test.ts 的 CSP 快照断言。
7. 静默车道（SharedTerminalSession 增逐 chunk 字节累加器 (Buffer.byteLength, ts)，
   30s 定时器检查）：trailing 30s 字节和 ≥1 KiB = busy；busy 后连续 180s 零输出触发；
   同 session 冷却 10min 且新 busy 重置冷却；10min 内已有其他车道事件则让位。
   配置 notify.silence.{enabled=true,busyMs=30000,quietMs=180000,cooldownMs=600000}
   进 config-schema.ts。坦白限制：无法区分等用户与跑长任务——标题措辞「可能完工/卡住」。
8. 健康车道：sessionId 用 T2 已有的会话身份（src/session.ts，snapshot 帧即带）。
   {stateDir}/last-session.json 按 herdr --session 值键控（extractSessionKey(command)
   放 serve.ts，解析 post-`--` argv；herdr --session dev → dev，bash --norc → default）。
   PTY 任意退出 → health「会话结束」（reason 带退出码/信号）；下次启动 sessionId 变化
   且上次 exitedAt 距今 >120s 才补推「服务已重启」（crash-loop 120s 内只推一条）；
   首次运行（文件缺失）静默只写文件。
9. 停机排空（serve.ts 现状是 PTY exit 即 server.close()，会掐死在途推送，必须改）：
   顺序=PTY exit → 写 last-session.json → await 在途推送 → server.close()。
10. 订阅端点：POST {basePath}/api/push/subscribe（{endpoint,keys:{p256dh,auth}} → 201）；
    DELETE {basePath}/api/push/subscription（body 带 {endpoint}）。同 /api/events 的
    鉴权/限流。UI 关闭订阅 = 服务端 DELETE（非仅 UI 隐藏）。
11. 原子写 helper（tmp+rename）只管 vapid/subscriptions/last-session 三个 JSON；
    events.jsonl 走 O_APPEND + 惰性截断（超 2×notify.history.limit 截到 limit，默认 200，
    kind=test 不落盘）。目录 0700、vapid 0600、其余 0644。
12. UI：☰ 抽屉加「通知」入口 → 设置面板（订阅开关 + 测试按钮 + iOS 非 standalone
    （display-mode 检测）时显示「添加到主屏幕」引导）；卡 3 在同面板加历史列表
    （GET {basePath}/api/events/history?limit=）。

按以下卡执行（串行依赖，卡内 TDD）：

卡 1 推送管道（先行，独立有价值）：serve.ts（/api/events、/api/push/*、/sw.js 路由、
  CSP、停机排空框架）、src/notify/（events schema+端点逻辑、push.ts、state.ts）、
  src/sw 源（构建进 bundle 或独立 serve，任选但 scope={basePath}/）、client-entry SW
  注册、config-schema notify.*、UI 订阅开关+测试按钮+iOS 引导、web-push 依赖。
卡 2 内部车道（依赖卡 1）：静默状态机 + 健康单通知 + 停机排空完整实现。
卡 3 历史收件箱（依赖卡 1）：history 端点 + 面板内列表。
收尾卡：README 通知节（iOS 主屏前提、VAPID 自动生成、端口契约、延迟 60-90s 如实标注）
  + .agents/skills/herdweb-setup/SKILL.md 推送 onboarding + GOALS.md 记里程碑。

测试契约（除各卡 TDD 外必须有的矩阵）：限流触发 429；4KiB 拒绝；schema 套件
（kind 白名单拒 failed、无 tool 字段、body/reason 截断）；去重集合 FIFO；确定性 id
防 flap；pushsubscriptionchange 重订阅流；90 天龄清理；toggle-off 服务端 DELETE；
cold-start openWindow；CSP 快照含 worker-src；120s 内双 PTY 退出=单通知；停机排空
不丢在途推送；SW handler 存在性单测（happy-dom 不触发 push 事件，以存在性+iOS 真机
人工门为准）；静默状态机（busy 判定/触发/冷却重置/让位）。E2E（chromium，支持 SW）：
订阅→POST 事件→SW 展示→点击聚焦。webkit-iOS 走真机人工门，不进 CI。

最终验证依次运行：pnpm test、pnpm exec tsc --noEmit、pnpm run build:dist、
pnpm run check、pnpm run test:pw；静默/健康时序测试连跑 5 次全绿；弱网既有 e2e
（tests/playwright/weak-network.spec.ts）不回归。curl 冒烟：起 serve 后
curl -X POST 127.0.0.1:7681/api/events -d '{"v":1,"id":"t1","kind":"test","title":"T","ts":1}'
全链路（手机收通知）。真机人工门（Android Chrome + iOS 主屏 PWA 各一轮）：订阅、
测试通知到达、静默通知、服务重启只收一条、历史可回查。推荐提交：
feat(notify): add attention layer v1 — local events API, web push, silence and health lanes。

不做：通知内审批、通知带终端输出尾行、通知深链直达 tab、多设备订阅 UI、跨机事件源、
解析任何 agent 输出（herdr 输出解析 spike NO-GO 继续有效）、改 agent-config 仓
（badge 车道在 zlxlabs/agent-config#495，等其认领）。
```

## 持久参考

### 结果与边界

用户最终拿到的是「呼机」：agent 需要你时手机会响（延迟下界=事件源节律；badge 车道
接入后典型 60-90 秒；herdweb 自有静默车道 3-5 分钟）。通知点开**聚焦 herdweb app**
（不深链具体 tab——Deferred）。错过的通知可回看。服务自身异常不再是盲区。

- 部署前提（v1 硬约束）：外部事件源与 herdweb **同机**（/api/events 仅回环）。
  跨机是显式 non-goal。
- iOS 依赖：必须添加到主屏幕（Safari 标签页无 Push API）；iOS 16.4+，标准 VAPID
  即可（Apple 侧中继透明，无需 APNs 开发者注册）。
- 执行边界（2026-08-22 用户裁定）：herdweb 会话不跨仓；agent-config 侧经
  zlxlabs/agent-config#495 交接（契约自包含），不阻塞 herdweb 收口。

### 不变式（违反任何一条=实现错误）

- 状态目录按端口分仓 `~/.local/state/herdweb/{port}/`；绝不共享。
- 事件体禁止终端输出内容；title≤120/body≤200/reason≤120/payload≤4KiB。
- kinds 无 `failed`、无 `tool` 字段。
- /api/events 校验+落盘后 202；推送异步；202 ≠ 已送达手机。
- 去重集合内存 1000 FIFO；跨重启不保证（内部事件靠确定性 id）。
- SW 无 fetch handler，永不缓存（不得干扰 M2 重连语义）；notificationclick 不注入
  任何输入帧。
- 停机顺序：PTY exit → last-session.json → await 在途推送 → server.close()。
- PTY 任意退出都推 health（监控面消失必须可见）；120s 内退出+重启=一条通知。
- 关订阅=服务端 DELETE 该 endpoint。
- config/state 分工：runtime truth 走 state 文件，policy knobs 走 config
  （notify.silence.*、notify.history.limit、notify.vapid.* 覆盖进 config；其余状态进 state dir）。

### 架构与数据流

```text
外部源（agent-config badge 车道，issue #495）      内部车道
  asking/done/ci-red ──┐                    ┌─ silence（字节累加器→30s 定时器）
                       ├─→ POST /api/events ─┤
  test（面板按钮）─────┘   （回环+token，     └─ health（PTY exit / sessionId diff）
                            限流/4KiB/schema/
                            去重→202）
                                │
                                ├─→ events.jsonl（O_APPEND+惰性截断，test 不落盘）
                                │        └─→ GET /api/events/history（卡 3 列表）
                                └─→ web-push（VAPID）→ FCM/Apple → 手机 SW
                                        ├─ push → 展示通知
                                        ├─ notificationclick → matchAll 聚焦 / openWindow
                                        └─ pushsubscriptionchange → DELETE+重订阅

状态（~/.local/state/herdweb/{port}/）：vapid.json(0600) / push-subscriptions.json /
events.jsonl / last-session.json（按 herdr --session 键控）
```

### 拆卡与依赖

| 卡 | 范围 | 依赖 |
|---|---|---|
| 卡 1 推送管道 | serve.ts 端点+sw.js 路由+CSP+排空框架；src/notify/*；SW 源+client-entry 注册；config-schema notify.*；订阅开关+测试按钮+iOS 引导 | — |
| 卡 2 内部车道 | 静默状态机（session.ts 字节累加器）；健康单通知（last-session.json diff+120s 窗）；停机排空完整实现 | 卡 1 |
| 卡 3 历史收件箱 | history 端点 + 面板内列表 | 卡 1 |
| 收尾 | README 通知节 + skill onboarding + GOALS.md | 全部 |
| （卡 4 badge 车道） | zlxlabs/agent-config#495，本会话不做 | 认领后联调 |

代码锚点（行号为 2026-08-22 快照，以符号为准）：serve.ts `buildSecurityHeaders` 约
:156（CSP 串 :168）、`app.use` :449、serve 退出序列约 :661；session.ts `sessionId`
约 :65、snapshot 帧 :157/:177；client-entry.ts 现无 SW 注册；config-schema.ts 为
Valibot strictObject 风格（notify.* 键照此接）；tests/serve.test.ts 有 CSP 快照断言。

### 本地漏斗与 PR 纪律

- 漏斗顺序：pnpm test → tsc --noEmit → build:dist → check → test:pw（新时序测试 5 连跑；
  弱网 e2e 回归）。
- 已知噪音：本地 check 的红来自 .omo/run-continuation 与 codegraph 本机私有文件，CI
  干净检出不受影响；test:pw 偶发红家族（webkit-iphone 弱网超时、chromium-android
  touch、asr goto 超时）——隔离复跑判定，不当作回归掩盖。
- 进入 review 前读 review-discipline；本功能集中在状态/失败路径，按 infra 例外连续
  2 轮无新增 P1 收敛；完整 gate 非 SKIPPED 且全绿才合并。
- api.github.com 间歇超时：gh/git push 失败重试即可，操作前先查状态防重复。
- main 若被其他会话锚定，一律 worktree 绕行不抢锚。

### 真机人工门（不进 CI，收口必做）

Android Chrome + iOS 主屏 PWA 各一轮：①订阅成功 ②测试按钮→通知到达 ③点通知聚焦/
打开 ④agent 跑循环后停 → 静默通知 ⑤systemctl --user restart 对应实例 → 一次事故
只收一条 ⑥历史列表可回看。curl 直发 /api/events 模拟外部源全链路通（不依赖 #495）。
