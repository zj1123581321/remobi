# 项目里程碑路线图

## 项目目标

- **目标**：在 Android 和 iOS 手机上，经 Cloudflare Tunnel + Access 使用 herdweb/herdr 时，
  离开几十分钟、切网或锁屏回来后，用户能同时确认三件事——**看到的画面是新鲜的**、
  **写了一半的长语音草稿还在**、**刚提交的整条指令到底收没收到**。
- **完成定义**：三条不变式全部在 Android 与 iOS 的**真实生产入口**上各验证过一次，
  且 `pnpm test` / `pnpm run test:pw` / `pnpm run check` / `pnpm run build:dist` 全绿。
  单测绿、draft PR 绿都不算完成。

设计出处：`docs/designs/weak-network-experience.md`（CEO + Eng review 均 CLEAR）。

## 当前激活里程碑

- **ID**：M3
- **推进文件**：goals/M3-atomic-submit.md

> M1、M2 已于 2026-08-22 完成（双平台真机证据收口，入口为 Tailscale tailnet dev 实例，
> 用户指定）。M3 的 T4 卡代码已合并，本地证据 2026-08-22 补齐，只差真机入口层证据。

## 里程碑索引

| ID | 名称 | 状态 | 排序 | 优先级 | 跨里程碑依赖 | 进度文件 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | 草稿不丢 | 已完成 | 1 | 高 | 无 | [goals/M1-draft-survives.md](goals/M1-draft-survives.md) |
| M2 | 画面新鲜可信 | 已完成 | 2 | 高 | 无 | [goals/M2-fresh-screen.md](goals/M2-fresh-screen.md) |
| M3 | 提交不重不漏 | 进行中 | 3 | 高 | M1、M2（均已完成） | [goals/M3-atomic-submit.md](goals/M3-atomic-submit.md) |

## 路线图审计

- **审计日期 / 增量**：2026-08-22 · M1/M2 完成（真机双平台证据 + 本地漏斗全绿）
- **里程碑真完成了吗？**：是。M1 四条、M2 六条证据逐条拿到；入口按用户指令走
  Tailscale tailnet dev 实例（原计划 Cloudflare 生产入口，差异仅认证层，已记录在 goal 文件）。
- **下一个目标还是对的吗？**：对。M3 是三条不变式的最后一条，T4 代码早已合并且在用。
- **有没有漏掉的里程碑？**：暂无新增。M2 的 backlog P2（terminalFailed 后 PTY onData 未解绑）
  已记录在设计文档，不阻塞。
- **新证据是否改变了工作顺序？**：无。M3 是唯一剩余项。
- **done 的定义还成立吗？**：成立——但与 M1/M2 同理，真机证据入口预计同样走
  tailnet dev 实例（需包含一次服务重启验证 pending 转 unknown）。
- **审计结论**：弱网里程碑路线图健康，M3 收口即整体完成。
