# Keeping your Mac awake for remote access

When running `herdweb serve` on a Mac to expose a herdr session over the network
(e.g. via Tailscale), the host going to sleep makes the terminal unreachable.
This guide covers your options from quick to permanent.

## Quick: `--no-sleep` flag (recommended)

```bash
herdweb serve --no-sleep
```

Under the hood this runs `caffeinate -s -w <pid>` alongside the server. The
sleep assertion is held exactly as long as the server runs and dropped
automatically on shutdown.

Combine with other flags as usual:

```bash
herdweb serve --no-sleep --port 8080 -- herdr --session dev
```

**Caveats:**

- Works on AC power only — battery Macs will still sleep when unplugged
- Does not prevent lid-close sleep
- Non-macOS: the flag is silently ignored (caffeinate is macOS-only)

## Persistent: system settings

For a Mac that should always be accessible (Mac mini, Mac Studio, headless
Mac Pro), configure the OS to never sleep permanently.

### System Settings GUI

**System Settings → Energy → Prevent automatic sleeping when the display is off**

### pmset (command line)

```bash
sudo pmset -c sleep 0
sudo pmset -c displaysleep 10
sudo pmset -c womp 1
sudo pmset -c ttyskeepawake 1
sudo pmset -c autorestart 1
```

Check current settings:

```bash
pmset -g
```

## Lid-close behaviour

None of the above options prevent sleep when the lid is closed on a MacBook.
Use clamshell mode (external display + power) or Amphetamine for lid-close override.
Desktop Macs are unaffected.
