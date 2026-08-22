# Recommended ttyd flags

Historical reference for old ttyd-based setups from before herdweb owned the full runtime.

> **Legacy only:** current herdweb releases no longer use `ttyd`. Use `herdweb serve` for supported setups. Keep this page only for understanding or migrating old installs.

## Essential flags

| Flag | Purpose |
|------|---------|
| `--writable` | Allow input |
| `--index <path>` | Use patched HTML |
| `-i 127.0.0.1` | Bind to localhost only |
| `--port <n>` | Port to listen on (default: 7681) |

## Full example (legacy)

```bash
ttyd -i 127.0.0.1 --port 7681 --writable \
  --index dist/index.html \
  herdr --session default
```

Migrate to `herdweb serve` rather than preserving the old `ttyd` path.
