#!/usr/bin/env bash
# Convenience launcher for the locally-built Rey30 IDvj agent binary.
# Usage:
#   ./rey30-idvj-agent.sh                 -> opens the interactive agent UI
#   ./rey30-idvj-agent.sh agent status    -> forwards any args straight to `rey30-idvj`
#   ./rey30-idvj-agent.sh agent run "..." -> run a task headlessly

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REY30_BIN="$DIR/src-tauri/resources/bin/rey30-idvj"

if [ ! -x "$REY30_BIN" ]; then
  echo "error: rey30-idvj binary not found or not executable at $REY30_BIN" >&2
  exit 1
fi

cd "$DIR/src-tauri"

if [ "$#" -eq 0 ]; then
  exec "$REY30_BIN" agent ui
else
  exec "$REY30_BIN" "$@"
fi
