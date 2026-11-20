#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
OUTPUT="$ROOT/build/macos/Dream Skin.app"
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = --output ] || { printf 'Usage: build-app.sh [--output /absolute/path.app]\n' >&2; exit 2; }
  OUTPUT="$2"
fi
exec /bin/bash "$ROOT/hosts/macos/assemble-shared.sh" "$OUTPUT"
