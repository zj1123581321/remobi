# 里程碑进度：M1 — 草稿不丢

- **负责主脑**：claude-opus5（herdr tab `w15:t1`）
- **状态**：进行中（代码已合并进 main，只等真机入口层证据）
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
- **已知阻塞**：只剩真机入口层证据（依赖用户本人跑 T0 场景）。
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
  - [ ] **用户真实入口层证据**：在 Android Chrome + iOS Safari 上，
        经 Cloudflare Tunnel + Access 的生产地址，各输入一段 ≥3 行中文长草稿，
        刷新页面与锁屏 30 分钟后回来，草稿**逐字**还在；
        环境：生产（`systemctl --user status remobi.service` + Cloudflare 入口）；
        真实入口：手机浏览器打开生产 URL，不是 localhost、不是 Playwright。
- **完成条件**：上面四条证据全部拿到，T1 卡走完 PR 漏斗合并进 `main`。
