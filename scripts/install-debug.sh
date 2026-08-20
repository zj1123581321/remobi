#!/usr/bin/env bash
# Install the debug user service without enabling or starting it.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
UNIT_SOURCE="${REPO_ROOT}/systemd/remobi-debug.service"
UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT_TARGET="${UNIT_DIR}/remobi-debug.service"

[[ -z "${1:-}" ]] || { printf 'usage: %s\n' "$0" >&2; exit 2; }
[[ -f "$UNIT_SOURCE" ]] || { printf 'install-debug: missing %s\n' "$UNIT_SOURCE" >&2; exit 2; }
install -Dm644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl --user daemon-reload
printf 'installed %s (not enabled or started)\n' "$UNIT_TARGET"
