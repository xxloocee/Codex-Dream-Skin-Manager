#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
assert_codex_user_environment || exit 1

PORT=9341
LAUNCH_AFTER_INSTALL="true"
IN_PLACE="false"
MANAGER_LOCK=""
MANAGER_LOCK_OWNER=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --no-launch) LAUNCH_AFTER_INSTALL="false"; shift ;;
    --in-place) IN_PLACE="true"; shift ;;
    --manager-lock) MANAGER_LOCK="$2"; shift 2 ;;
    --manager-lock-owner) MANAGER_LOCK_OWNER="$2"; shift 2 ;;
    *) fail "Unknown installer argument: $1" ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be between 1024 and 65535."

deploy_project() {
  local temporary="$INSTALL_ROOT.installing.$$"
  local previous="$INSTALL_ROOT.previous.$$"
  /bin/rm -rf "$temporary"
  /bin/mkdir -p "$temporary"
  /usr/bin/rsync -a \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    --exclude 'release/' \
    "$PROJECT_ROOT/" "$temporary/"
  /bin/chmod 700 "$temporary"/*.command "$temporary"/scripts/*.sh 2>/dev/null || true
  /bin/rm -rf "$previous"
  if [ -e "$INSTALL_ROOT" ]; then /bin/mv "$INSTALL_ROOT" "$previous"; fi
  if ! /bin/mv "$temporary" "$INSTALL_ROOT"; then
    [ -e "$previous" ] && /bin/mv "$previous" "$INSTALL_ROOT"
    fail "Could not install the project at $INSTALL_ROOT"
  fi
  DEPLOY_PREVIOUS="$previous"
}

commit_deployed_project() {
  [ -n "${DEPLOY_PREVIOUS:-}" ] || return 0
  /bin/rm -rf "$DEPLOY_PREVIOUS" || true
  DEPLOY_PREVIOUS=""
}

rollback_deployed_project() {
  local status="$1"
  local broken="$INSTALL_ROOT.broken.$$"
  # Swap with renames only: `rm -rf` on the live root is not atomic, and an
  # interrupted deletion leaves a mixed-version engine behind.  Deleting the
  # detached broken tree afterwards is safe to interrupt.
  if [ -e "$INSTALL_ROOT" ]; then
    /bin/mv "$INSTALL_ROOT" "$broken" \
      || fail "Installation failed and the broken engine could not be moved aside."
  fi
  if [ -n "${DEPLOY_PREVIOUS:-}" ] && [ -e "$DEPLOY_PREVIOUS" ]; then
    /bin/mv "$DEPLOY_PREVIOUS" "$INSTALL_ROOT" \
      || fail "Installation failed and the previous engine could not be restored."
  fi
  /bin/rm -rf "$broken" 2>/dev/null || true
  DEPLOY_PREVIOUS=""
  return "$status"
}

DEPLOY_PREVIOUS=""

if [ -n "$MANAGER_LOCK" ]; then
  . "$SCRIPT_DIR/theme-switch-lock-macos.sh"
  assert_inherited_theme_switch_lock "$MANAGER_LOCK" "$MANAGER_LOCK_OWNER"
fi

discover_codex_app
if [ "$IN_PLACE" = "false" ] && [ "$PROJECT_ROOT" != "$INSTALL_ROOT" ]; then
  # Run the cheap precondition before any engine bytes move: aborting after
  # the copy forces a rollback of a perfectly good previous engine, and an
  # interrupted rollback is how a mixed-version tree ships.
  codex_is_running && fail "Close Codex before installation so config.toml cannot be rewritten while the app is saving it."
  require_signed_node_runtime
  assert_codex_process_environment || exit 1
  /bin/mkdir -p "$(dirname "$INSTALL_ROOT")"
  deploy_project
  install_args=(--in-place --port "$PORT")
  [ -z "$MANAGER_LOCK" ] || install_args+=(--manager-lock "$MANAGER_LOCK" --manager-lock-owner "$MANAGER_LOCK_OWNER")
  [ "$LAUNCH_AFTER_INSTALL" = "true" ] || install_args+=(--no-launch)
  if "$INSTALL_ROOT/scripts/install-dream-skin-macos.sh" "${install_args[@]}"; then
    commit_deployed_project
    exit 0
  else
    status=$?
    rollback_deployed_project "$status"
    exit "$status"
  fi
fi

require_macos_runtime
assert_codex_process_environment || exit 1
ensure_state_root
codex_is_running && fail "Close Codex before installation so config.toml cannot be rewritten while the app is saving it."
seed_bundled_presets
manager_switch_args=()
[ -z "$MANAGER_LOCK" ] || manager_switch_args=(--lock-token "$MANAGER_LOCK" --lock-owner "$MANAGER_LOCK_OWNER")
if [ ! -f "$THEME_DIR/theme.json" ]; then
  "$SCRIPT_DIR/switch-theme-macos.sh" --id preset-gothic-void-crusade --no-apply "${manager_switch_args[@]}" >/dev/null
else
  # Re-stage official presets so metadata upgrades (e.g. the #183 appearance
  # pin) reach an active copy staged by an older engine.
  ACTIVE_THEME_ID="$("$NODE" -e '
const fs = require("node:fs");
let id = "";
try { id = String(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).id ?? ""); } catch {}
process.stdout.write(/^preset-[A-Za-z0-9_-]{1,72}$/.test(id) ? id : "");
' "$THEME_DIR/theme.json")"
  if [ -n "$ACTIVE_THEME_ID" ] && [ -d "$STATE_ROOT/themes/$ACTIVE_THEME_ID" ]; then
    "$SCRIPT_DIR/switch-theme-macos.sh" --id "$ACTIVE_THEME_ID" --no-apply "${manager_switch_args[@]}" >/dev/null
  fi
fi
[ -f "$CONFIG_PATH" ] || fail "Codex config not found: $CONFIG_PATH. Launch Codex once, close it, and rerun the installer."
"$NODE" "$INJECTOR" --check-payload --theme-dir "$THEME_DIR" >/dev/null
sync_appearance_pin

printf 'Dream Skin %s installed at %s for Codex %s using Dream Skin bundled Node.js %s.\n' \
  "$SKIN_VERSION" "$PROJECT_ROOT" "$CODEX_VERSION" "$NODE_VERSION"
printf 'Open the Dream Skin manager to customize, apply or restore a theme.\n'
printf 'Bundled presets are ready in your theme library — pick one in the Dream Skin manager.\n'

if [ "$LAUNCH_AFTER_INSTALL" = "true" ]; then
  "$SCRIPT_DIR/start-dream-skin-macos.sh" --port "$PORT" --prompt-restart
fi
