# 里程碑进度：M2 — 画面新鲜可信

- **负责主脑**：claude-opus5（herdr tab `w15:t1`）
- **状态**：进行中（代码已合并进 main，只等真机入口层证据）
- **预期产出**：合并后主干上，用户回到页面时能分辨画面是「过期 / 重连中 / 同步中 / 已同步」，
  而 `已同步` **只**由当前连接的完整 snapshot 产生；断线期间敲的键**不会**被重放进终端。
- **当前范围**：
  - 做（T2 服务端）：`sessionId`、output `seq`、snapshot `outputWatermark` 与稳定循环、
    带 ID 的 ping/pong、mirror 写失败 fail-loud（替掉 `session.ts:120` 的 `.catch(() => {})`）。
  - 做（T3 客户端）：连接状态唯一事实源、epoch 隔离旧 socket、10 秒 snapshot deadline、
    单在途心跳、前后台强制换新连接、事件合并、1 MiB 缓冲上限、
    **删除 `queuedMessages` 全量重放**、resize 合并、四态 UI。
  - 不做：增量 snapshot、`ConnectionManager` 通用类、协议版本协商、离线输入缓存、Mosh。
- **对应任务卡**：
  - `docs/sessions/cards/wnet-t2-server-contract.md`（T2）
  - `docs/sessions/cards/wnet-t3-client-reconnect.md`（T3，硬依赖 T2 合并）
- **关键决策**：
  1. `synced` **只能**由当前 epoch 的 snapshot 产生。socket OPEN ≠ 已同步——
     `isConnected()` 的布尔语义随之从 OPEN 收紧到 synced。
  2. 进后台立刻作废 `synced` 并主动关 socket；回前台**无条件**建新连接，
     哪怕旧 socket 还显示 OPEN。手机上「socket 看着还开着其实早死了」是常态。
  3. 连续 3 次同步前失败只**提示**可能需要重新认证，**不自动刷新页面**——
     自动刷新会把用户没提交的草稿刷没，而 Access 过期与网络故障在浏览器侧无法可靠区分。
  4. 断线期间的普通按键**丢弃且不排队**。当前的队列重放不是体验问题：
     重放的按键会真的执行进 Herdr。
- **已知阻塞**：只剩真机入口层证据（依赖用户本人跑 T0 场景）+ T3 尚未完成。
- **进度**：
  - **T2 已收敛并合并**（PR #13 → `513d3fb`）。四轮审查：①主脑 diff+抽跑+红验 0 P1；
    ②Codex 换四证据源抓到 P1-1（node-pty 写失败不同步抛异常，`pty-write-failed` 是死分支
    而 accepted 照发，且去重账本把错误固化）；③修复后主脑增量四问审 0 P1；
    ④Codex 协议 fuzzing + 资源账本长跑 verdict `pass`、P1=0。连续 2 轮无新增 P1，收敛。
  - **已接受不修的 P2（backlog）**：`terminalFailed` 之后 PTY 的 `onData` 未解绑，
    失败 session 仍在空转计数（实测 20 MiB 输出后 `outputSeq` 904→561756、CPU user 2.08s），
    但强制 GC 后 heap 反降、fd 与子进程干净，无泄漏无崩溃。用户此时已收到
    `Terminal failed; restart remobi.`，开销只存在于"看到错误却不重启"的窗口。
  - **已记录的设计限制**：`accepted` 只证明 data 已交给 PTY 写入队列，不保证操作系统层面
    写入成功（详见设计文档 `## Known Limitations`）。
  - **T3 已合并**（PR #17 → `1a00a26`）。四轮修复，中途触发过一次补丁追逐熔断：
    四条 finding 全落在生命周期/可达性边界，遂改做系统性收口——加不依赖事件的
    `lastProvenFreshAt` 时间证明，并把 I1/I2/I3 三条不变式写进设计文档。
    第 3 轮独立审查用真实 Chromium 抓到 2 条 P1（冻结后旧 epoch 仍算 synced；
    离线时 OPEN socket 让按键进浏览器发送缓冲、恢复后真的执行）——**这两条 happy-dom 测不出来**。
  - **双连接 bug 已修复并合并**（PR #19 → `9d9b627`）：T3 带进来的时序竞态，
    每次加载都构造两个 WebSocket，WebKit 报 console error 使 main 红了约 8 小时。
    教训已提 agent-config issue #419（合并后主干 CI 无人盯）。
- **推进前必须拿到的证据**：
  - [ ] 全量单测 + Playwright 绿；环境：本地；命令：`pnpm test`、`pnpm run test:pw`
  - [ ] **时序测试连跑 5 次全绿**（T2 的 session 测试、T3 的连接状态机测试各自 5 次）；
        环境：本地；主脑验收会独立抽跑 ≥5 次
  - [ ] **跨进程边界证据**：至少 2 个用真实 WebSocket 连接、断言**原始帧字符串**的集成测试
        （snapshot 帧含 `sessionId` + `outputWatermark`；同 id 同 data 重送只写一次 PTY）；
        环境：本地 vitest 起真 server；仅断言同进程函数返回值不算
  - [ ] 静态检查与构建绿；环境：本地；命令：`pnpm run check`、`pnpm exec tsc --noEmit`、
        `pnpm run build:dist`
  - [ ] **用户真实入口层证据**：Android + iOS 经 Cloudflare 生产地址各跑一次——
        ①切 Wi-Fi/蜂窝后界面**不再**显示已同步，恢复后应用 snapshot 才回到已同步；
        ②锁屏 30 分钟回来，画面与电脑端同一 session 的真实内容一致；
        ③断网期间敲键盘，恢复后终端里**没有**那些按键；
        ④弱网期间终端持续输出，恢复后画面收敛且**无重复字符**；
        环境：生产；真实入口：手机浏览器打开生产 URL。
  - [ ] T0 真机基线已录（`docs/sessions/260820-2016-wnet/T0-baseline-*.md`），
        并确认 Android/iOS 的事件顺序**不需要**按平台分叉；若实测发现需要分叉，T3 卡要改。
- **完成条件**：上面六条证据全部拿到，T2 与 T3 两张卡都走完 PR 漏斗合并进 `main`。
