#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
VERSION="$(/usr/bin/tr -d '[:space:]' < "$ROOT/VERSION")"
DMG="$ROOT/release/CodexDreamSkin-v$VERSION.dmg"
TMP="$(/usr/bin/mktemp -d /tmp/dreamskin-dmg.XXXXXX)"
trap 'status=$?; /bin/rm -rf "$TMP"; exit "$status"' EXIT
# /tmp is a symlink on macOS; the resource assembler requires physical parents.
TMP="$(cd "$TMP" && pwd -P)"
/bin/mkdir -p "$ROOT/release" "$TMP/stage"
/bin/bash "$ROOT/scripts/build-app.sh" --output "$TMP/stage/Codex Dream Skin.app"
if [ -n "${DREAMSKIN_UPDATE_ARCHIVE:-}" ]; then
  /usr/bin/ditto -c -k --keepParent "$TMP/stage/Codex Dream Skin.app" "$DREAMSKIN_UPDATE_ARCHIVE"
fi
/bin/ln -s /Applications "$TMP/stage/Applications"
/usr/bin/hdiutil create -quiet -ov -format UDZO -volname "Codex Dream Skin" -srcfolder "$TMP/stage" "$DMG"
/usr/bin/shasum -a 256 "$DMG" > "$DMG.sha256"
/usr/bin/printf 'Created %s\n' "$DMG"
