# Scrollback spike — server-side frame-diff history reconstruction

Probe for `docs/sessions/260821-1053-scroll/spike-scrollback-evidence.md` (verdict
and method live there). Nothing here is imported by production code.

Each scenario spawns an **isolated** herdr session (`--session spike-scrollback`)
under node-pty, drives it, replays the stream into a `@xterm/headless` mirror
(same config as `src/session.ts`), and reconstructs scrollback by conservative
frame-diff alignment. All `herdr` CLI calls are pinned to the spike session's
socket via `HERDR_SOCKET_PATH` — the user's own session can never be reached.

## Run

Requires `herdr` on PATH and repo deps (`pnpm install`).

```bash
node spikes/scrollback/scenario.mjs seq          # seq 1 5000 strict continuity (hard gate)
node spikes/scrollback/scenario.mjs paced        # granularity: paced vs burst capture rates
node spikes/scrollback/scenario.mjs interference # tab switch / resize / split / fullscreen TUI
node spikes/scrollback/scenario.mjs realload     # ~5 min find-based sustained scroll
node spikes/scrollback/scenario.mjs clean        # stop+delete the spike session
```

Artifacts and raw event captures land in `/tmp/spike-scrollback-captures/` — probe
output, not committed (biome would demand pretty JSON; the evidence doc inlines
the key numbers, and rerunning regenerates everything).
