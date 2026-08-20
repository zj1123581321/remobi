# 2026-08-20 Fork 独立：专注 herdr WebUI 体验

## 决策

remobi 从 upstream（connorads/remobi）分叉独立发展，不回馈 upstream，也不向 npm 的
`remobi` 名字发布（该名字归 upstream 所有）。项目定位收敛为：**优化 herdr 的
移动端 WebUI 体验**。

herdr 的生产与 Tailscale 调试部署契约归档在本仓的 `docs/deploy-herdr.md`。

## 背景

- 2026-08-19/20 完成 ASR 语音输入特性（三个增量：spike → 引擎核心 → Mic 交互），
  全部合并进 main（PR #6/#7/#8）。该特性是 herder 在手机上语音驱动 coding agent
  的关键交互。
- semantic-release 在 fork 里本就无法真发布（`package.json` 的 repository 指向
  upstream，npm 名字冲突），决策后这不再是问题——发布通道后续按 herdr 集成需要
  再定（改名发布或干脆不发布）。
- fork 起点 upstream 之后不再跟踪；upstream 的更新需要时手动 cherry-pick。

## 影响

- 版本号/changelog 继续由 semantic-release 在 main 上驱动，但不发 npm；
  如需彻底关掉 release job，后续单独处理。
- 后续功能迭代以 herdr webui 体验为唯一优先级标尺。
