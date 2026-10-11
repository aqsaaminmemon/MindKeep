#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then set -a; source .env; set +a; elif [[ -f data/dev.env ]]; then source data/dev.env; fi
if [[ -f data/mail.env ]]; then source data/mail.env; fi
MK_CMAKE_ARGS=()
if [[ -n "${MINDKEEP_DEPS:-}" ]]; then MK_CMAKE_ARGS+=("-DMINDKEEP_DEPS=$MINDKEEP_DEPS");
elif [[ -d data/build-deps/usr ]]; then MK_CMAKE_ARGS+=("-DMINDKEEP_DEPS=$(pwd)/data/build-deps");
elif [[ -d /tmp/mindkeep-deps/extracted ]]; then MK_CMAKE_ARGS+=("-DMINDKEEP_DEPS=/tmp/mindkeep-deps/extracted"); fi
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release "${MK_CMAKE_ARGS[@]}"
cmake --build build -j2
export LD_LIBRARY_PATH="${MINDKEEP_DEPS:-$(pwd)/data/build-deps}/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec ./build/mindkeep
