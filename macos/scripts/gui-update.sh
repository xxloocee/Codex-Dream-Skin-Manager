#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
exec "$ROOT/runtime/node/bin/node" "$ROOT/scripts/gui-update.mjs" "$@"
