#!/bin/bash

# Fast status for SwiftBar. No codesign / CDP probes by default.

set +e
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/localization-macos.sh"

SHORT="false"
JSON="false"
DEEP="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --short) SHORT="true"; shift ;;
    --json) JSON="true"; shift ;;
    --deep) DEEP="true"; shift ;;
    *) printf 'Unknown status argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

STATE_ROOT="${HOME}/Library/Application Support/CodexDreamSkinStudio"
STATE_PATH="${STATE_ROOT}/state.json"
OPERATION_STATE_PATH="${STATE_ROOT}/operation-state.plist"
THEME_DIR="${STATE_ROOT}/theme"

PORT="9341"
SESSION="off"
INJECTOR_ALIVE="false"
CDP_OK="false"
THEME_NAME=""
THEME_ID=""
APPLIED_THEME_NAME=""
APPLIED_THEME_ID=""
THEME_POSITION_X="0"
THEME_POSITION_Y="0"
THEME_ZOOM="1"
THEME_POSITION_MODE="locked"
THEME_FRAMING_ENABLED="false"
THEME_FOCUS_X="0.5"
THEME_FOCUS_Y="0.5"
ACTIVE_IMAGE=""
CODEX_RUNNING="false"
OPERATION_STATUS=""
OPERATION_MESSAGE=""
MANAGER_THEMES_JSON="[]"

read_json_text_field() {
  # Parse machine-written JSON (one key per line) without python3, which macOS
  # 12.3+ no longer preinstalls. Handles "key": "string" and "key": number.
  local text="$1"
  local key="$2"
  [ -n "$text" ] || return 0
  LC_ALL=C /usr/bin/printf '%s\n' "$text" |
  /usr/bin/sed -n \
    -e 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    -e 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\(\.[0-9][0-9]*\)\{0,1\}\).*/\1/p' \
    2>/dev/null | /usr/bin/head -n1
}

read_json_bool_field() {
  local text="$1"
  local key="$2"
  [ -n "$text" ] || return 0
  LC_ALL=C /usr/bin/printf '%s\n' "$text" |
    /usr/bin/sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p' \
    2>/dev/null | /usr/bin/head -n1
}

read_plist_snapshot_field() {
  local snapshot="$1"
  local key="$2"
  [ -n "$snapshot" ] || return 0
  LC_ALL=C /usr/bin/printf '%s' "$snapshot" \
    | /usr/bin/plutil -extract "$key" raw -o - - 2>/dev/null
}

# Keep this check deliberately shell/ps-only: SwiftBar invokes status every
# few seconds and must not perform codesign, CDP, or Node startup.  A live PID
# alone is not enough because a stale state file can outlive the watcher and
# its PID may later be reused by an unrelated process.
injector_identity_matches() {
  local pid="$1"
  local expected_start="$2"
  local expected_node="$3"
  local expected_injector="$4"
  local expected_port="$5"
  local command_line command_lower node_lower injector_lower actual_start

  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$pid" != "0" ] || return 1
  [ -n "$expected_start" ] && [ -n "$expected_node" ] && [ -n "$expected_injector" ] || return 1
  case "$expected_port" in ''|*[!0-9]*) return 1 ;; esac
  /bin/kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
  [ -n "$command_line" ] || return 1
  command_lower="$(printf '%s' "$command_line" | /usr/bin/tr '[:upper:]' '[:lower:]')"
  node_lower="$(printf '%s' "$expected_node" | /usr/bin/tr '[:upper:]' '[:lower:]')"
  injector_lower="$(printf '%s' "$expected_injector" | /usr/bin/tr '[:upper:]' '[:lower:]')"
  case "$command_lower" in "$node_lower "*) ;; *) return 1 ;; esac
  case "$command_lower" in *"$injector_lower"*--watch*) ;; *) return 1 ;; esac
  # The watcher launch shape puts --theme-dir immediately after the port.
  # Requiring that following token prevents 93410 from matching saved port
  # 9341 via a loose prefix pattern.
  case "$command_lower" in *"--port $expected_port --theme-dir "*) ;; *) return 1 ;; esac
  actual_start="$(/bin/ps -p "$pid" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
  [ -n "$actual_start" ] && [ "$actual_start" = "$expected_start" ]
}

# Codex process: cheap name match only.  26.707 renamed Codex.app to
# ChatGPT.app, while older installs still expose the former process name.
if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1 || /usr/bin/pgrep -x Codex >/dev/null 2>&1; then
  CODEX_RUNNING="true"
fi

if [ -f "$STATE_PATH" ]; then
  STATE_SNAPSHOT="$(/bin/cat "$STATE_PATH" 2>/dev/null)"
  saved_port="$(read_json_text_field "$STATE_SNAPSHOT" port)"
  [ -n "${saved_port:-}" ] && PORT="$saved_port"
  SESSION="$(read_json_text_field "$STATE_SNAPSHOT" session)"
  pid="$(read_json_text_field "$STATE_SNAPSHOT" injectorPid)"
  saved_start="$(read_json_text_field "$STATE_SNAPSHOT" injectorStartedAt)"
  saved_node="$(read_json_text_field "$STATE_SNAPSHOT" nodePath)"
  saved_injector="$(read_json_text_field "$STATE_SNAPSHOT" injectorPath)"
  APPLIED_THEME_ID="$(read_json_text_field "$STATE_SNAPSHOT" appliedThemeId)"
  APPLIED_THEME_NAME="$(read_json_text_field "$STATE_SNAPSHOT" appliedThemeName)"
  if injector_identity_matches "${pid:-}" "$saved_start" "$saved_node" "$saved_injector" "$PORT"; then
    INJECTOR_ALIVE="true"
    case "${SESSION:-}" in
      applying) SESSION="applying" ;;
      active|'') SESSION="active" ;;
      paused) SESSION="paused" ;;
      stale) SESSION="stale" ;;
      *) SESSION="unknown" ;;
    esac
  elif [ "${SESSION:-}" = "paused" ]; then
    SESSION="paused"
  else
    case "${SESSION:-}" in
      active|stale) SESSION="stale" ;;
      applying) SESSION="applying" ;;
      off) SESSION="off" ;;
      '') [ -n "${pid:-}" ] && [ "$pid" != "0" ] && SESSION="stale" || SESSION="off" ;;
      *) SESSION="unknown" ;;
    esac
  fi
fi

if [ -f "$THEME_DIR/theme.json" ]; then
  THEME_SNAPSHOT="$(/bin/cat "$THEME_DIR/theme.json" 2>/dev/null)"
  THEME_ID="$(read_json_text_field "$THEME_SNAPSHOT" id)"
  THEME_NAME="$(read_json_text_field "$THEME_SNAPSHOT" name)"
  [ -n "$(read_json_text_field "$THEME_SNAPSHOT" focusX)" ] && THEME_FOCUS_X="$(read_json_text_field "$THEME_SNAPSHOT" focusX)"
  [ -n "$(read_json_text_field "$THEME_SNAPSHOT" focusY)" ] && THEME_FOCUS_Y="$(read_json_text_field "$THEME_SNAPSHOT" focusY)"
  [ -n "$(read_json_text_field "$THEME_SNAPSHOT" positionX)" ] && THEME_POSITION_X="$(read_json_text_field "$THEME_SNAPSHOT" positionX)"
  [ -n "$(read_json_text_field "$THEME_SNAPSHOT" positionY)" ] && THEME_POSITION_Y="$(read_json_text_field "$THEME_SNAPSHOT" positionY)"
  [ -n "$(read_json_text_field "$THEME_SNAPSHOT" zoom)" ] && THEME_ZOOM="$(read_json_text_field "$THEME_SNAPSHOT" zoom)"
  [ -n "$(read_json_text_field "$THEME_SNAPSHOT" positionMode)" ] && THEME_POSITION_MODE="$(read_json_text_field "$THEME_SNAPSHOT" positionMode)"
  [ -n "$(read_json_bool_field "$THEME_SNAPSHOT" framingEnabled)" ] && THEME_FRAMING_ENABLED="$(read_json_bool_field "$THEME_SNAPSHOT" framingEnabled)"
  [ -n "$THEME_NAME" ] || THEME_NAME="$THEME_ID"
  ACTIVE_IMAGE="$THEME_DIR/$(read_json_text_field "$THEME_SNAPSHOT" image)"
  [ -f "$ACTIVE_IMAGE" ] || ACTIVE_IMAGE=""
fi
[ -n "$APPLIED_THEME_ID" ] || { [ "$SESSION" = "active" ] && APPLIED_THEME_ID="$THEME_ID"; }
[ -n "$APPLIED_THEME_NAME" ] || { [ "$SESSION" = "active" ] && APPLIED_THEME_NAME="$THEME_NAME"; }

if [ -f "$OPERATION_STATE_PATH" ]; then
  OPERATION_SNAPSHOT="$(/bin/cat "$OPERATION_STATE_PATH" 2>/dev/null)"
  operation_status="$(read_plist_snapshot_field "$OPERATION_SNAPSHOT" status)"
  operation_message="$(read_plist_snapshot_field "$OPERATION_SNAPSHOT" message)"
  operation_updated_at="$(read_plist_snapshot_field "$OPERATION_SNAPSHOT" updatedAt)"
  now="$(/bin/date +%s)"
  case "$operation_updated_at" in ''|*[!0-9]*) operation_updated_at="0" ;; esac
  age=$((now - operation_updated_at))
  ttl=0
  case "$operation_status" in
    applying) ttl=180 ;;
    pausing) ttl=90 ;;
    failed) ttl=120 ;;
    cancelled) ttl=20 ;;
    success|paused) ttl=12 ;;
  esac
  if [ "$age" -ge 0 ] && [ "$ttl" -gt 0 ] && [ "$age" -le "$ttl" ]; then
    OPERATION_STATUS="$operation_status"
    OPERATION_MESSAGE="$operation_message"
  elif { [ "$operation_status" = "applying" ] || [ "$operation_status" = "pausing" ]; } \
    && [ "$age" -ge 0 ] && [ "$age" -le $((ttl + 120)) ]; then
    OPERATION_STATUS="failed"
    OPERATION_MESSAGE="$(dreamskin_text operation_timeout)"
  fi
fi

if [ "$SESSION" = "applying" ] && [ "$OPERATION_STATUS" != "applying" ]; then
  if [ "$INJECTOR_ALIVE" = "true" ]; then SESSION="stale"; else SESSION="unknown"; fi
fi

if [ "$DEEP" = "true" ]; then
  if /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    CDP_OK="true"
  fi
fi

label="Skin"
case "$SESSION" in
  active) label="Skin ON" ;;
  applying) label="$(dreamskin_text skin_applying_label)" ;;
  paused|off) label="Skin OFF" ;;
  stale|unknown) label="$(dreamskin_text skin_unavailable)" ;;
  *) label="$(dreamskin_text skin_unavailable)" ;;
esac
case "$OPERATION_STATUS" in
  applying) label="$(dreamskin_text skin_applying_label)" ;;
  pausing) label="$(dreamskin_text skin_pausing_label)" ;;
  failed)
    case "$SESSION" in
      active) label="Skin ON · $(dreamskin_text operation_failed_short)" ;;
      paused|off) label="Skin OFF · $(dreamskin_text operation_failed_short)" ;;
      *) label="$(dreamskin_text skin_unavailable) · $(dreamskin_text operation_failed_short)" ;;
    esac
    ;;
  cancelled) label="$label · $(dreamskin_text cancelled_short)" ;;
esac

if [ "$SHORT" = "true" ]; then
  printf '%s\n' "$label"
  exit 0
fi

if [ "$JSON" = "true" ]; then
  # The menu-bar path stays shell-only. The manager exports the already
  # verified bundled Node before invoking this JSON path. Direct status still
  # works without an installed client, but cannot enumerate saved themes.
  if [ -n "${NODE:-}" ] && [ -x "$NODE" ]; then
    MANAGER_THEMES_JSON="$("$NODE" "$SCRIPT_DIR/list-manager-themes-macos.mjs" "$STATE_ROOT")" \
      || MANAGER_THEMES_JSON="[]"
  fi
  # Emit JSON without python3; escape strings for a valid JSON string context.
  json_escape() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "$s"; }
  bool() { [ "$1" = "true" ] && printf 'true' || printf 'false'; }
  case "$PORT" in ''|*[!0-9]*) port_json="\"$(json_escape "$PORT")\"" ;; *) port_json="$PORT" ;; esac
  is_running="false"; [ "$SESSION" = "active" ] && is_running="true"
  is_paused="false"; [ "$SESSION" = "paused" ] && is_paused="true"
  status_kind="stopped"
  case "$SESSION" in active) status_kind="running" ;; applying) status_kind="starting" ;; paused) status_kind="paused" ;; stale) status_kind="stale" ;; unknown) status_kind="mismatch" ;; esac
  status_message="$OPERATION_MESSAGE"
  [ -n "$status_message" ] || case "$SESSION" in active) status_message="$(dreamskin_text skin_applied)" ;; paused) status_message="$(dreamskin_text skin_paused)" ;; stale|unknown) status_message="$(dreamskin_text skin_unavailable)" ;; esac
  printf '{"isRunning":%s,"isPaused":%s,"statusKind":"%s","statusMessage":"%s","session":"%s","operation":"%s","operationMessage":"%s","port":%s,"injectorAlive":%s,"cdpOk":%s,"codexRunning":%s,"themeId":"%s","themeName":"%s","positionX":%s,"positionY":%s,"zoom":%s,"positionMode":"%s","framingEnabled":%s,"activeThemeId":"%s","activeTheme":"%s","activeImage":"%s","activeFocusX":%s,"activeFocusY":%s,"activePositionX":%s,"activePositionY":%s,"activeZoom":%s,"activePositionMode":"%s","activeFramingEnabled":%s,"appliedThemeId":"%s","appliedThemeName":"%s","managerApiVersion":"1.5","themeSchemaVersion":1,"stateSchemaVersion":4,"injectorVersion":"1","supportedActions":["Status","ApplyTheme","DeleteTheme","ImportTheme","ImportBatch","Pause","Resume","ResetTheme","ValidateImage"],"themes":%s}\n' \
    "$is_running" "$is_paused" "$(json_escape "$status_kind")" "$(json_escape "$status_message")" \
    "$(json_escape "$SESSION")" "$(json_escape "$OPERATION_STATUS")" "$(json_escape "$OPERATION_MESSAGE")" \
    "$port_json" "$(bool "$INJECTOR_ALIVE")" "$(bool "$CDP_OK")" "$(bool "$CODEX_RUNNING")" \
    "$(json_escape "$THEME_ID")" "$(json_escape "$THEME_NAME")" \
    "$THEME_POSITION_X" "$THEME_POSITION_Y" "$THEME_ZOOM" "$(json_escape "$THEME_POSITION_MODE")" "$(bool "$THEME_FRAMING_ENABLED")" \
    "$(json_escape "$THEME_ID")" "$(json_escape "$THEME_NAME")" "$(json_escape "$ACTIVE_IMAGE")" \
    "$THEME_FOCUS_X" "$THEME_FOCUS_Y" "$THEME_POSITION_X" "$THEME_POSITION_Y" "$THEME_ZOOM" "$(json_escape "$THEME_POSITION_MODE")" "$(bool "$THEME_FRAMING_ENABLED")" \
    "$(json_escape "$APPLIED_THEME_ID")" "$(json_escape "$APPLIED_THEME_NAME")" \
    "$MANAGER_THEMES_JSON"
  exit 0
fi

printf 'session=%s\n' "$SESSION"
printf 'label=%s\n' "$label"
printf 'operation=%s\n' "$OPERATION_STATUS"
printf 'operation_message=%s\n' "$OPERATION_MESSAGE"
printf 'port=%s\n' "$PORT"
printf 'injector=%s\n' "$INJECTOR_ALIVE"
printf 'cdp=%s\n' "$CDP_OK"
printf 'codex=%s\n' "$CODEX_RUNNING"
printf 'theme_id=%s\n' "${THEME_ID:-}"
printf 'theme=%s\n' "${THEME_NAME:-}"
printf 'position_x=%s\n' "$THEME_POSITION_X"
printf 'position_y=%s\n' "$THEME_POSITION_Y"
printf 'zoom=%s\n' "$THEME_ZOOM"
printf 'position_mode=%s\n' "$THEME_POSITION_MODE"
printf 'framing_enabled=%s\n' "$THEME_FRAMING_ENABLED"
printf 'applied_theme_id=%s\n' "${APPLIED_THEME_ID:-}"
printf 'applied_theme=%s\n' "${APPLIED_THEME_NAME:-}"
