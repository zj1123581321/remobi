# herdr 部署 runbook

本仓维护 herdr 上 remobi 的生产和 Tailscale 调试运行时契约。生产服务只监听
`127.0.0.1:7681`，调试服务只监听 `127.0.0.1:7691`；外部认证和隧道仍由现有
Cloudflare Access、Cloudflare Tunnel、Tailscale 配置负责。

## 拓扑

| 用途 | 外部入口 | 本机监听 | herdr 会话 |
| --- | --- | --- | --- |
| 生产 | `https://herdr.zlxlabs.com` | `127.0.0.1:7681` | `default` |
| Tailscale 调试 | `https://<tailnet>/remobi/` | `127.0.0.1:7691` | `remobi-dev` |

调试入口的 `/remobi/` 前缀对应 remobi 的 `--base-path /remobi`，反向代理目标是
`127.0.0.1:7691`。调试服务禁止占用生产的 `7681` 端口。

## 生产

生产 unit 的持久路径固定为 `/home/zlx/projects/oss/remobi`，并由
`scripts/serve-prod.sh` 启动。启动脚本用 `git symbolic-ref` 检查当前分支必须是
`main`；detached HEAD 或其他分支会直接失败。unit 使用 fnm 的
`aliases/default/bin` 和 `~/.local/bin`，不绑定 `node-versions/`。

安装并启用生产 unit：

```bash
cd /home/zlx/projects/oss/remobi
scripts/install-prod.sh --enable
systemctl --user status remobi.service
```

只安装而不启用：

```bash
scripts/install-prod.sh
```

公网入口暴露检查只输出结构化状态，不输出响应体：

```bash
scripts/check-exposure.sh https://herdr.zlxlabs.com
```

预期：首页未认证时是认证门状态，未认证 `/ws` 不能返回 `101`。

## Tailscale 调试

调试 unit 直接从本仓源码启动，允许在非 `main` 分支或 worktree 中调试；它不使用
`serve-prod.sh`。安装只执行复制和 daemon-reload，不 enable、不 start：

```bash
cd /home/zlx/projects/oss/remobi
scripts/install-debug.sh
systemctl --user start remobi-debug.service
systemctl --user status remobi-debug.service
```

结束调试后停止 unit；不要对它执行 `enable`：

```bash
systemctl --user stop remobi-debug.service
```

调试 unit 使用本机配置文件
`/home/zlx/projects/oss/remobi/.omo/remobi-debug.config.ts`。密钥只放在该本地配置或
本机环境中，不写入 git。

## 重启后检查

```bash
systemctl --user is-enabled remobi.service
systemctl --user is-active remobi.service
ss -ltn | grep -E '127\.0\.0\.1:(7681|7691)'
```

生产重启后仍应是 `127.0.0.1:7681` 与 herdr `default`；调试只有在手动 start
后才应出现 `127.0.0.1:7691` 与 `remobi-dev`。
