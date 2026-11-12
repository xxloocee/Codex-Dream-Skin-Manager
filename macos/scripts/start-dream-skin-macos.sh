#!/bin/bash

set -Eeuo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
assert_codex_user_environment || exit 1
OPERATION_TOKEN=""
OPERATION_FINISHED="false"
VERIFY_OUTPUT=""

activate_codex_window() {
  run_codex_in_verified_environment /usr/bin/open -a "$CODEX_BUNDLE" >/dev/null 2>&1 || true
}

record_start_exit() {
  local code="$1"
  local line="$2"
  local current_session=""
  [ -z "${VERIFY_OUTPUT:-}" ] || /bin/rm -f "$VERIFY_OUTPUT"
  [ "$code" -ne 0 ] || return 0
  [ "$OPERATION_FINISHED" != "true" ] || return 0
  [ -n "${OPERATION_TOKEN:-}" ] || return 0
  ensure_state_root 2>/dev/null || true
  if [ -f "$STATE_PATH" ] && [ -n "${NODE:-}" ]; then
    current_session="$(state_field session 2>/dev/null || true)"
    [ "$current_session" != "applying" ] || mark_state_stale 2>/dev/null || true
  fi
  printf '%s exit=%s line=%s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$code" "$line" \
    >> "$START_ERROR_LOG" 2>/dev/null || true
  write_operation_state failed "$(dreamskin_text apply_unconfirmed)" "${OPERATION_TOKEN:-}" 2>/dev/null || true
  finish_client_operation "${PORT:-9341}" error "$(dreamskin_text apply_unconfirmed)" \
    "$OPERATION_TOKEN" 1500 >/dev/null 2>&1 || true
  printf 'ChatGPT Dream Skin: start failed at line %s (exit %s). See %s\n' "$line" "$code" "$START_ERROR_LOG" >&2
}
trap 'code=$?; record_start_exit "$code" "$LINENO"' EXIT

cancel_start() {
  local message
  if [ "$THEME_STAGED" = "true" ]; then
    message="$(dreamskin_text restart_cancelled_theme_saved)"
  else
    message="$(dreamskin_text restart_cancelled)"
  fi
  if [ -n "$OPERATION_TOKEN" ]; then
    write_operation_state cancelled "$message" "$OPERATION_TOKEN" \
      || fail "Could not publish the cancelled apply state."
    finish_client_operation "$PORT" cancelled "$message" \
      "$OPERATION_TOKEN" 1500 >/dev/null 2>&1 || true
  fi
  OPERATION_FINISHED="true"
  printf '%s\n' "$message" >&2
  notify_user "$message" || true
  # Reserve a non-signal exit code for acknowledged, pre-restart cancellation.
  exit 20
}

PORT=9341
PORT_EXPLICIT="false"
RESTART_EXISTING="false"
PROMPT_RESTART="false"
FOREGROUND_INJECTOR="false"
THEME_STAGED="false"
MANAGER_PRECONDITION=""
MANAGER_APPLICATION_ROOT=""
MANAGER_VERIFICATION_PATH=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; PORT_EXPLICIT="true"; shift 2 ;;
    --restart-existing) RESTART_EXISTING="true"; shift ;;
    --prompt-restart) PROMPT_RESTART="true"; shift ;;
    --foreground-injector) FOREGROUND_INJECTOR="true"; shift ;;
    --theme-staged) THEME_STAGED="true"; shift ;;
    --manager-precondition) MANAGER_PRECONDITION="${2:-}"; shift 2 ;;
    --manager-application-root) MANAGER_APPLICATION_ROOT="${2:-}"; shift 2 ;;
    --manager-verification-path) MANAGER_VERIFICATION_PATH="${2:-}"; shift 2 ;;
    *) fail "Unknown start argument: $1" ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be between 1024 and 65535."

discover_codex_app
require_signed_node_runtime
assert_codex_process_environment || exit 1
ensure_state_root
if [ -n "$MANAGER_VERIFICATION_PATH" ]; then
  [ -n "$MANAGER_APPLICATION_ROOT" ] && [ -n "$MANAGER_PRECONDITION" ] || fail "Verification output requires a manager start plan."
  assert_manager_verification_path "$MANAGER_VERIFICATION_PATH" || fail "Invalid manager verification output."
fi
if [ "$FOREGROUND_INJECTOR" != "true" ]; then
  OPERATION_TOKEN="$(new_operation_token)"
  write_operation_state applying "$(dreamskin_text applying_skin)" "$OPERATION_TOKEN" \
    || fail "Could not publish the apply operation state."
fi
ENGINE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
ENGINE_WORKER="$ENGINE_ROOT/shared/core/runtime-worker.mjs"
LAUNCH_ENGINE_REVISION=""
if [ -f "$ENGINE_WORKER" ]; then
  if engine_info="$("$NODE" "$ENGINE_WORKER" engine-revision "$ENGINE_ROOT")"; then
    LAUNCH_ENGINE_REVISION="$("$NODE" -e 'process.stdout.write(JSON.parse(process.argv[1]).engineRevision)' "$engine_info")"
  else
    printf 'Warning: engine version is unknown; skin startup will continue.\n' >&2
  fi
fi

if [ "$PORT_EXPLICIT" = "false" ] && [ -f "$STATE_PATH" ]; then
  saved_port="$(state_field port)" || fail "Could not read the existing state port."
  [ -n "$saved_port" ] && PORT="$saved_port"
fi

DEBUG_READY="false"
if verified_cdp_endpoint "$PORT"; then DEBUG_READY="true"; fi

if [ "$DEBUG_READY" = "true" ] && [ -n "$OPERATION_TOKEN" ]; then
  begin_client_operation "$PORT" apply 3000 "$OPERATION_TOKEN" >/dev/null 2>&1 || true
fi

# A connected renderer can show progress before the App check. Before this
# script launches or restarts ChatGPT, verify the complete bundle.
if [ "$DEBUG_READY" = "false" ]; then
  verify_macos_app_signature deep
else
  verify_macos_app_signature quick
fi

if codex_is_running && [ "$DEBUG_READY" = "false" ]; then
  if [ "$PROMPT_RESTART" = "true" ] && [ "$RESTART_EXISTING" = "false" ]; then
    if ! /usr/bin/osascript - "$(dreamskin_text restart_prompt)" \
      "$(dreamskin_text restart_and_apply)" "$(dreamskin_text cancel)" <<'APPLESCRIPT' >/dev/null
on run argv
  set promptText to item 1 of argv
  set okLabel to item 2 of argv
  set cancelLabel to item 3 of argv
  display dialog promptText buttons {cancelLabel, okLabel} default button okLabel cancel button cancelLabel with title "ChatGPT Dream Skin"
end run
APPLESCRIPT
    then
      cancel_start
    fi
    RESTART_EXISTING="true"
  fi
  [ "$RESTART_EXISTING" = "true" ] || fail "ChatGPT is already running without the verified skin CDP endpoint. Close it first or pass --restart-existing."
  if [ -n "$MANAGER_PRECONDITION" ]; then
    current_probe="$(/bin/bash "$SCRIPT_DIR/manager-platform.sh" probe "$MANAGER_APPLICATION_ROOT")" || fail "Could not recheck restart consent."
    current_fingerprint="$("$NODE" -e 'process.stdout.write(JSON.parse(process.argv[1]).fingerprint)' "$current_probe")"
    [ "$current_fingerprint" = "$MANAGER_PRECONDITION" ] || fail "The confirmed Codex process/session changed before restart."
  fi
  if quit_codex_for_restart; then
    :
  else
    quit_status=$?
    [ "$quit_status" -ne 20 ] || cancel_start
    exit "$quit_status"
  fi
fi

if [ -f "$STATE_PATH" ]; then
  if [ -n "$MANAGER_PRECONDITION" ] && [ "$DEBUG_READY" = true ]; then
    current_probe="$(/bin/bash "$SCRIPT_DIR/manager-platform.sh" probe "$MANAGER_APPLICATION_ROOT")" || fail "Could not recheck watcher handoff consent."
    current_fingerprint="$("$NODE" -e 'process.stdout.write(JSON.parse(process.argv[1]).fingerprint)' "$current_probe")"
    [ "$current_fingerprint" = "$MANAGER_PRECONDITION" ] || fail "The confirmed browser session changed before watcher handoff."
  fi
  stop_recorded_injector
fi

INJECTOR_PID=""
LAUNCHED_CODEX="false"
if [ "$DEBUG_READY" = "false" ]; then
  # Codex is closed on this path (never started, or stopped just above), so it
  # is safe to sync the appearanceTheme pin to the staged theme before launch.
  # Best-effort: a config we refuse to rewrite should not block starting.
  sync_appearance_pin >/dev/null \
    || printf 'Warning: could not sync Codex appearanceTheme to the active theme; native menus may keep the previous appearance.\n' >&2
  PORT="$(select_available_port "$PORT")"
  printf 'Launching ChatGPT with skin debug port %s…\n' "$PORT" >&2
  launch_codex_with_cdp "$PORT"
  LAUNCHED_CODEX="true"
  # Start probing immediately instead of waiting for the native window to finish loading.
  if [ "$FOREGROUND_INJECTOR" != "true" ]; then
    INJECTOR_PID="$(launch_injector_daemon "$PORT")"
  fi
  if ! wait_for_cdp "$PORT"; then
    [ -z "$INJECTOR_PID" ] || /bin/kill -TERM "$INJECTOR_PID" 2>/dev/null || true
    fail "ChatGPT did not expose a verified loopback CDP endpoint on port $PORT within 45 seconds. See $APP_LOG and $APP_ERROR_LOG"
  fi
fi

# LaunchServices activation reaches the already-running, identity-bound App.
# Do not use -n here: a second instance can arrive before ChatGPT has registered
# its reopen handler and leave a debuggable renderer without a native window.
activate_codex_window

if [ "$FOREGROUND_INJECTOR" = "true" ]; then
  exec "$NODE" "$INJECTOR" --watch --port "$PORT" --theme-dir "$THEME_DIR" \
    --operation-state "$OPERATION_STATE_PATH" --operation-ack "$OPERATION_ACK_PATH"
fi

if [ -z "$INJECTOR_PID" ]; then
  INJECTOR_PID="$(launch_injector_daemon "$PORT")"
fi
/bin/sleep 0.15
/bin/kill -0 "$INJECTOR_PID" 2>/dev/null || fail "The injector exited during startup. See $INJECTOR_ERROR_LOG"
INJECTOR_STARTED_AT="$(process_started_at "$INJECTOR_PID")"
[ -n "$INJECTOR_STARTED_AT" ] || fail "Could not record the injector process start time."
CODEX_PID="$(codex_main_pids | /usr/bin/head -n 1)"
write_state "$PORT" "$INJECTOR_PID" "$INJECTOR_STARTED_AT" "$CODEX_PID"

# Commit active only after the renderer, exact theme, and payload revision verify.
VERIFY_OUTPUT="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/dream-skin-verify.XXXXXX")"
/bin/chmod 600 "$VERIFY_OUTPUT"
cleanup_verify_output() {
  [ -z "${VERIFY_OUTPUT:-}" ] || /bin/rm -f "$VERIFY_OUTPUT"
  VERIFY_OUTPUT=""
}
if "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >"$VERIFY_OUTPUT" 2>/dev/null; then
  verify_code=0
else
  verify_code=$?
fi
if [ "$verify_code" -ne 0 ]; then
  # A slow App startup may register its reopen handler after CDP. Activate the
  # exact bundle once more before the final force-inject and verification pass.
  activate_codex_window
  retry_args=(--once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 15000)
  [ -z "$OPERATION_TOKEN" ] || retry_args+=(--operation-token "$OPERATION_TOKEN")
  if "$NODE" "$INJECTOR" "${retry_args[@]}" >"$VERIFY_OUTPUT" 2>/dev/null; then
    verify_code=0
  else
    verify_code=$?
  fi
fi
if [ "$verify_code" -ne 0 ]; then
  # Verify the PID/path/start-time tuple before changing state. If the watcher
  # cannot be stopped safely, preserve the state as evidence and fail closed.
  if ! stop_recorded_injector; then
    cleanup_verify_output
    fail "Injection verification failed and the recorded injector could not be stopped safely; state was preserved. See $INJECTOR_ERROR_LOG"
  fi
  mark_state_stale || true
  cleanup_verify_output
  fail "Injection verification failed. The injector was stopped; see $INJECTOR_ERROR_LOG"
fi
if [ -n "$MANAGER_VERIFICATION_PATH" ]; then
  /bin/cat "$VERIFY_OUTPUT" >"$MANAGER_VERIFICATION_PATH"
fi
cleanup_verify_output

mark_state_active || fail "Could not commit the verified active skin state."
if [ -n "$LAUNCH_ENGINE_REVISION" ]; then
  if recorded_injector_process_matches "$INJECTOR_PID" "$INJECTOR_STARTED_AT" "$NODE" "$INJECTOR" "$PORT"; then
    "$NODE" "$ENGINE_WORKER" record-start "$ENGINE_ROOT" "$LAUNCH_ENGINE_REVISION" >/dev/null \
      || printf 'Warning: the skin was verified, but its engine version could not be recorded.\n' >&2
  fi
fi
write_operation_state success "$(dreamskin_text skin_applied)" "$OPERATION_TOKEN" \
  || fail "Could not publish the completed apply state."
OPERATION_FINISHED="true"
if [ "$LAUNCHED_CODEX" = "true" ] && [ -f "$ENGINE_ROOT/shared/core/startup-animation-worker.mjs" ]; then
  "$NODE" "$ENGINE_ROOT/shared/core/startup-animation-worker.mjs" "$ENGINE_ROOT" "$PORT" >"$STATE_ROOT/startup-animation.log" 2>&1 \
    || printf 'Warning: startup animation could not start; the applied skin is unchanged.\n' >&2
fi
printf 'ChatGPT Dream Skin %s is active on loopback port %s.\n' "$SKIN_VERSION" "$PORT"
