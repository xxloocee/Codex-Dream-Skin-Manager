#!/bin/bash
# Opt-in shared manager bridge. All argv are supplied by the bundled core.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
. "$SCRIPT_DIR/theme-switch-lock-macos.sh"
ACTION="${1:-}"
APPLICATION_ROOT="${2:-}"
REQUEST_PATH="${3:-}"
case "$ACTION" in probe|apply|inspect|runtimeprobe|pause|restore|commitcommunity) ;; *) fail "Invalid shared manager action." ;; esac
case "$ACTION" in apply|pause|restore|commitcommunity) assert_codex_user_environment || exit 1 ;; esac
[ -n "$APPLICATION_ROOT" ] && [ "${APPLICATION_ROOT:0:1}" = / ] || fail "Missing application root."
CORE_NODE="$APPLICATION_ROOT/runtime/node/node"
WORKER="$APPLICATION_ROOT/shared/core/apply-worker.mjs"
[ -f "$CORE_NODE" ] && [ ! -L "$CORE_NODE" ] && [ -f "$WORKER" ] && [ ! -L "$WORKER" ] || fail "Shared manager resources are incomplete."
ensure_node_runtime

probe() {
  assert_codex_process_environment || return 1
  local port=9341 browser="" paused=false processes="" pid started watcher_verified=false
  if [ -f "$STATE_PATH" ]; then
    port="$(state_field port)"
    [ "$(state_field session)" != paused ] || paused=true
  fi
  case "$port" in ''|*[!0-9]*) fail "Invalid state port." ;; esac
  if verified_cdp_endpoint "$port"; then
    browser="$(/usr/bin/curl --noproxy '*' --silent --fail --max-time 2 "http://127.0.0.1:$port/json/version")" || return 1
    verified_cdp_endpoint "$port" || return 1
  fi
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    started="$(/bin/ps -p "$pid" -o lstart=)" || return 1
    processes="$processes$pid:$started
"
  done < <(codex_main_pids | /usr/bin/sort -n)
  if [ -f "$STATE_PATH" ] && recorded_injector_process_matches "$(state_field injectorPid)" "$(state_field injectorStartedAt)" "$(state_field nodePath)" "$(state_field injectorPath)" "$port"; then watcher_verified=true; fi
  "$CORE_NODE" "$APPLICATION_ROOT/shared/core/macos-probe.mjs" "$port" "$CODEX_EXE" "$processes" "$browser" "$paused" "$watcher_verified"
}
field() {
  "$CORE_NODE" -e 'const x=JSON.parse(process.argv[1])[process.argv[2]]; if(x !== null && x !== undefined) process.stdout.write(String(x));' "$1" "$2"
}
if [ "$ACTION" = probe ]; then probe; exit 0; fi
runtime_capture() { "$CORE_NODE" "$APPLICATION_ROOT/shared/core/runtime-worker.mjs" capture "$APPLICATION_ROOT" "$1"; }
runtime_check() { "$CORE_NODE" "$APPLICATION_ROOT/shared/core/runtime-worker.mjs" check "$APPLICATION_ROOT" "$1" "$REQUEST_PATH"; }
if [ "$ACTION" = runtimeprobe ]; then
  runtime_capture "$(probe)"
  exit 0
fi
if [ "$ACTION" = inspect ]; then
  before="$(probe)"
  [ -n "$(field "$before" runtimeSessionId)" ] && [ "$(field "$before" paused)" = false ] || fail "No active renderer session."
  verification="$(/bin/bash "$SCRIPT_DIR/verify-dream-skin-macos.sh")"
  mapped="$("$CORE_NODE" "$WORKER" inspect "$APPLICATION_ROOT" "$verification")"
  after="$(probe)"
  [ "$(field "$before" fingerprint)" = "$(field "$after" fingerprint)" ] && [ "$(field "$before" runtimeSessionId)" = "$(field "$after" runtimeSessionId)" ] || fail "Runtime changed during observation."
  "$CORE_NODE" -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify({...x,effects:{themeCommitted:true,rendererApplied:true,codexRestarted:false},runtimeSessionId:process.argv[2]})+"\n")' "$mapped" "$(field "$after" runtimeSessionId)"
  exit 0
fi

case "$REQUEST_PATH" in "$STATE_ROOT"/manager-operations/requests/*.json) ;; *) fail "Invalid manager request location." ;; esac
[ -f "$REQUEST_PATH" ] && [ ! -L "$REQUEST_PATH" ] || fail "Missing manager request."
TOKEN="$(new_operation_token)"
acquire_theme_switch_lock "$TOKEN"
COMMITTED=false
RESTARTED=false
RENDERED=false
COMMITTED_REVISION=""
PAUSED_COMMITTED=false
REMOVED=false
UNAVAILABLE=false
RUNTIME_COMMAND=false
UPGRADE=false
UPGRADED=false
VERIFY_PATH=""
case "$ACTION" in inspect|commitcommunity) RENDERED=null ;; esac
cleanup() {
  if [ -n "$VERIFY_PATH" ]; then /bin/rm -f "$VERIFY_PATH"; fi
  release_theme_switch_lock
}
trap cleanup EXIT
result() {
  "$CORE_NODE" -e '
const value = v => v === "null" ? null : v === "true";
process.stdout.write(JSON.stringify({effects:{themeCommitted:value(process.argv[1]),rendererApplied:value(process.argv[2]),codexRestarted:value(process.argv[3]),...(process.argv[7]==="true"?{pausedCommitted:value(process.argv[8]),rendererRemoved:value(process.argv[9])}:{}),...(process.argv[11]==="true"?{runtimeUpgraded:value(process.argv[12])}:{})},rendererUnavailable:process.argv[10]==="true",committedRevision:process.argv[4]||null,verifiedRendererRevision:process.argv[5]||null,runtimeSessionId:process.argv[6]||null})+"\n");
' "$COMMITTED" "$RENDERED" "$RESTARTED" "${1:-$COMMITTED_REVISION}" "${2:-}" "${3:-}" "$RUNTIME_COMMAND" "$PAUSED_COMMITTED" "$REMOVED" "$UNAVAILABLE" "$UPGRADE" "$UPGRADED"
}
transaction() {
  local before snapshot directory fingerprint confirmed started current verification_before verification_after mapped requested_revision opacity_only
  before="$(probe)" || return 1
  RUNTIME_COMMAND="$("$CORE_NODE" -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.runtimeCommand?"true":"false")' "$REQUEST_PATH")" || return 1
  UPGRADE="$("$CORE_NODE" -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(r.runtimeCommand?.method==="runtime.upgrade"?"true":"false")' "$REQUEST_PATH")" || return 1
  if [ "$ACTION" = restore ]; then
    [ "$("$CORE_NODE" -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).runtimeCommand?.method||"")' "$REQUEST_PATH")" = skin.restore ] || return 1
    runtime_check "$before" >/dev/null || return 1
    local restored
    if restored="$(/bin/bash "$SCRIPT_DIR/restore-dream-skin-macos.sh" --restore-base-theme --restart-codex --lock-token "$TOKEN" --manager-request "$REQUEST_PATH" --manager-application-root "$APPLICATION_ROOT" --manager-precondition "$(field "$before" fingerprint)")"; then :; else :; fi
    "$CORE_NODE" -e 'const lines=process.argv[1].trim().split("\n");const x=JSON.parse(lines[lines.length-1]);if(!x.effects||!("appearanceRestored" in x.effects))process.exit(1);process.stdout.write(JSON.stringify(x)+"\n")' "$restored" || return 1
    return 0
  fi
  if [ "$ACTION" = pause ]; then
    [ "$RUNTIME_COMMAND" = true ] || return 1
    [ "$("$CORE_NODE" -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).runtimeCommand.method)' "$REQUEST_PATH")" = skin.pause ] || return 1
    runtime_check "$before" >/dev/null || return 1
    PAUSED_COMMITTED=null; REMOVED=null
    /bin/bash "$SCRIPT_DIR/pause-dream-skin-macos.sh" --lock-token "$TOKEN" >/dev/null || return 1
    current="$(probe)" || return 1
    [ "$(field "$current" paused)" = true ] || return 1
    PAUSED_COMMITTED=true
    if [ -n "$(field "$before" runtimeSessionId)" ]; then
      [ "$(field "$current" runtimeSessionId)" = "$(field "$before" runtimeSessionId)" ] || return 1
      "$NODE" "$INJECTOR" --verify-removed --port "$(field "$current" port)" --timeout-ms 8000 >/dev/null || return 1
      verification_after="$(probe)" || return 1
      [ "$(field "$verification_after" runtimeSessionId)" = "$(field "$current" runtimeSessionId)" ] && [ "$(field "$verification_after" paused)" = true ] || return 1
      REMOVED=true
    else
      [ "$(field "$before" processRunning)" = false ] && [ "$(field "$current" processRunning)" = false ] || return 1
      REMOVED=false; UNAVAILABLE=true
    fi
    result "" "" "$(field "$current" runtimeSessionId)"; return 0
  fi
  if [ "$ACTION" = apply ]; then
    "$CORE_NODE" "$WORKER" check-refresh "$APPLICATION_ROOT" "$REQUEST_PATH" "$before" >/dev/null || return 1
    opacity_only="$("$CORE_NODE" -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(r.refresh?.opacityOnly===true))' "$REQUEST_PATH")" || return 1
    if [ "$RUNTIME_COMMAND" = true ]; then runtime_check "$before" >/dev/null || return 1; fi
    fingerprint="$("$CORE_NODE" -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(r.schemaVersion!==1||!r.preflightFingerprint)process.exit(1);process.stdout.write(r.preflightFingerprint)' "$REQUEST_PATH")" || return 1
    [ "$fingerprint" = "$(field "$before" fingerprint)" ] || return 1
    confirmed="$("$CORE_NODE" -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.confirmed === true ? "true" : "false")' "$REQUEST_PATH")" || return 1
    started="$(field "$before" startRequired)"
    if [ "$UPGRADE" = true ]; then started=true; fi
    [ "$started" != true ] || [ "$confirmed" = true ] || return 1
    snapshot="$("$CORE_NODE" "$WORKER" prepare "$APPLICATION_ROOT" "$REQUEST_PATH")" || return 1
    directory="$(field "$snapshot" directory)"
    requested_revision="$(field "$snapshot" expectedRevision)"
    current="$(probe)" || return 1
    [ "$(field "$current" fingerprint)" = "$fingerprint" ] || return 1
    "$CORE_NODE" "$WORKER" check-refresh "$APPLICATION_ROOT" "$REQUEST_PATH" "$current" >/dev/null || return 1
    if [ "$RUNTIME_COMMAND" = true ]; then runtime_check "$current" >/dev/null || return 1; PAUSED_COMMITTED=null; fi
    COMMITTED=null
    if [ "$started" = true ]; then
      if [ "$UPGRADE" = true ]; then UPGRADED=null; fi
      /bin/bash "$SCRIPT_DIR/switch-theme-macos.sh" --manager-snapshot-dir "$directory" --lock-token "$TOKEN" --no-apply >/dev/null || return 1
      COMMITTED=true
      COMMITTED_REVISION="$requested_revision"
      RENDERED=null
      if [ "$(field "$before" processRunning)" = true ]; then RESTARTED=null; fi
      /bin/bash "$SCRIPT_DIR/start-dream-skin-macos.sh" --restart-existing --theme-staged --manager-precondition "$fingerprint" --manager-application-root "$APPLICATION_ROOT" >/dev/null || return 1
      # An existing CDP browser only hands off the watcher, without quitting Codex.
      RESTARTED=false
      if [ -z "$(field "$before" runtimeSessionId)" ]; then RESTARTED="$(field "$before" processRunning)"; fi
    else
      RENDERED=null
      local switch_args=(--manager-snapshot-dir "$directory" --lock-token "$TOKEN" --no-auto-restart)
      [ "$opacity_only" != true ] || switch_args+=(--opacity-only)
      /bin/bash "$SCRIPT_DIR/switch-theme-macos.sh" "${switch_args[@]}" >/dev/null || return 1
      COMMITTED=true
      COMMITTED_REVISION="$requested_revision"
    fi
  fi
  verification_before="$(probe)" || return 1
  [ -n "$(field "$verification_before" runtimeSessionId)" ] || return 1
  VERIFY_PATH="$(/usr/bin/mktemp "$REQUEST_PATH.verify.XXXXXX")" || return 1
  /bin/bash "$SCRIPT_DIR/verify-dream-skin-macos.sh" >"$VERIFY_PATH" || return 1
  mapped="$("$CORE_NODE" "$WORKER" verify "$APPLICATION_ROOT" "$REQUEST_PATH" "$VERIFY_PATH")" || return 1
  /bin/rm -f "$VERIFY_PATH"
  VERIFY_PATH=""
  verification_after="$(probe)" || return 1
  [ "$(field "$verification_before" runtimeSessionId)" = "$(field "$verification_after" runtimeSessionId)" ] || return 1
  COMMITTED=true
  RENDERED=true
  if [ "$UPGRADE" = true ]; then
    "$CORE_NODE" "$APPLICATION_ROOT/shared/core/runtime-worker.mjs" record-engine "$APPLICATION_ROOT" "$verification_after" "$REQUEST_PATH" >/dev/null || return 1
    UPGRADED=true
  fi
  if [ "$RUNTIME_COMMAND" = true ]; then
    [ "$(field "$verification_after" paused)" = false ] || { PAUSED_COMMITTED=false; return 1; }
    PAUSED_COMMITTED=true
  fi
  local completed
  completed="$(result "$(field "$mapped" committedRevision)" "$(field "$mapped" verifiedRendererRevision)" "$(field "$verification_after" runtimeSessionId)")" || return 1
  if [ "$ACTION" = apply ] || [ "$ACTION" = commitcommunity ]; then
    "$CORE_NODE" "$WORKER" settle "$APPLICATION_ROOT" "$REQUEST_PATH" "$completed" >/dev/null || return 1
  fi
  printf '%s\n' "$completed"
}
# Run with explicit error propagation: a failed hot path never escalates to restart.
if transaction; then :; else result; fi
