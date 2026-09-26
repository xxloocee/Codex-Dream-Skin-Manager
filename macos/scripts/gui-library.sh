#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
. "$SCRIPT_DIR/theme-switch-lock-macos.sh"
ensure_state_root
ensure_node_runtime
acquire_theme_switch_lock "$(new_operation_token)"
trap 'release_theme_switch_lock' EXIT
"$NODE" "$SCRIPT_DIR/gui-library.mjs" "$STATE_ROOT" "$@"
