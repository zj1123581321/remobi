# 里程碑进度：M3 — 提交不重不漏

- **负责主脑**：claude-opus5（herdr tab `w15:t1`）
- **状态**：进行中（代码已合并进 main，只等真机入口层证据）
- **预期产出**：合并后主干上，提交一整条长语音指令会得到诚实的状态——
  「未发送 / 待确认 / 已接收 / 结果未知 / 未接收+原因」；确认帧丢失后用同一 ID 重送，
  **PTY 不会被写第二次**；`autoEnter` 的回车与正文是同一次写入。
- **当前范围**：
  - 做：`input-action` 接入、pending **先落盘再发送**、hook 单次语义、
    accepted / rejected / unknown 状态机、同 session 新 epoch 至多一次自动重送、
    sessionId 变化转人工判断、状态 UI（`aria-live`，不只靠颜色）。
  - 不做：跨进程 exactly-once、通用 outbox、多条并发 pending、给普通逐键输入加确认、
    多设备同步。
- **对应任务卡**：`docs/sessions/cards/wnet-t4-atomic-submit.md`（T4，硬依赖 T1 + T3 合并）
- **关键决策**：
  1. `accepted` 的语义**只有**「remobi 成功调用了当前 PTY 的 `write(data)`」——
     不代表操作系统已落盘，**不代表 Herdr 已执行**。任何文案都不许暗示"已执行/已完成"。
  2. **先落盘 pending、后发帧**，顺序不许调换：反过来的话，发出去那一瞬间页面被杀掉，
     用户就永远不知道那条指令去哪了。
  3. accepted 到达时**无条件**清 pending，但**只有** draft 仍等于 `sourceText` 才清 draft——
     用户在等待期间改出来的新文本必须留着。
  4. sessionId 变了就转 `unknown` 且**禁止**自动重送。服务重启会重建 PTY session，
     盲目重送等于重复执行一条命令。
  5. 自动重送**每个 epoch 至多一次**，且**不跑** before/after hook——
     传输层重试不是一次新的业务动作。
- **已知阻塞**：只剩真机入口层证据（依赖用户本人跑 T0 场景）。
- **进度**：**T4 已合并**（PR #18 → `f40fd6a`），首轮即过。
  核心 e2e `lost accepted retries the same action once and writes PTY once` 通过——
  确认帧丢失后同 ID 重送，PTY 只被写一次，即设计成功判据 #4。
  `sendInputAction` 复用 T3 的三道可达性门槛，但失败时保留 pending 而非丢弃。
- **推进前必须拿到的证据**：
  - [ ] 全量单测 + Playwright 绿；环境：本地；命令：`pnpm test`、`pnpm run test:pw`
  - [ ] **时序测试连跑 5 次全绿**（含 15 秒 deadline 与自动重送）；环境：本地；
        主脑验收会独立抽跑 ≥5 次
  - [ ] **跨边界证据两条**：①客户端实际发出的帧字符串——`autoEnter` 开启时一次提交
        **恰好一帧** `input-action` 且 `data` 以 `\r` 结尾（不是两帧）；
        ②localStorage 里 pending 的实际 JSON，且能断言**落盘早于发帧**；
        环境：本地 vitest
  - [ ] **弱网 e2e**：发送成功后立刻离线（模拟 accepted 丢失）→ 恢复 → 同 ID 重送 →
        服务端去重 → 终端里**仍然只有一次**；环境：本地 Playwright（`context.setOffline`）
  - [ ] **用户真实入口层证据**：Android + iOS 经 Cloudflare 生产地址各跑一次——
        ①提交长指令后断网再恢复，终端里那条命令**只出现一次**；
        ②等待期间改草稿，accepted 到达后 pending 清了而**新草稿还在**；
        ③重启 remobi 服务后旧 pending 变「结果未知」且**不会**被自动重送；
        ④`autoEnter` 开启时终端里只多出一次回车；
        环境：生产；真实入口：手机浏览器打开生产 URL 并用语音输入。
- **完成条件**：上面五条证据全部拿到，T4 卡走完 PR 漏斗合并进 `main`；
  设计文档 Success Criteria 的 8 条逐条对照过一遍，尤其第 4 条（ack 丢失后同 ID 重送不产生
  第二次 PTY 输入）与第 5 条（不声称 Herdr 已执行）。
