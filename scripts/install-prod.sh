#!/usr/bin/env bash
# Install the production user service. --enable is optional and reversible.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
UNIT_SOURCE="${REPO_ROOT}/systemd/remobi.service"
UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT_TARGET="${UNIT_DIR}/remobi.service"

[[ -f "$UNIT_SOURCE" ]] || { printf 'install-prod: missing %s\n' "$UNIT_SOURCE" >&2; exit 2; }
install -Dm644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl --user daemon-reload
printf 'installed %s\n' "$UNIT_TARGET"

case "${1:-}" in
  '') printf 'enable with: systemctl --user enable --now remobi.service\n' ;;
  --enable) systemctl --user enable --now remobi.service; printf 'enabled remobi.service\n' ;;
  *) printf 'usage: %s [--enable]\n' "$0" >&2; exit 2 ;;
esac
