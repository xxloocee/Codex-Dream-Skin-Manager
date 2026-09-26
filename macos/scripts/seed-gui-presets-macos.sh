#!/bin/bash
# Import only missing presets from the bundled GUI. Works even when the engine
# version is unchanged, so an app-only update can fill a fresh theme library.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
ensure_state_root
NODE="$PROJECT_ROOT/runtime/node/bin/node"
[ -f "$NODE" ] && [ -x "$NODE" ] && [ ! -L "$NODE" ] || fail "Bundled Node.js is missing."
/usr/bin/codesign --verify --strict "$NODE" >/dev/null 2>&1 || fail "Bundled Node.js signature is invalid."
seed_bundled_presets
