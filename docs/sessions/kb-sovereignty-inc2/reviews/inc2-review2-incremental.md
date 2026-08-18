# 增量 2 审查第 2 轮：H0..H1 增量审（主脑）

- **范围**：`a242992..aab6c86`（5 个修复 commit，246+/112-，6 文件）
- **角色**：主脑增量审（视角：修复增量四问，与第 1 轮 Codex 全量审不同视角）
- **新证据**：H0..H1 diff 逐行阅读 + 修复后全漏斗复跑（tsc/biome/vitest 466/build:dist/pw keyboard-toggle spec）

## 增量审四问

1. **是否只修登记在案的 findings** —— 是。5 commit = P2-1（adf947e）+ P2-2（9b840a3）+ P2-3（d90ee1e）+ P2-4（aab6c86）+ import 排序 style（23dfed6）。无顺手活，verdict 的 P3/backlog 项未动。
2. **是否新增未经批准的抽象** —— 无。`decorateKeyboardToggleButton` 是修复卡批准的唯一新抽象（toolbar/drawer/floating 三调用方实证）；`syncKeyboardIndicators` 是既有 toolbar 逻辑的 document 级搬迁（createToolbar 的 keyboard 参数随之删除，净减法）。
3. **状态/事实源/fallback 是否无依据增加** —— 无。三信号不变；auto 迁移删掉了 keyboardVisible 参与（减法，回归 T-B）；逃生入口仍纯函数；init 只加 lifecycle 接线（`keyboard?.dispose()`）。无 fallback/重试/防御式 catch。
4. **是否留下双路径** —— 无。toolbar 旧指示器路径整段删除；三 renderer 统一走 decorate helper；`reportKeyboardUnavailable` 单点调用（移到 floating 创建后，错误态覆盖三处）。

## 结论

**pass，0 新增 P1，0 新增 P2。** 四条 P2 的修复与第 1 轮 verdict 的 backlog 修复方向逐条对上；执行器另附模拟器真机补验（drawer 内 ⌨ 解锁链路，adb 真实触摸 + mInputShown 取证）。

## 收敛计数

- 第 1 轮（Codex 全量审，`e8b9ba6..a242992`）：0 P1。
- 第 2 轮（本轮，主脑增量审 + 全量复验）：0 新增 P1。
- internal 提档 saas 的收敛条件「连续 2 轮无新增 P1」**已满足**，review 循环收敛。

## 遗留（不阻塞合并）

- verdict P3 项与 backlog（bridge throw 契约、CSS `safe center` 旧浏览器视觉降级、iOS/IME/实体键盘真机闸门）按设计文档 Deferred 记录，随真机矩阵补测。
- pw 全量在本机的 multi-client/mouse-encoding 超时为资源争用 flake（执行器在 base commit 对照复现实验证明与本 diff 无关），以 CI 为准。
