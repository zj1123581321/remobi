# Wheel latency spike — herdr redraw saturation under SGR wheel flood

Probe for `docs/sessions/260821-1053-scroll/wheel-latency-evidence.md`. Nothing here is
imported by production code.

Spawns an **isolated** herdr session (`--session spike-wheel`) under node-pty (80×24),
fills scrollback with `seq 1 500`, then measures:

1. Single-wheel response latency (≥50 samples, ≥350 ms gap)
2. Send frequency → effective PTY redraw frequency (120/60/40/30/20/15/10 Hz × 3 s)
3. Bytes per output-event distribution at each frequency

All `herdr` CLI calls are pinned to the spike session socket via `HERDR_SOCKET_PATH` —
user sessions (`default`, `remobi-dev`, …) are never touched.

Session management reuses the same patterns as `spikes/scrollback/lib.mjs` (`ptyEnv`,
`HerdrCapture`, `startCleanSession`, `teardown`).

## Run

Requires `herdr` on PATH and repo deps (`pnpm install`).

```bash
node spikes/wheel-latency/probe.mjs run    # full measurement (~2 min)
node spikes/wheel-latency/probe.mjs clean   # stop+delete spike-wheel session
```

Artifacts land in `/tmp/spike-wheel-latency-captures/wheel-latency.json` — probe output,
not committed. Rerun regenerates everything; the evidence doc inlines key numbers.
