# 任务卡：ASR 增量 0 Spike — 豆包大模型流式 ASR 浏览器直连 go/no-go 探针

## 目标

实证「火山引擎大模型流式 ASR（SAUC bigmodel）能否用 query 参数鉴权从浏览器直连」：
Node 探针验证握手/音频上行/partial-final 下行并录制真实协议帧 fixture，
外加浏览器探针页与协议备忘，产出 go/no-go 结论。这是整个 ASR 特性的唯一阻塞闸门；
no-go 也是有效产出，禁止硬凑 go。

## 非目标

- 不碰 `src/` 生产代码、不写任何正式实现（增量 1 才写引擎）。
- 不 push、不开 PR、不合并。
- 不实现服务端代理方案（no-go 退路由主脑重评，不由执行器临时发明）。
- 不引入新依赖（`ws`、`tsx` 主仓已有；浏览器探针页零依赖手写）。

## 基线与所有权

- **Task-Id**：
- **Diff-Lines-Target**：2500
- **Diff-Lines-Hard**：5000
- **阶段**：implementing
- **锁定决策**：
  - 权威设计文档 `docs/designs/asr-voice-input.md`（v5）全部 Scope Decisions 与 Eng Review 锁定项
    （经主仓绝对路径只读访问，见「现场事实」）；本卡是它的增量 0 执行摘要，冲突以设计文档为准。
  - 密钥威胁模型已裁决（C8）：单人自部署，密钥下发浏览器可接受——spike 不重审。
  - spike 落点已定（R9）：代码 `spikes/asr/`（可丢弃），fixture `tests/fixtures/asr/`（进 main）。
  - 结果文档文件名格式 `docs/sessions/260819-<HHMM>-asr-spike-results.md`（交接卡定死）。
- **任务类型**：backend-logic
- **复杂度**：M
- **Base commit**：ce2de68b0aa6454bf28ba30ab97b2b4d1db06367（origin/main。
  注意：设计文档与交接卡在本地 main 的 a2dfa9e/f82bbbd 两个未 push commit 里，
  worktree 内没有——一律经主仓绝对路径只读访问，见下）
- **Branch**：由 delegate 分配（card/<worktree 名>），执行器不得另建分支
- **Worktree**：由 delegate 分配
- **当前唯一写入者**：本卡执行器（主脑只读验收；主仓 checkout 另有 untracked 草稿，只读参考）
- **执行器与模型**：codex（delegate --class big，按 envelope 实际值回填）
- **执行器角色声明**：本会话就是执行器（implementer 角色），全局 AGENTS.md「模型编排」段的主代理委派纪律**不适用于本卡**；不限制亲自落盘还是委派子代理，唯一硬约束是最终产物落在指定路径——子代理不返回就直接自己写完。
- **计划者与审查者**：主脑 kimi-lead 拆卡与验收；review 按仓 risk-tier（未声明，按 internal）执行

## 修改边界

- **允许**（全部在 worktree 内）：
  - `spikes/asr/`（探针脚本、浏览器探针页、PROTOCOL-NOTES.md、report.md）
  - `tests/fixtures/asr/`（真实协议帧 fixture）
  - `docs/sessions/260819-<HHMM>-asr-spike-results.md`（结果文档，仅此一个文件）
- **禁止**：`src/`、`tests/` 下除 `tests/fixtures/asr/` 外的任何文件、`package.json`/lockfile、
  `.github/workflows/`、CHANGELOG.md、主仓 checkout（worktree 外）的任何写入。
- **Scope-Globs**：spikes/asr/** tests/fixtures/asr/** docs/sessions/260819-*
- **高风险区域**：密钥处理。密钥只从 `/home/zlx/projects/oss/remobi/spikes/asr/.env.local`
  （主仓 untracked 文件，绝对路径只读）或环境变量 `VOLC_APP_KEY`/`VOLC_ACCESS_KEY` 读取；
  任何输出物（fixture、transcript、meta.json、备忘、结果文档、report、git commit message）
  禁止出现密钥值与完整带参 wss URL（只打 origin + query 参数名列表）。
  STS token 响应体禁止原文落盘（需要标识就打 sha256 截断）。

## 完成条件

- **行为验收**（对应交接卡验收清单，逐项给证据）：
  1. query 鉴权握手在 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel` 成功
     （候选组合逐一试，见「现场事实」的侦察结论；401/403 即该组合失败，记录 HTTP 状态码 +
     X-Tt-Logid 若可见；全部组合失败 = no-go）。
  2. header 鉴权对照组（Node 可设 `X-Api-App-Key`/`X-Api-Access-Key`/`X-Api-Resource-Id`），
     用于区分「密钥错」与「query 方式不支持」。
  3. 握手成功后：发 full client request（16kHz/16bit/mono PCM）+ 程序生成 PCM 音频包
     （正弦波即可），收到服务端响应；全部收发帧 hex dump 落 `tests/fixtures/asr/`
     （每帧一个 .hex 文件 + transcript.jsonl 索引，含方向/label/解析出的 header nibble）。
  4. 尾包 variant 定案：flags `0b0010`（无序列最后包）vs `0b0011`（带序列最后包）各试一次，
     用实帧确定服务端接受哪种、payload offset 差异，写进备忘（Codex 二轮 #8 明确要求）。
  5. 三类错误表现记录：握手拒绝（Node 拿得到状态码，浏览器拿不到——两侧差异写明）、
     协议错误帧 0xF、业务错误帧 0x9（含 X-Tt-Logid 握手后是否可见）。
  6. opus 附带探针：full client request 的 audio format 改 `opus` 其余不变，确认是否被接受。
  7. 浏览器探针页 `spikes/asr/probe.html`（单文件零依赖）：AudioContext 16k 实际采样率输出、
     AudioWorklet addModule 可用性、getUserMedia 可用性（区分 Safari 标签页/主屏 PWA/Android Chrome）、
     中断信号观察（track.onended/onmute/AudioContext.statechange/visibilitychange，
     页面打日志）+ 给用户的一页操作步骤（含 https 前置说明：LAN http 非 secure context，
     需 Tailscale Serve 或反代）。**真机操作由用户执行，执行器只负责页面与步骤**；
     结果文档中真机各项标「待用户真机回填」。
  8. go/no-go 结果文档：每项 ✅/❌ + 证据（日志摘录、fixture 路径）、结论、对增量 1 的影响
     （opus/采样率/尾包 variant 结论）+ 密钥零泄露自查声明。
- **相关测试**：spike 无仓内测试；验证 = 探针实跑日志（Node 探针必须在密钥就位后真实运行，
  禁止只写脚本不跑）。若密钥文件缺失导致探针无法运行：先完成全部不依赖密钥的产出
  （脚本、探针页、备忘骨架），outcome 写 failed 并在报告中明确「阻塞：密钥未就位」。
- **跨发布边界不适用**：fixture 是录制产物不是跨进程契约边界；增量 1 的 golden 测试由后续卡负责。
- **lint / typecheck / build**：`pnpm exec biome check spikes/asr`（若 biome 不认 spikes 目录则在
  biome.json 忽略列表确认后跳过并说明）；探针脚本须 `node_modules/.bin/tsx --no-cache` 可解析运行。
- **截图或探活**：Node 探针各模式运行 stdout 摘录进报告；fixture 目录清单（`ls` + 总字节数）。
- **现场还原**：收工时 worktree 停在 card 分支；主仓 checkout 不得有任何改动；
  `.env.local` 不得被复制/移动/删除。
- **提交纪律**（固定条款）：执行器必须在本卡分支上小步 commit（署名/归因由 delegate 自动注入），
  未提交的工作按未完成处理，不得把提交留给验收方。具体节奏：按
  ①探针脚本 → ②浏览器探针页+步骤 → ③真跑 fixture（密钥就位后）→ ④备忘+结果文档
  至少 4 次提交；fixture 用 `test:` 或 `chore:`，探针代码与备忘 `chore:`，结果文档 `docs(sessions):`。
- **红验安全**（固定条款，原样保留）：凡按「改坏生产代码 → 确认测试红 → 还原」验证断言恒真性的红验，
  改坏前必须先 commit（或至少 stash）同文件里已验证的真修复；还原只许还原刚改坏的那一处，
  禁止整文件 `git checkout -- <file>`。
- **反熵条款**（固定条款，原样保留）：禁止顺手新增抽象——新增接口/包装层/状态/配置项时，
  报告须写明它的第二个消费者是谁，或单消费者仍必要的理由；说不出即撤。禁止为通过测试
  顺手加 fallback/兼容分支。
- **执行器自声明 outcome**（固定条款）：报告文件（spikes/asr/report.md）正文中、首个二级标题之前，
  必须恰好出现一行机读 outcome（HTML 注释承载），行首顶格、大小写敏感，二选一：

```
<!-- delegate-outcome: succeeded -->
<!-- delegate-outcome: failed -->
```

  值域只有 succeeded / failed。密钥未就位导致探针没跑成 = failed；探针跑了但结论 no-go = succeeded
  （no-go 是有效产出）。

## 当前状态

- **现场事实（主脑预取）**：
  - 设计文档（唯一权威，v5）：`/home/zlx/projects/oss/remobi/docs/designs/asr-voice-input.md`
    （主仓本地 main，worktree 内没有，**绝对路径只读**）。
  - 交接卡（本卡的任务详述与验收清单原文）：
    `/home/zlx/projects/oss/remobi/docs/sessions/260819-1244-asr-spike-inc0.md`（同上，绝对路径只读）。
  - 主脑已完成的 SDK 侦察（byted-ailab-speech-sdk@4.0.10 npm tarball，解包在
    `/home/zlx/projects/oss/remobi/spikes/asr/_sdk-ref/` 可参考）：
    - bigmodel query 鉴权官方 demo 参数组合：`api_resource_id=volc.bigasr.sauc.duration` +
      `api_app_key=<App Key>` + `api_access_key=Jwt; <STS token>`。
    - STS token：`POST https://openspeech.bytedance.com/api/v1/sts/token`，
      header `Authorization: Bearer; <Access Key>`，body `{"appid": <App Key>, "duration": 300}`，
      响应 `jwt_token` 字段。
    - 候选组合（逐一试）：①query 三参数 raw（api_access_key 直接放 Access Key 不加前缀）；
      ②query 三参数 + STS（`Jwt; <token>`）；③header 对照组。
    - SDK 协议常量（`_sdk-ref/package/dist/js/modern/features/asr/constants.js`）：
      version=0b0001；message type：client full=0b0001 / audio-only=0b0010 /
      server full response=0b1001 / ack=0b1011 / error=0b1111；
      flags：none=0b0000 / pos-seq=0b0001 / neg-no-seq=0b0010 / neg-with-seq=0b0011；
      serialization JSON=0b0001；compression none/gzip。header 4 字节，
      byte0=version|header_size(×4B)，byte1=type|flags，byte2=serialization|compression。
      错误帧带 8 字节描述（code+size），bigmodel 响应带 4 字节 sequence。
      注意 SDK demo 发送侧不 gzip 不带 sequence，与服务端实际要求可能不同——以实帧为准。
  - 主仓 checkout 有主脑写的探针草稿 `/home/zlx/projects/oss/remobi/spikes/asr/probe-auth.ts`
    （tsx 可解析、无密钥时 fail-loud 退出码 2；已含帧编解码/hex dump/STS/候选模式骨架）。
    **只是草稿**：执行器可抄可改可重写，最终产物落在 worktree 的 `spikes/asr/` 内。
  - 密钥：用户将写入 `/home/zlx/projects/oss/remobi/spikes/asr/.env.local`，格式
    `VOLC_APP_KEY=...` / `VOLC_ACCESS_KEY=...` 两行。开工时文件可能尚未就位——先做不依赖
    密钥的部分，探针实跑前再检查。
  - 用户设备：iPhone（iOS）+ Android 各一台，真机步骤由用户配合执行。
  - 仓 risk-tier 未声明，按 internal 处理（验收侧提醒主脑补声明）。
- **已完成**：任务 1（SDK query 鉴权参数侦察，结论如上）；主仓 spikes/asr/ 目录、
  `.gitignore`（忽略 `.env.local` 与 `_sdk-ref/`）、`tests/fixtures/asr/` 空目录、探针草稿。
- **未完成**：交接卡任务 2-6 全部。
- **关键决策**：转委派前主脑已动手写的草稿保留作参考而非推倒——避免重复劳动。
- **已否决方案**：blob: worklet（撞 CSP，设计文档 R10/E1）；MediaRecorder 主路径（待 opus 探针结论）。
- **修改文件**：尚无（worktree 未建）。
- **测试及结果**：`node_modules/.bin/tsx spikes/asr/probe-auth.ts query-raw`（主仓草稿）→
  按设计 fail-loud 退出码 2「缺少 VOLC_APP_KEY / VOLC_ACCESS_KEY」，证明脚本可解析。
- **已知问题**：火山文档站 www.volcengine.com/docs/6561/1354869 是 SPA，curl 拿不到正文
  （主脑实测 9.8KB shell）；协议细节以 SDK 源码 + 实帧为准，别在抓文档上烧时间。
- **下一步唯一动作**：把探针草稿落进 worktree `spikes/asr/` 并按候选组合实跑 query-raw。
