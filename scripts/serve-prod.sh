#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

if ! branch="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD)"; then
  printf 'serve-prod: cannot start from a detached HEAD\n' >&2
  exit 1
fi
if [[ "$branch" != main ]]; then
  printf 'serve-prod: production must run from main, got %s\n' "$branch" >&2
  exit 1
fi

cd -- "$REPO_ROOT"
exec pnpm exec tsx cli.ts "$@"
