#!/bin/bash
# Build the native GUI using a matching installed release for bundled resources.
# Does not launch the app, run tests, or modify the installed application.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
BASE="${1:-/Applications/Codex Dream Skin.app}"
OUTPUT="${2:-$ROOT/release/Codex Dream Skin.app}"
[ -d "$BASE/Contents/Resources/engine" ] || { echo 'A complete installed Dream Skin app is required.' >&2; exit 1; }
[ ! -e "$OUTPUT" ] || { echo 'Output already exists; choose a new output path.' >&2; exit 1; }
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
BASE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BASE/Contents/Info.plist")"
[ "$BASE_VERSION" = "$VERSION" ] || { echo 'Base app version must match macos/VERSION.' >&2; exit 1; }
TEMP_BUILD="$(mktemp -d /tmp/dreamskin-gui.XXXXXX)"
trap 'rm -rf "$TEMP_BUILD"' EXIT
SDK="$(xcrun --show-sdk-path)"
ARCH="$(uname -m)"
FLAGS=(-O -sdk "$SDK" -target "$ARCH-apple-macosx13.0")
# Some CLT upgrades leave both SwiftBridging module maps installed. Hide only
# the obsolete duplicate in this compiler invocation, never in the system.
SWIFT_INCLUDE="$(xcode-select -p)/usr/include/swift"
if [ -f "$SWIFT_INCLUDE/module.modulemap" ] && [ -f "$SWIFT_INCLUDE/bridging.modulemap" ] && grep -q '^module SwiftBridging {' "$SWIFT_INCLUDE/module.modulemap" && grep -q '^module SwiftBridging {' "$SWIFT_INCLUDE/bridging.modulemap"; then
  : > "$TEMP_BUILD/empty.modulemap"
  "$BASE/Contents/Resources/engine/runtime/node/bin/node" - "$SWIFT_INCLUDE/module.modulemap" "$TEMP_BUILD" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [moduleMap, output] = process.argv.slice(2);
fs.writeFileSync(path.join(output, 'overlay.json'), JSON.stringify({version: 0, roots: [
  {type: 'file', name: moduleMap, 'external-contents': path.join(output, 'empty.modulemap')},
]}));
NODE
  FLAGS+=(-vfsoverlay "$TEMP_BUILD/overlay.json")
fi
SOURCES="$ROOT/menubar-app/Sources"
xcrun swiftc "${FLAGS[@]}" -parse-as-library -emit-module -emit-library -static -module-name DreamSkinCore "$SOURCES"/DreamSkinCore/*.swift -emit-module-path "$TEMP_BUILD/DreamSkinCore.swiftmodule" -o "$TEMP_BUILD/libDreamSkinCore.a"
xcrun swiftc "${FLAGS[@]}" -I "$TEMP_BUILD" -L "$TEMP_BUILD" -lDreamSkinCore "$SOURCES"/CodexDreamSkinMenuBar/*.swift -o "$TEMP_BUILD/CodexDreamSkinMenuBar"
APP="$TEMP_BUILD/Codex Dream Skin.app"
ditto "$BASE" "$APP"
cp "$ROOT/../windows/presets/catalog.json" "$APP/Contents/Resources/manager-catalog.json"
# Ship source helper updates alongside the matching release's runtime assets.
cp "$ROOT/scripts/"*.mjs "$APP/Contents/Resources/engine/scripts/"
cp "$ROOT/scripts/"*.sh "$APP/Contents/Resources/engine/scripts/"
chmod 755 "$APP/Contents/Resources/engine/scripts/"*.sh
"$APP/Contents/Resources/engine/runtime/node/bin/node" "$ROOT/scripts/prepare-gui-presets.mjs" "$ROOT/../windows/presets/catalog.json" "$APP/Contents/Resources/engine/presets"
cp "$TEMP_BUILD/CodexDreamSkinMenuBar" "$APP/Contents/MacOS/CodexDreamSkinMenuBar"
sed "s/__VERSION__/$VERSION/g" "$ROOT/menubar-app/Resources/Info.plist.template" > "$APP/Contents/Info.plist"
GUI_VERSION="$(tr -d '[:space:]' < "$ROOT/GUI_VERSION")"
/usr/libexec/PlistBuddy -c "Add :DreamSkinGUIVersion string $GUI_VERSION" "$APP/Contents/Info.plist"
"$APP/Contents/Resources/engine/runtime/node/bin/node" "$ROOT/scripts/configure-gui-updater.mjs" "$APP/Contents/Resources/engine" "$ROOT/GUI_VERSION"
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"
mkdir -p "$(dirname "$OUTPUT")"
ditto "$APP" "$OUTPUT"
printf 'Created: %s\n' "$OUTPUT"
