#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
MK_ROOT="$(pwd)"
if [[ -f data/mindkeep.pid ]]; then
  read -r MK_PID <data/mindkeep.pid
  if [[ "$(readlink "/proc/$MK_PID/exe" 2>/dev/null || true)" == "$MK_ROOT/build/mindkeep"* ]]; then kill "$MK_PID"; fi
  rm -f data/mindkeep.pid
fi

if [[ -f data/dev.env ]]; then ./scripts/snapshot-dev-db.sh; fi
