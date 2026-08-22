# 里程碑进度：M1 — 草稿不丢

- **负责主脑**：claude-opus5（herdr tab `w15:t1`）
- **状态**：已完成（2026-08-22 四条证据全部收口，真机走 tailnet dev 入口）
- **预期产出**：合并后主干上，语音 composer 的草稿写进 `localStorage`，
  刷新 / `pageshow` / 断线 / 切网都不会静默清掉它；存储损坏或不可用时给出可见提示而不是默默失效。
- **当前范围**：
  - 做：`remobi:composer:v1:${basePath}` 的 schema 读写、三类失败路径（坏 JSON、
    schema 不匹配、存储不可用）、`pageshow` 恢复的冲突规则、
    「sanitize 后为空则整条不发送」的回归锁定。
  - 不做：pending action 的发送与确认（M3）、IndexedDB、通用 store 类、多标签页协同。
- **对应任务卡**：`docs/sessions/cards/wnet-t1-draft-persistence.md`（T1）
- **关键决策**：
  1. schema 一次定死为 `{version:1, draft, pending}`——M1 不写 `pending` 但必须原样透传，
     否则 M3 得改两遍格式、存量草稿会失配。
  2. `pageshow` 时**只有 textarea 为空**才从存储恢复。非空说明内存态更新（bfcache 或用户刚打字），
     覆盖它就是数据丢失。
  3. partial（ASR 中间结果）不落盘——它走 rAF 每帧刷新，同步写会阻塞主线程；
     而且 `visibilitychange → hidden` 本来就会取消录音丢弃 partial。
- **已知阻塞**：无（2026-08-22 已解除）。
- **进度**：PR #14（`card/wnet-t1`）已开，两轮定局 accepted，记分卡已入账
  `retro/acceptance-log.jsonl`（task_id `remobi-20260820-13`，rounds=2）。
  首轮被主脑打回两条缺陷（坏存储静默丢字 P1、恢复草稿弹开面板 P2），
  续修后主脑独立探针复验通过、H0..H1 增量审四问全过。
- **推进前必须拿到的证据**：
  - [x] 全量单测绿；环境：本地；命令：`pnpm test` → 44 文件 / 673 测试全绿（2026-08-20 主脑独立复跑）
  - [x] 轴表每一格有断言，且断言的是**实际写入 localStorage 的 JSON 字符串**
        （不是 `preview.getText()` 这类内存返回值）；环境：本地；命令：同上。
        另做红验：13 条新测试有 12 条在 `ba25ddf` 上失败，剩 1 条经定向改坏实现确认有约束力
  - [x] 静态检查与构建绿；环境：本地；命令：`pnpm run check`、`pnpm exec tsc --noEmit`、
        `pnpm run build:dist`（执行器报告 + CI 复验）
  - [x] **用户真实入口层证据**（2026-08-22 用户确认双平台通过）：
        Android Chrome + iOS Safari 各输入 ≥3 行中文长草稿，刷新与锁屏 30 分钟后草稿逐字还在。
        **入口变更**：本条原始环境写的是 Cloudflare Tunnel + Access 生产地址；
        2026-08-22 用户指定改走 Tailscale tailnet 入口
        `https://zlx-vm-work-i5-ubuntu2404-devcontainer.taile9071.ts.net/herdweb/`
        （herdweb-debug 7691，herdr `herdweb-dev` 会话，main 最新代码，ASR 已启用）。
        入口差异仅认证层（tailnet vs Cloudflare Access），localStorage/pageshow 行为与入口无关。
- **完成条件**：四条证据全部拿到（2026-08-22），T1 卡已合并进 `main`（PR #14）。**里程碑完成。**
