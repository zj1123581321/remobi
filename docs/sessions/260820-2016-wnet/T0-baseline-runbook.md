# T0 · 真机弱网基线录制单（用户亲自执行）

设计出处：`docs/designs/weak-network-experience.md` → Implementation Tasks · T0、Validation Unknowns。

## 为什么必须人来做

需要真实 Android 手机、真实 iPhone、真实 Cloudflare Tunnel + Access 入口、真实切网与锁屏。
执行器（Codex/Kimi/Grok）没有这些，任何"模拟"结论都不能作为状态机分叉依据。

## 这一步不阻塞代码

T1（草稿持久化）与 T2（服务端协议）不消费 T0 的任何结论，已并行派发。
T0 的产物在两处被消费：

1. T3 客户端重连卡派发前，把「事件顺序」结论贴进卡面「现场事实」；
2. T3/T4 的真机验收。

如果 T0 迟迟没做，T3 仍按设计已锁定的行为实现（无论事件以什么顺序到达，都合并成一次连接尝试）——
T0 只会推迟真机验收，不会改状态机。

## 准备

1. 生产入口已跑起来：`systemctl --user status remobi.service`，Cloudflare Tunnel + Access 可访问。
2. 手机浏览器：Android 用 Chrome，iOS 用 Safari。
3. 打开远程调试拿事件日志（二选一）：
   - **推荐·零改动**：在手机浏览器地址栏执行一段 bookmarklet，把生命周期事件打到页面上。
     见下方「事件探针」。
   - Android 也可以用 `chrome://inspect` 远程调试拿 console。iOS 用 Mac Safari 的
     「开发」菜单。没有 Mac 就用 bookmarklet。

### 事件探针（贴进手机浏览器地址栏，前缀 `javascript:` 需手打）

```js
(function(){var b=document.createElement('div');b.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;max-height:40vh;overflow:auto;background:#000c;color:#0f0;font:11px monospace;padding:4px;width:100%';document.body.appendChild(b);var t0=Date.now();function log(m){var l=document.createElement('div');l.textContent=((Date.now()-t0)/1000).toFixed(2)+'s '+m;b.appendChild(l);b.scrollTop=b.scrollHeight}['visibilitychange','pageshow','pagehide','freeze','resume','online','offline'].forEach(function(e){(e==='visibilitychange'?document:window).addEventListener(e,function(ev){log(e+(e==='visibilitychange'?':'+document.visibilityState:'')+(ev.persisted!==undefined?' persisted='+ev.persisted:''))})});log('probe ready');window.__wnetLog=log})()
```

探针只观察，不改应用行为。记录时把这块日志截图即可。

## 要跑的 4 个场景（Android 与 iOS 各一遍）

每个场景都从「已连接、终端有可见输出」开始，并且**先在语音 composer 里留一段没提交的长草稿**
（≥ 3 行中文，方便肉眼判断是否逐字保留）。

### S1 Wi-Fi ↔ 蜂窝切换

1. 记下终端最后一行内容。
2. 关 Wi-Fi 切蜂窝，等 30 秒。
3. 观察并记录：页面显示什么状态？终端画面还是旧的吗？有没有任何提示？
4. 切回 Wi-Fi，等 30 秒，再记一次。

### S2 锁屏 / 后台 30 分钟

1. 锁屏或切到别的 App，**放置 ≥ 30 分钟**（这是真实使用方式，短时间切走复现不出来）。
2. 回到浏览器，**立刻**记录：
   - 事件顺序（探针日志截图）
   - 终端画面是不是最新的？怎么判断的？（对照电脑端同一 session 的真实内容）
   - 草稿还在吗？逐字一致吗？
   - 状态提示是什么？

### S3 提交一条长指令

1. 在 S2 恢复后，直接点提交。
2. 记录：提交后 UI 说了什么？能否判定服务端收到没有？终端里出现几次这段文本？
3. 若 `autoEnter` 开着，确认回车是不是被当成第二次输入发送的。

### S4 Cloudflare Access 会话过期

1. 让 Access 会话自然过期（或在 Cloudflare 后台吊销当前会话）。
2. 页面继续放着，记录 WebSocket close/error 的表现：浏览器能看到什么？页面是白屏、卡死还是自动刷新？
3. 记录重新认证需要几步。

## 产物格式

在本目录新建 `T0-baseline-android.md` 与 `T0-baseline-ios.md`，每份至少包含：

| 场景 | 生命周期事件顺序 | WS close code / error | 画面是否陈旧 | 草稿是否保留 | 提交是否可判定 | 截图 |
|---|---|---|---|---|---|---|
| S1 | | | | | | |
| S2 | | | | | | |
| S3 | | | | | | |
| S4 | | | | | | |

最后回答一句话：**Android 与 iOS 的事件顺序是否需要按平台分叉？** 设计的前提是"不需要"
（所有恢复事件都只合并成一次连接尝试）——如果实测发现某一端存在设计没覆盖的顺序，
立刻回报，T3 卡要改。
