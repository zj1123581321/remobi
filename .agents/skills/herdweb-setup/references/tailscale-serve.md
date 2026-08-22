# Deploying herdweb with Tailscale Serve

Expose a herdr session as a mobile-friendly web terminal over your Tailscale network with full PWA support.

## Prerequisites

- [herdr](https://github.com/ogulcancelik/herdr) installed
- [Tailscale](https://tailscale.com/) configured with HTTPS enabled (`tailscale cert`)
- herdweb built or runnable from source (see repo README)

## Quick setup (recommended)

### 1. Start herdweb serve

```bash
pnpm exec tsx cli.ts serve
# or: node dist/cli.mjs serve   (after pnpm run build:dist)
```

This bundles the browser client in memory, starts herdweb's HTTP and WebSocket server, and spawns `herdr --session default` on `:7681` with full PWA support.

By default `herdweb serve` binds to `127.0.0.1`. Tailscale Serve publishes it to your tailnet.

### 2. Expose via Tailscale Serve

```bash
tailscale serve --bg 7681
```

Your terminal is now available at `https://<your-machine>.<tailnet>.ts.net`. If you publish herdweb behind a path prefix, start with `--base-path /that-prefix` so WebSocket and PWA URLs stay aligned.

On mobile, tap **Add to Home Screen** for a standalone app experience.

### 3. Stop

```bash
pkill -f "cli.ts serve"
tailscale serve --https=443 off
```

> **Tip — keep your Mac awake:** Add `--no-sleep` so the Mac doesn't go to
> sleep while you're away:
>
> ```bash
> herdweb serve --no-sleep
> ```
>
> See [Keeping your Mac awake](keep-awake.md) for persistent options.

## Shell function

```zsh
# webtermup: expose herdr session via herdweb serve + Tailscale serve
function webtermup() {
  local session=${1:-default}
  local port=${2:-7681}

  pkill -f "cli.ts serve.*--port $port" 2>/dev/null

  pnpm exec tsx cli.ts serve --no-sleep --port $port -- herdr --session "$session" &!

  tailscale serve --bg $port
  echo "Terminal ($session): https://$(tailscale status --self --json | jq -r '.Self.DNSName' | sed 's/\.\$//')"
}

function webtermdown() {
  local port=${1:-7681}
  pkill -f "cli.ts serve.*--port $port" 2>/dev/null
  tailscale serve --https=443 off 2>/dev/null
  echo "Web terminal stopped"
}
```

## Legacy ttyd notes

Current herdweb releases do not depend on `ttyd`. Use `herdweb serve` for supported setups.

If you are tempted to run `herdweb serve --host 0.0.0.0`, be explicit about the trade-off: that bypasses the localhost-only default. Prefer keeping herdweb on loopback and letting Tailscale handle reachability.

See [docs/deploy-herdr.md](../../../docs/deploy-herdr.md) for production systemd deployment.
