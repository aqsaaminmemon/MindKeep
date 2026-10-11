#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
MK_ROOT="$(pwd)"
mkdir -p data
if [[ -f .env ]]; then set -a; source .env; set +a; elif [[ -f data/dev.env ]]; then source data/dev.env; fi
if [[ -f data/mail.env ]]; then source data/mail.env; fi
if [[ ! -x build/mindkeep ]]; then printf 'Build first: ./scripts/run.sh\n' >&2; exit 1; fi
if [[ -f data/mindkeep.pid ]]; then
  read -r MK_PID <data/mindkeep.pid
  if [[ "$(readlink "/proc/$MK_PID/exe" 2>/dev/null || true)" == "$MK_ROOT/build/mindkeep"* ]]; then
    printf 'MindKeep is already running (PID %s).\n' "$MK_PID"; exit 0
  fi
fi
setsid ./build/mindkeep >data/server.log 2>&1 < /dev/null &
printf '%s\n' "$!" >data/mindkeep.pid
sleep 1
if ! kill -0 "$(cat data/mindkeep.pid)" 2>/dev/null; then cat data/server.log; exit 1; fi
printf 'MindKeep started at %s. Log: data/server.log\n' "${MINDKEEP_PUBLIC_URL:-http://localhost:8080}"
