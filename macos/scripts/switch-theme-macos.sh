#!/bin/bash

# Switch to a theme pack under themes/<id>/ — hot path when CDP is live.

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
assert_codex_user_environment || exit 1
. "$SCRIPT_DIR/theme-switch-lock-macos.sh"

THEME_ID=""
SNAPSHOT_DIR=""
MANAGER_SNAPSHOT_DIR=""
AUTO_RESTART="true"
EXPECTED_CONTENT_FINGERPRINT=""
LOCK_TOKEN=""
LOCK_OWNER="$PPID"
APPLY_NOW="true"
OPACITY_ONLY="false"
OPERATION_TOKEN=""
stage=""

finish_switch() {
  local code="$1"
  [ -z "${stage:-}" ] || /bin/rm -rf "$stage"
  release_theme_switch_lock
  if [ "$code" -ne 0 ] && [ "$code" -ne 20 ] && [ -n "${OPERATION_TOKEN:-}" ]; then
    write_operation_state failed "$(dreamskin_text theme_switch_unconfirmed)" "$OPERATION_TOKEN" 2>/dev/null || true
    finish_client_operation "${PORT:-9341}" error "$(dreamskin_text theme_switch_unconfirmed)" \
      "$OPERATION_TOKEN" 1500 >/dev/null 2>&1 || true
  fi
}
trap 'finish_switch "$?"' EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) THEME_ID="${2:-}"; shift 2 ;;
    --snapshot-dir) SNAPSHOT_DIR="${2:-}"; shift 2 ;;
    --manager-snapshot-dir) MANAGER_SNAPSHOT_DIR="${2:-}"; shift 2 ;;
    --no-auto-restart) AUTO_RESTART="false"; shift ;;
    --expect-fingerprint) EXPECTED_CONTENT_FINGERPRINT="${2:-}"; shift 2 ;;
    --lock-token) LOCK_TOKEN="${2:-}"; shift 2 ;;
    --lock-owner) LOCK_OWNER="${2:-}"; shift 2 ;;
    --no-apply) APPLY_NOW="false"; shift ;;
    --opacity-only) OPACITY_ONLY="true"; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[ -z "$THEME_ID" ] || [ -z "$SNAPSHOT_DIR" ] || fail "Choose either a saved theme id or a rollback snapshot, not both."
[ -z "$MANAGER_SNAPSHOT_DIR" ] || { [ -z "$THEME_ID" ] && [ -z "$SNAPSHOT_DIR" ]; } || fail "Choose exactly one theme source."
[ -n "$THEME_ID" ] || [ -n "$SNAPSHOT_DIR" ] || [ -n "$MANAGER_SNAPSHOT_DIR" ] \
  || fail "Usage: switch-theme-macos.sh --id <theme-id> [--expect-fingerprint <sha256>]"
if [ -n "$MANAGER_SNAPSHOT_DIR" ]; then
  case "$MANAGER_SNAPSHOT_DIR" in "$STATE_ROOT"/manager-operations/snapshots/*) ;; *) fail "Manager snapshot escapes its reserved directory." ;; esac
  snapshot_leaf="${MANAGER_SNAPSHOT_DIR##*/}"
  case "$snapshot_leaf" in ''|*[!a-f0-9-]*) fail "Invalid manager snapshot identity." ;; esac
  [ "${#snapshot_leaf}" -eq 36 ] && [ "$MANAGER_SNAPSHOT_DIR" = "$STATE_ROOT/manager-operations/snapshots/$snapshot_leaf" ] \
    || fail "Invalid manager snapshot identity."
  [ -n "$LOCK_TOKEN" ] || fail "Manager snapshots require an inherited transaction lock."
fi
if [ "$OPACITY_ONLY" = "true" ]; then
  [ -n "$MANAGER_SNAPSHOT_DIR" ] && [ -n "$LOCK_TOKEN" ] && [ "$APPLY_NOW" = "true" ] \
    || fail "Opacity-only updates require an immediate manager snapshot publication under its inherited lock."
fi
if [ -n "$THEME_ID" ]; then
  case "$THEME_ID" in
    ''|.*|*[!A-Za-z0-9._-]*) fail "Theme id must start with a letter or number and contain only letters, numbers, dots, underscores, and hyphens." ;;
  esac
  [ "${#THEME_ID}" -le 80 ] || fail "Theme id is too long."
fi
if [ -n "$EXPECTED_CONTENT_FINGERPRINT" ]; then
  case "$EXPECTED_CONTENT_FINGERPRINT" in *[!0-9a-f]*|'') fail "Expected theme fingerprint must be lowercase SHA-256." ;; esac
  [ "${#EXPECTED_CONTENT_FINGERPRINT}" -eq 64 ] || fail "Expected theme fingerprint must be lowercase SHA-256."
fi
[ -z "$SNAPSHOT_DIR" ] || [ "$APPLY_NOW" = "true" ] \
  || fail "A rollback snapshot must be visibly reapplied and verified."

ensure_state_root
THEMES_ROOT="$STATE_ROOT/themes"
if [ -n "$MANAGER_SNAPSHOT_DIR" ]; then
  SRC="$MANAGER_SNAPSHOT_DIR"
  [ -d "$SRC" ] && [ ! -L "$SRC" ] || fail "Manager snapshot is missing."
elif [ -n "$THEME_ID" ]; then
  SRC="$THEMES_ROOT/$THEME_ID"
  [ -d "$SRC" ] || fail "Theme not found: $THEME_ID"
  [ -f "$SRC/theme.json" ] || fail "theme.json missing in $THEME_ID"
else
  case "$SNAPSHOT_DIR" in
    "$STATE_ROOT"/.community-apply-*/active-before|"$STATE_ROOT"/recovery/community-*/active-before) ;;
    *) fail "Rollback snapshot escapes the reserved community-apply namespace." ;;
  esac
  SRC="$SNAPSHOT_DIR"
  [ -d "$SRC" ] && [ ! -L "$SRC" ] || fail "Rollback snapshot is missing or invalid."
fi

ensure_node_runtime
assert_codex_process_environment || exit 1
if [ -n "$LOCK_TOKEN" ]; then
  assert_inherited_theme_switch_lock "$LOCK_TOKEN" "$LOCK_OWNER"
else
  acquire_theme_switch_lock "$(new_operation_token)"
fi
if [ "$APPLY_NOW" = "true" ]; then
  OPERATION_TOKEN="$(new_operation_token)"
  write_operation_state applying "$(dreamskin_text switching_theme)" "$OPERATION_TOKEN" \
    || fail "Could not publish the theme switch operation state."
fi
themes_root_real=""
[ ! -d "$THEMES_ROOT" ] || themes_root_real="$(cd "$THEMES_ROOT" && pwd -P)"
src_real="$(cd "$SRC" && pwd -P)"
if [ -n "$MANAGER_SNAPSHOT_DIR" ]; then
  [ "$src_real" = "$MANAGER_SNAPSHOT_DIR" ] || fail "Manager snapshot resolves through a link."
elif [ -n "$THEME_ID" ]; then
  case "$src_real/" in "$themes_root_real/"*) ;; *) fail "Theme directory escapes the saved theme library." ;; esac
else
  state_root_real="$(cd "$STATE_ROOT" && pwd -P)"
  case "$src_real" in
    "$state_root_real"/.community-apply-*/active-before|"$state_root_real"/recovery/community-*/active-before) ;;
    *) fail "Rollback snapshot escapes the reserved community-apply namespace." ;;
  esac
fi

PORT=9341
if [ -f "$STATE_PATH" ]; then
  saved="$(state_field port 2>/dev/null || true)"
  [ -n "${saved:-}" ] && PORT="$saved"
fi
if [ -n "$OPERATION_TOKEN" ] && verified_cdp_endpoint "$PORT" 2>/dev/null; then
  begin_client_operation "$PORT" switch 3000 "$OPERATION_TOKEN" >/dev/null 2>&1 || true
fi

progress() {
  printf '%s\n' "$*" >&2
  notify_user "$*"
}

progress "$(dreamskin_text validating_theme_content)"

stage="$(/usr/bin/mktemp -d "$STATE_ROOT/.theme-switch.XXXXXX")"
/bin/mkdir -p "$THEME_DIR"
/bin/chmod 700 "$stage"
# Snapshot theme.json and its referenced image from stable, no-follow file
# descriptors. This closes the validation/copy TOCTOU window: after this
# command returns, edits or symlink swaps in themes/<id> cannot mix the pair
# that will be published to the live theme directory.
STAGE_RESULT="$("$NODE" "$SCRIPT_DIR/stage-theme.mjs" "$SRC" "$stage")" \
  || fail "Theme pack changed or failed staging: $THEME_ID"
THEME_IMAGE="$("$NODE" -e '
const value = JSON.parse(process.argv[1]);
if (typeof value.image !== "string" || !value.image) process.exit(1);
process.stdout.write(value.image);
' "$STAGE_RESULT")" || fail "Theme staging returned an invalid image identity."
STAGED_CONTENT_FINGERPRINT="$("$NODE" -e '
const value = JSON.parse(process.argv[1]);
if (!/^[0-9a-f]{64}$/.test(value.contentFingerprint ?? "")) process.exit(1);
process.stdout.write(value.contentFingerprint);
' "$STAGE_RESULT")" || fail "Theme staging returned an invalid content fingerprint."
[ -z "$EXPECTED_CONTENT_FINGERPRINT" ] \
  || [ "$STAGED_CONTENT_FINGERPRINT" = "$EXPECTED_CONTENT_FINGERPRINT" ] \
  || fail "Saved theme content no longer matches the package that was imported."
# Validate the exact staged pair, not the mutable library directory. The
# injector performs the full schema, path, dimensions, and image checks.
PAYLOAD_RESULT="$("$NODE" "$INJECTOR" --check-payload --theme-dir "$stage")" \
  || fail "Theme pack failed validation: $THEME_ID"
if [ "$OPACITY_ONLY" = "true" ]; then
  OPACITY_APPLICATION_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
  OPACITY_REQUEST_PATH="$STATE_ROOT/manager-operations/requests/$snapshot_leaf.json"
  [ -f "$OPACITY_REQUEST_PATH" ] && [ ! -L "$OPACITY_REQUEST_PATH" ] \
    || fail "The opacity update has no valid manager request; nothing was published."
  "$NODE" -e '
const request = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (request.refresh?.opacityOnly !== true) process.exit(1);
' "$OPACITY_REQUEST_PATH" >/dev/null \
    || fail "The manager request does not authorize an opacity-only update; nothing was published."
  OPACITY_PROBE="$(/bin/bash "$SCRIPT_DIR/manager-platform.sh" probe "$OPACITY_APPLICATION_ROOT")" \
    || fail "The current skin connection could not be checked; the opacity update was not published."
  "$NODE" "$OPACITY_APPLICATION_ROOT/shared/core/apply-worker.mjs" check-refresh \
    "$OPACITY_APPLICATION_ROOT" "$OPACITY_REQUEST_PATH" "$OPACITY_PROBE" >/dev/null \
    || fail "The current watcher cannot guarantee an in-place opacity update; nothing was published."
  ACTIVE_PAYLOAD_RESULT="$("$NODE" "$INJECTOR" --check-payload --theme-dir "$THEME_DIR")" \
    || fail "The active video theme could not be checked; the opacity update was not published."
  "$NODE" -e '
const [next, current] = process.argv.slice(1).map(value => JSON.parse(value));
if (next.artMetadata?.video !== true || current.artMetadata?.video !== true ||
    typeof next.themeId !== "string" || next.themeId !== current.themeId ||
    typeof next.opacityUpdateKey !== "string" || !/^[a-f0-9]{64}$/.test(next.opacityUpdateKey) ||
    next.opacityUpdateKey !== current.opacityUpdateKey) process.exit(1);
' "$PAYLOAD_RESULT" "$ACTIVE_PAYLOAD_RESULT" >/dev/null \
    || fail "An opacity-only update must preserve the active video and theme configuration; nothing was published."
fi
THEME_BYTES="$(/usr/bin/stat -f '%z' "$stage/$THEME_IMAGE")"
case "$THEME_IMAGE" in
  *.[mM][pP]4) MAX_THEME_BYTES=134217728; MAX_THEME_LABEL="128 MiB" ;;
  *) MAX_THEME_BYTES=134217728; MAX_THEME_LABEL="128 MiB" ;;
esac
[ "$THEME_BYTES" -gt 0 ] && [ "$THEME_BYTES" -le "$MAX_THEME_BYTES" ] \
  || fail "Theme media must be non-empty and no larger than $MAX_THEME_LABEL."
# Staging must also work before Codex exposes CDP. The injector checks video
# decoding after the manager establishes the renderer connection.
if [ "$APPLY_NOW" = "true" ] && [ "$OPACITY_ONLY" != "true" ]; then
  "$NODE" "$SCRIPT_DIR/validate-video-file.mjs" "$stage/$THEME_IMAGE" "$STATE_PATH" >/dev/null
fi
SAFE_CSS_NAME=""
[ ! -f "$stage/theme.css" ] || SAFE_CSS_NAME="theme.css"
/bin/chmod 600 "$stage/"*
progress "$(dreamskin_text publishing_validated_theme)"
for entry in "$stage/"*; do
  [ -f "$entry" ] || continue
  [ "$(/usr/bin/basename "$entry")" = "theme.json" ] && continue
  /bin/mv -f "$entry" "$THEME_DIR/"
done
# A legacy theme has no Safe CSS. Remove the previous theme's CSS before the
# config commit marker so a failed cleanup cannot pair new metadata with old CSS.
[ -n "$SAFE_CSS_NAME" ] || /bin/rm -f "$THEME_DIR/theme.css"
# theme.json is the commit marker: the watcher never observes a config that
# references a partially copied image.
/bin/mv -f "$stage/theme.json" "$THEME_DIR/theme.json"
if [ -n "$SAFE_CSS_NAME" ]; then
  /usr/bin/find "$THEME_DIR" -maxdepth 1 -type f \
    ! -name 'theme.json' ! -name "$THEME_IMAGE" ! -name 'theme.css' -delete
else
  /usr/bin/find "$THEME_DIR" -maxdepth 1 -type f \
    ! -name 'theme.json' ! -name "$THEME_IMAGE" -delete
fi
/bin/rm -rf "$stage"
stage=""

THEME_NAME="$("$NODE" -e 'try{const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(t.name||"")}catch{}' "$THEME_DIR/theme.json" 2>/dev/null || true)"
[ -n "$THEME_NAME" ] || THEME_NAME="$THEME_ID"

if [ "$APPLY_NOW" != "true" ]; then
  progress "$(dreamskin_text theme_ready_not_applied): ${THEME_NAME}"
  exit 0
fi

# Hot path: CDP already open → seconds, not tens of seconds
progress "$(dreamskin_text applying_theme_to_chatgpt)"
if hot_reapply_theme "$PORT" 8000 "$OPERATION_TOKEN" "$OPACITY_ONLY"; then
  progress "$(dreamskin_text verifying_rendered_theme)"
  run_injector_with_diagnostics verify --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 10000 >/dev/null \
    || fail "Theme injection completed but the visible renderer did not verify the exact active theme."
  progress "$(dreamskin_text skin_applied): ${THEME_NAME}"
  exit 0
fi

# Cold path only when debug port is missing
[ "$OPACITY_ONLY" != "true" ] || fail "The opacity update could not be applied without replacing the video; no restart was attempted."
[ "$AUTO_RESTART" = "true" ] || fail "The shared manager requires new confirmation before starting or restarting Codex."
progress "$(dreamskin_text restarting_chatgpt_for_apply)"
if "$SCRIPT_DIR/start-dream-skin-macos.sh" --port "$PORT" --restart-existing --theme-staged; then
  progress "$(dreamskin_text skin_applied): ${THEME_NAME}"
  exit 0
else
  start_code=$?
  # Preserve the acknowledged cancellation and its operation state.
  [ "$start_code" -ne 20 ] || exit 20
fi

alert_user "$(dreamskin_text theme_switch_apply_failed)"
exit 1
