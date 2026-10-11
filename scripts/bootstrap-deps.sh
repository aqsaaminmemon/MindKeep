#!/usr/bin/env bash
# Optional Ubuntu development-package extraction; no system package installation.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/dependency-packages data/build-deps
MK_TARGET="$(pwd)/data/build-deps"
cd data/dependency-packages
MK_PACKAGES=(libmysqlclient-dev libssl-dev libicu-dev)
MK_RUNTIME="$(apt-cache depends libmysqlclient-dev | sed -n 's/.*Depends: \(libmysqlclient[0-9]*\).*/\1/p' | head -1)"
if [[ -n "$MK_RUNTIME" ]]; then MK_PACKAGES+=("$MK_RUNTIME"); fi
apt download "${MK_PACKAGES[@]}"
for MK_PACKAGE in *.deb; do dpkg-deb -x "$MK_PACKAGE" "$MK_TARGET"; done
printf 'Extracted C++ development dependencies. Set MINDKEEP_DEPS=%s\n' "$MK_TARGET"
