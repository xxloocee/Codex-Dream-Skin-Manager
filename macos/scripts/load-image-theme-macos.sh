#!/bin/bash

# Dynamically load one pure image as the active theme.
# Hot-applies when CDP is already open (fast).

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

IMAGE=""
THEME_NAME=""
FROM_LIBRARY=""
APPLY_NOW="true"
APPEARANCE="auto"
SAFE_AREA="auto"
TASK_MODE="auto"
FOCUS_X=""
FOCUS_Y=""
POSITION_X=""
POSITION_Y=""
ZOOM=""
POSITION_MODE="locked"
FRAMING_ENABLED="false"
CATEGORY="custom"
TAGS_JSON="[]"
ACCENT=""
THEME_ID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --file) IMAGE="${2:-}"; shift 2 ;;
    --from-library) FROM_LIBRARY="${2:-}"; shift 2 ;;
    --name) THEME_NAME="${2:-}"; shift 2 ;;
    --appearance) APPEARANCE="${2:-}"; shift 2 ;;
    --safe-area) SAFE_AREA="${2:-}"; shift 2 ;;
    --task-mode) TASK_MODE="${2:-}"; shift 2 ;;
    --focus-x) FOCUS_X="${2:-}"; shift 2 ;;
    --focus-y) FOCUS_Y="${2:-}"; shift 2 ;;
    --position-x) POSITION_X="${2:-}"; shift 2 ;;
    --position-y) POSITION_Y="${2:-}"; shift 2 ;;
    --zoom) ZOOM="${2:-}"; shift 2 ;;
    --position-mode) POSITION_MODE="${2:-}"; shift 2 ;;
    --framing) FRAMING_ENABLED="${2:-}"; shift 2 ;;
    --category) CATEGORY="${2:-}"; shift 2 ;;
    --tags-json) TAGS_JSON="${2:-}"; shift 2 ;;
    --accent) ACCENT="${2:-}"; shift 2 ;;
    --theme-id) THEME_ID="${2:-}"; shift 2 ;;
    --no-apply) APPLY_NOW="false"; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

case "$APPEARANCE" in auto|light|dark) ;; *) fail "Invalid appearance: $APPEARANCE" ;; esac
case "$SAFE_AREA" in auto|left|right|center|none) ;; *) fail "Invalid safe area: $SAFE_AREA" ;; esac
case "$TASK_MODE" in auto|ambient|banner|full|off) ;; *) fail "Invalid task mode: $TASK_MODE" ;; esac
case "$POSITION_MODE" in locked|free) ;; *) fail "Invalid position mode: $POSITION_MODE" ;; esac
case "$FRAMING_ENABLED" in true|false) ;; *) fail "Invalid framing flag: $FRAMING_ENABLED" ;; esac

ensure_state_root
IMAGES_DIR="$STATE_ROOT/images"
THEMES_ROOT="$STATE_ROOT/themes"
/bin/mkdir -p "$IMAGES_DIR" "$THEMES_ROOT"
# Stage imports outside the watched active directory, even for --no-apply.
THEME_DIR="$(/usr/bin/mktemp -d "$STATE_ROOT/.media-import.XXXXXX")"
trap '/bin/rm -rf "$THEME_DIR"' EXIT

if [ -n "$FROM_LIBRARY" ]; then
  [ "$(/usr/bin/basename "$FROM_LIBRARY")" = "$FROM_LIBRARY" ] \
    || fail "Library image must be a filename, not a path."
  case "$FROM_LIBRARY" in
    *$'\n'*|*$'\r'*|*'|'*|*'"'*|*'\'*) fail "Unsafe library image filename." ;;
  esac
  IMAGE="$IMAGES_DIR/$FROM_LIBRARY"
fi

[ -n "$IMAGE" ] || fail "Pass --file <image> or --from-library <name-in-images-dir>"
[ -f "$IMAGE" ] || fail "Image not found: $IMAGE"

image_lower="$(LC_ALL=C /usr/bin/printf '%s' "$IMAGE" | /usr/bin/tr '[:upper:]' '[:lower:]')"
case "$image_lower" in
  *.png|*.apng|*.jpg|*.jpeg|*.webp|*.gif|*.mp4|*.heic|*.tif|*.tiff) ;;
  *) fail "Unsupported image type: $IMAGE" ;;
esac

SOURCE_BYTES="$(/usr/bin/stat -f '%z' "$IMAGE")"
[ "$SOURCE_BYTES" -le 134217728 ] || fail "Image larger than 128 MiB."

if [ -z "$THEME_NAME" ]; then
  base="$(/usr/bin/basename "$IMAGE")"
  THEME_NAME="${base%.*}"
fi
[ -n "$THEME_NAME" ] || THEME_NAME="$(dreamskin_text default_theme_name)"

if [ -n "$THEME_ID" ]; then
  case "$THEME_ID" in
    [A-Za-z0-9]*) ;;
    *) fail "Invalid theme id: $THEME_ID" ;;
  esac
  case "$THEME_ID" in
    *[!A-Za-z0-9._-]*) fail "Invalid theme id: $THEME_ID" ;;
  esac
  [ "${#THEME_ID}" -le 80 ] || fail "Theme id is too long."
  [ ! -e "$THEMES_ROOT/$THEME_ID" ] && [ ! -L "$THEMES_ROOT/$THEME_ID" ] \
    || fail "Theme id already exists: $THEME_ID"
  theme_id="$THEME_ID"
else
  base_theme_id="img-$(/bin/date '+%Y%m%d%H%M%S')-$$"
  theme_id="$base_theme_id"
  suffix=1
  while [ -e "$THEMES_ROOT/$theme_id" ] || [ -L "$THEMES_ROOT/$theme_id" ]; do
    theme_id="${base_theme_id}-${suffix}"
    suffix=$((suffix + 1))
  done
fi

progress() {
  printf '%s\n' "$*" >&2
  notify_user "$*"
}

progress "$(dreamskin_text loading_image)"

# Fast Node for write-theme (avoid full codesign when possible)
ensure_node_runtime

# Reject decompression bombs before `sips -Z` rasterizes the full source image.
image_metadata="$("$NODE" "$SCRIPT_DIR/check-image-dimensions.mjs" "$IMAGE" 2>&1)" \
  || fail "$image_metadata"
animated="$("$NODE" --input-type=module -e '
const value = JSON.parse(process.argv[1]);
process.stdout.write(value.animated ? "true" : "false");
' "$image_metadata")"

ext="$(printf '%s' "$IMAGE" | /usr/bin/tr '[:upper:]' '[:lower:]')"
image_name="background.${ext##*.}"
temporary="$THEME_DIR/.${image_name}.$$"
prepared="$THEME_DIR/$image_name"
# Preserve Windows-supported media byte-for-byte. Legacy HEIC/TIFF inputs
# need a lossless PNG for Chromium; retain their original alongside it.
ORIGINAL_IMAGE=""
case "$ext" in
  *.heic|*.tif|*.tiff)
    ORIGINAL_IMAGE="original.${ext##*.}"
    /bin/cp "$IMAGE" "$THEME_DIR/$ORIGINAL_IMAGE"
    image_name="background.png"
    temporary="$THEME_DIR/.background.png.$$"
    prepared="$THEME_DIR/$image_name"
    /usr/bin/sips -s format png "$IMAGE" --out "$temporary" >/dev/null
    ;;
  *) /bin/cp "$IMAGE" "$temporary" ;;
esac
[ -s "$temporary" ] || fail "Prepared image is empty."
PREPARED_BYTES="$(/usr/bin/stat -f '%z' "$temporary")"
case "$image_name" in
  *.mp4) MAX_PREPARED_BYTES=134217728; MAX_PREPARED_LABEL="128 MiB" ;;
  *) MAX_PREPARED_BYTES=134217728; MAX_PREPARED_LABEL="128 MiB" ;;
esac
[ "$PREPARED_BYTES" -le "$MAX_PREPARED_BYTES" ] || fail "Prepared background larger than $MAX_PREPARED_LABEL."
/bin/chmod 600 "$temporary"
case "$image_name" in
  *.mp4) "$NODE" "$SCRIPT_DIR/validate-video-file.mjs" "$temporary" "$STATE_PATH" --mp4 >/dev/null ;;
esac
/bin/mv -f "$temporary" "$prepared"

theme_args=(
  custom
  --output-dir "$THEME_DIR"
  --image "$image_name"
  --name "$THEME_NAME"
  --tagline "Make something wonderful."
  --quote "MAKE SOMETHING WONDERFUL"
  --appearance "$APPEARANCE"
  --safe-area "$SAFE_AREA"
  --task-mode "$TASK_MODE"
  --category "$CATEGORY"
  --tags-json "$TAGS_JSON"
  --theme-id "$theme_id"
)
[ -n "$ACCENT" ] && theme_args+=(--accent "$ACCENT")
[ -n "$FOCUS_X" ] && theme_args+=(--focus-x "$FOCUS_X")
[ -n "$FOCUS_Y" ] && theme_args+=(--focus-y "$FOCUS_Y")
[ "$FRAMING_ENABLED" = "true" ] && theme_args+=(--position-x "${POSITION_X:-0}" --position-y "${POSITION_Y:-0}" --zoom "${ZOOM:-1}" --position-mode "$POSITION_MODE" --framing "true")
"$NODE" "$SCRIPT_DIR/write-theme.mjs" "${theme_args[@]}" >/dev/null
if [ -n "$ORIGINAL_IMAGE" ]; then
  "$NODE" -e 'const fs=require("node:fs");const p=process.argv[1],t=JSON.parse(fs.readFileSync(p,"utf8"));t.originalImage=process.argv[2];fs.writeFileSync(p,JSON.stringify(t,null,2)+"\n");' "$THEME_DIR/theme.json" "$ORIGINAL_IMAGE"
fi
/usr/bin/find "$THEME_DIR" -maxdepth 1 -type f -name 'background.*' ! -name "$image_name" -delete


lib_dir="$THEMES_ROOT/$theme_id"
[ ! -e "$lib_dir" ] && [ ! -L "$lib_dir" ] || fail "Theme id already exists: $theme_id"
/bin/mv "$THEME_DIR" "$lib_dir"
/bin/chmod 600 "$lib_dir/"* 2>/dev/null || true

dest_lib_img="$IMAGES_DIR/$(/usr/bin/basename "$IMAGE")"
src_dir="$(cd "$(dirname "$IMAGE")" && pwd -P)"
img_dir="$(cd "$IMAGES_DIR" && pwd -P)"
if [ "$src_dir/$(/usr/bin/basename "$IMAGE")" != "$img_dir/$(/usr/bin/basename "$IMAGE")" ]; then
  /bin/cp -f "$IMAGE" "$dest_lib_img" 2>/dev/null || true
fi

if [ "$APPLY_NOW" != "true" ]; then
  progress "$(dreamskin_text theme_ready_not_applied): ${THEME_NAME}"
  exit 0
fi

# The switcher owns active-directory publication, locking and restart prompts.
"$SCRIPT_DIR/switch-theme-macos.sh" --id "$theme_id"
