# 增量 4 主脑增量审（H0..H1）与收敛记录

- 审查范围：`bea80cc..3d96042`（3 个 commit，+30/-24）
- 审查者：主脑会话（kimi）
- 前一轮：Codex 独立终审 round1（`955a900..bea80cc`），verdict=changes_requested，0 P1 / 2 P2 / 2 P3（1 条 P3 接受进 backlog）

## 增量审四问

1. **本轮是否只修登记在案的 findings？** 是。3322726→P2-1（× 挂 suppressSynthesisedMouse + touchend defaultPrevented 回归用例）、9c5bc51→P3-1（dismissDrawer 去重）、3d96042→P2-2（删 open 镜像状态/isOpen()/单实现接口）。仅动卡面允许的 4 个文件。
2. **是否新增未经批准的抽象？** 否。dismissDrawer 是同作用域局部函数（OCR 登记的待修项本身）；焦点防护复用既有导出 helper。
3. **状态/事实源/fallback 是否无依据增加？** 否——反向：删掉了 open 状态镜像与私有 interface。
4. **是否留下双路径？** 否——× 与 backdrop 共享 dismissDrawer；× 焦点防护与 d-pad/keyboard-toggle 同一路径。

## 收敛判定

- personal 档：连续 1 轮无新增 P1 即收敛。round1（Codex 全量审）0 P1 → round2（本增量审，换视角：四问审计）0 新增 P1、0 新增任何 finding。**收敛**。
- 修复后 CI 电池（test/check/tsc/build:dist/knip/publint/ox/pw:chromium）主脑亲跑 8 项全 exit 0。

## 裁决记录（备查）

- OCR [medium] d-pad 按钮缺 type="button"：判拒——overlay 挂 document.body 无 form 上下文，toolbar/drawer 既有按钮均未设此属性。
- OCR [low] CSS handle margin 耦合 header：判拒——假想未来变体，反过度设计。
- Codex P3-2（自定义 row2 时 d-pad 遮挡第二行 40px）：接受进 backlog——row2 为 opt-in 非默认，d-pad 可即关，修复需引入布局测量机制，违反 shrink-only。
