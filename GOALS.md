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

- **ID**：M1
- **推进文件**：goals/M1-draft-survives.md

> 注：M1 与 M2 的第一张卡（T1 / T2）文件范围零重叠，已并行派发。
> M2 的第二张卡（T3）硬依赖 T2 合并，M3 硬依赖 M1 + M2 全部合并。

## 里程碑索引

| ID | 名称 | 状态 | 排序 | 优先级 | 跨里程碑依赖 | 进度文件 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | 草稿不丢 | 进行中 | 1 | 高 | 无 | [goals/M1-draft-survives.md](goals/M1-draft-survives.md) |
| M2 | 画面新鲜可信 | 进行中 | 2 | 高 | 无 | [goals/M2-fresh-screen.md](goals/M2-fresh-screen.md) |
| M3 | 提交不重不漏 | 未开始 | 3 | 高 | M1、M2 | [goals/M3-atomic-submit.md](goals/M3-atomic-submit.md) |

## 路线图审计

- **审计日期 / 增量**：尚未审计（M1/M2 首批卡 2026-08-20 派发）
- **里程碑真完成了吗？**：—
- **下一个目标还是对的吗？**：—
- **有没有漏掉的里程碑？**：—
- **新证据是否改变了工作顺序？**：—
- **done 的定义还成立吗？**：—
- **审计结论**：—
