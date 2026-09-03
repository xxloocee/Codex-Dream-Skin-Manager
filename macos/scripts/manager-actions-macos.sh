#!/bin/bash

# Cross-platform manager backend for the upstream macOS runtime. It preserves
# the WPF action contract without importing Windows-specific PowerShell code.

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
. "$SCRIPT_DIR/common-macos.sh"

ACTION=""
IMAGE_PATH=""
THEME_ID=""
THEME_DIRECTORY=""
THEME_NAME=""
REQUEST_PATH=""
APPEARANCE="auto"
SAFE_AREA="auto"
TASK_MODE="auto"
FOCUS_X=""
FOCUS_Y=""
POSITION_X="0"
POSITION_Y="0"
ZOOM="1"
POSITION_MODE="locked"
FRAMING_ENABLED="false"
CATEGORY="custom"
TAGS_JSON="[]"
ACCENT=""
IMAGE_THEME_ID=""
KEEP_CURRENT="false"

usage() {
  printf '%s\n' 'Usage: manager-actions-macos.sh --action <Status|ApplyTheme|DeleteTheme|ImportTheme|ImportBatch|Pause|Resume|ResetTheme|ValidateImage> [options]' >&2
}

require_value() {
  [ -n "${2:-}" ] || { usage; exit 2; }
  printf '%s' "$2"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --action) ACTION="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --image-path) IMAGE_PATH="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --theme-id) THEME_ID="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --theme-directory) THEME_DIRECTORY="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --request-path) REQUEST_PATH="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --name) THEME_NAME="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --appearance) APPEARANCE="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --safe-area) SAFE_AREA="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --task-mode) TASK_MODE="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --focus-x) FOCUS_X="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --focus-y) FOCUS_Y="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --position-x) POSITION_X="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --position-y) POSITION_Y="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --zoom) ZOOM="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --position-mode) POSITION_MODE="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --framing-enabled) FRAMING_ENABLED="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --category) CATEGORY="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --tags-json) TAGS_JSON="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --accent) ACCENT="$(require_value "$1" "${2:-}")"; shift 2 ;;
    --keep-current) KEEP_CURRENT="true"; shift ;;
    *) usage; exit 2 ;;
  esac
done

case "$ACTION" in
  Status|ApplyTheme|DeleteTheme|ImportTheme|ImportBatch|Pause|Resume|ResetTheme|ValidateImage) ;;
  *) usage; exit 2 ;;
esac

ensure_node_runtime
export NODE
STATUS_SCRIPT="$SCRIPT_DIR/status-dream-skin-macos.sh"

status_json() {
  "$STATUS_SCRIPT" --json
}

validate_theme_directory() {
  local input="$1" root root_real input_name input_parent_real config
  root="$STATE_ROOT/themes"
  [ -d "$root" ] && [ ! -L "$root" ] || fail "Theme library does not exist or is unsafe."
  [ -d "$input" ] && [ ! -L "$input" ] || fail "Theme directory does not exist or is unsafe."
  root_real="$(cd "$root" && pwd -P)"
  input_name="$(/usr/bin/basename "$input")"
  case "$input_name" in ''|.*|*[!A-Za-z0-9._-]*) fail "Theme directory has an invalid id." ;; esac
  [ "${#input_name}" -le 80 ] || fail "Theme directory id is too long."
  input_parent_real="$(cd "$(/usr/bin/dirname "$input")" && pwd -P)"
  [ "$input_parent_real" = "$root_real" ] || fail "Theme directory must be a direct child of the saved theme library."
  config="$input_parent_real/$input_name/theme.json"
  [ -f "$config" ] && [ ! -L "$config" ] || fail "Theme directory is missing a safe theme.json."
  printf '%s\n' "$input_name"
}

load_image_args() {
  # macOS still ships Bash 3.2, so keep this as a global array instead of a
  # Bash 4 nameref parameter.
  LOAD_IMAGE_ARGS=(--file "$IMAGE_PATH" --name "${THEME_NAME:-Codex Dream Skin}" --appearance "$APPEARANCE" --safe-area "$SAFE_AREA" --task-mode "$TASK_MODE" --category "$CATEGORY" --tags-json "$TAGS_JSON")
  [ -n "$FOCUS_X" ] && LOAD_IMAGE_ARGS+=(--focus-x "$FOCUS_X")
  [ -n "$FOCUS_Y" ] && LOAD_IMAGE_ARGS+=(--focus-y "$FOCUS_Y")
  [ -n "$IMAGE_THEME_ID" ] && LOAD_IMAGE_ARGS+=(--theme-id "$IMAGE_THEME_ID")
  [ -n "$ACCENT" ] && LOAD_IMAGE_ARGS+=(--accent "$ACCENT")
  [ "$FRAMING_ENABLED" = "true" ] && LOAD_IMAGE_ARGS+=(--position-x "$POSITION_X" --position-y "$POSITION_Y" --zoom "$ZOOM" --position-mode "$POSITION_MODE" --framing true)
}

read_active_theme_id() {
  "$NODE" -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof value.id !== "string") process.exit(2);
      process.stdout.write(value.id);
    } catch (error) {
      if (error && error.code === "ENOENT") process.exit(0);
      process.exit(2);
    }
  ' "$STATE_ROOT/theme/theme.json"
}

case "$ACTION" in
  Status)
    exec "$STATUS_SCRIPT" --json
    ;;
  ApplyTheme)
    if [ -n "$THEME_DIRECTORY" ]; then THEME_ID="$(validate_theme_directory "$THEME_DIRECTORY")"; fi
    if [ -n "$THEME_ID" ]; then
      "$SCRIPT_DIR/switch-theme-macos.sh" --id "$THEME_ID" >/dev/null
      status_json
      exit 0
    fi
    [ -n "$IMAGE_PATH" ] || fail "ApplyTheme requires --theme-id, --theme-directory, or --image-path."
    load_image_args
    "$SCRIPT_DIR/load-image-theme-macos.sh" "${LOAD_IMAGE_ARGS[@]}" >/dev/null
    status_json
    ;;
  Pause)
    "$SCRIPT_DIR/pause-dream-skin-macos.sh" >/dev/null
    printf '{"isPaused":true}\n'
    ;;
  Resume)
    "$SCRIPT_DIR/start-dream-skin-macos.sh" --restart-existing >/dev/null
    printf '{"isPaused":false}\n'
    ;;
  ResetTheme)
    "$SCRIPT_DIR/switch-theme-macos.sh" --id preset-gothic-void-crusade >/dev/null
    status_json
    ;;
  ValidateImage)
    [ -n "$IMAGE_PATH" ] || fail "ValidateImage requires --image-path."
    exec "$NODE" "$SCRIPT_DIR/validate-image-macos.mjs" "$IMAGE_PATH"
    ;;
  ImportTheme)
    [ -n "$IMAGE_PATH" ] || fail "ImportTheme requires --image-path."
    [ -n "$THEME_NAME" ] || fail "ImportTheme requires --name."
    IMAGE_THEME_ID="img-$(/bin/date '+%Y%m%d%H%M%S')-$$"
    load_image_args
    [ "$KEEP_CURRENT" = "true" ] && LOAD_IMAGE_ARGS+=(--no-apply)
    "$SCRIPT_DIR/load-image-theme-macos.sh" "${LOAD_IMAGE_ARGS[@]}" >/dev/null
    "$NODE" -e 'const fs=require("node:fs");const p=require("node:path");const d=process.argv[1];const t=JSON.parse(fs.readFileSync(p.join(d,"theme.json"),"utf8"));process.stdout.write(JSON.stringify({id:t.id,name:t.name,themeDirectory:d}));' "$STATE_ROOT/themes/$IMAGE_THEME_ID"
    ;;
  ImportBatch)
    [ -n "$REQUEST_PATH" ] || fail "ImportBatch requires --request-path."
    requests_root="$STATE_ROOT/requests"
    /bin/mkdir -p "$requests_root"
    [ ! -L "$requests_root" ] || fail "Theme request directory is unsafe."
    request_parent="$(cd "$(/usr/bin/dirname "$REQUEST_PATH")" 2>/dev/null && pwd -P)" || fail "Batch request does not exist."
    requests_real="$(cd "$requests_root" && pwd -P)"
    [ "$request_parent" = "$requests_real" ] || fail "Batch request must stay inside the managed request directory."
    [ -f "$REQUEST_PATH" ] && [ ! -L "$REQUEST_PATH" ] || fail "Batch request is missing or unsafe."
    exec "$NODE" "$SCRIPT_DIR/import-batch-macos.mjs" "$REQUEST_PATH" "$SCRIPT_DIR/load-image-theme-macos.sh"
    ;;
  DeleteTheme)
    [ -n "$THEME_DIRECTORY" ] || fail "DeleteTheme requires --theme-directory."
    validate_theme_directory "$THEME_DIRECTORY" >/dev/null
    active_id="$(read_active_theme_id)" || fail "Current active theme could not be verified."
    exec "$NODE" "$SCRIPT_DIR/delete-theme-macos.mjs" "$STATE_ROOT" "$THEME_DIRECTORY" "$active_id"
    ;;
esac
