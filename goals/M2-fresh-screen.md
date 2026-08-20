# 里程碑进度：M2 — 画面新鲜可信

- **负责主脑**：claude-opus5（herdr tab `w15:t1`）
- **状态**：进行中
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
- **已知阻塞**：T3 必须等 T2 合并进 `main` 后才能派（硬依赖协议字段）。
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
