#!/bin/bash
# Build the shared manager directly from source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
OUTPUT="${1:-$ROOT/build/macos/Codex Dream Skin.app}"
case "$OUTPUT" in /*.app) ;; *) printf 'Output must be an absolute .app path.\n' >&2; exit 2 ;; esac
[ ! -e "$OUTPUT" ] && [ ! -L "$OUTPUT" ] || { printf 'Output already exists; choose a new output path.\n' >&2; exit 2; }
cd "$ROOT"
npm run build:core
npm run build:ui
SCRATCH="$(/usr/bin/mktemp -d /tmp/dreamskin-build.XXXXXX)"
trap '/bin/rm -rf "$SCRATCH"' EXIT
CONTENTS="$OUTPUT/Contents"
RESOURCES="$CONTENTS/Resources"
ENGINE="$RESOURCES/macos"
read -r -a ARCHS <<< "${DREAMSKIN_ARCHS:-arm64 x86_64}"
BINARIES=()
for arch in "${ARCHS[@]}"; do
  case "$arch" in arm64|x86_64) ;; *) printf 'Unsupported architecture: %s\n' "$arch" >&2; exit 2 ;; esac
  /usr/bin/swift build --package-path "$ROOT/hosts/macos" --scratch-path "$SCRATCH/$arch" \
    --configuration release --triple "$arch-apple-macosx13.0" --product DreamSkinSharedHost
  binary_dir="$(/usr/bin/swift build --package-path "$ROOT/hosts/macos" --scratch-path "$SCRATCH/$arch" \
    --configuration release --triple "$arch-apple-macosx13.0" --show-bin-path)"
  BINARIES+=("$binary_dir/DreamSkinSharedHost")
done
/bin/mkdir -p "$CONTENTS/MacOS" "$RESOURCES/ui" "$RESOURCES/runtime/node" "$ENGINE/assets" "$ENGINE/presets" "$RESOURCES/THIRD_PARTY/Node.js"
if [ "${#BINARIES[@]}" -eq 1 ]; then
  /bin/cp "${BINARIES[0]}" "$CONTENTS/MacOS/DreamSkinSharedHost"
else
  /usr/bin/lipo -create "${BINARIES[@]}" -output "$CONTENTS/MacOS/DreamSkinSharedHost"
fi
/usr/bin/ditto "$ROOT/build/shared" "$RESOURCES/shared"
/usr/bin/ditto "$ROOT/build/ui/manager" "$RESOURCES/ui/manager"
/usr/bin/ditto "$ROOT/macos/assets" "$ENGINE/assets"
for preset in gothic-void-crusade ink-feather-glow silver-glass-dream tyndall-rays hokuriku-road cold-elegance summer-forest; do
  /usr/bin/ditto "$ROOT/macos/presets/preset-$preset" "$ENGINE/presets/preset-$preset"
done
# Personal video presets share the Windows source packs and their full parameters.
for preset in neon-azure-dream sunlit-breeze-walk starlit-guardian ink-shadow-snow-eyes cloud-whisper-window crimson-feather-dusk moonlit-tidal-blade starlit-embers prismatic-star-eyes; do
  /usr/bin/ditto "$ROOT/windows/presets/preset-$preset" "$ENGINE/presets/preset-$preset"
done
/bin/bash "$ROOT/macos/scripts/prepare-node-runtime.sh" "$ENGINE/runtime/node"
NODE="$ENGINE/runtime/node/bin/node"
"$NODE" "$ROOT/macos/scripts/prepare-gui-presets.mjs" "$ROOT/windows/presets/catalog.json" "$ENGINE/presets"
/bin/cp "$NODE" "$RESOURCES/runtime/node/node"
/bin/cp "$ENGINE/runtime/node/LICENSE" "$RESOURCES/runtime/node/LICENSE"
/bin/cp "$ENGINE/runtime/node/LICENSE" "$RESOURCES/THIRD_PARTY/Node.js/LICENSE"
/bin/cp "$ROOT/windows/presets/catalog.json" "$RESOURCES/manager-catalog.json"
/bin/cp "$ROOT/LICENSE" "$RESOURCES/LICENSE"
/bin/cp "$ROOT/THIRD_PARTY_NOTICES.md" "$RESOURCES/THIRD_PARTY_NOTICES.md"
/bin/cp "$ROOT/macos/LICENSE" "$RESOURCES/LICENSE.txt"
/bin/cp "$ROOT/macos/NOTICE.md" "$RESOURCES/NOTICE.md"
for dependency in react react-dom scheduler; do
  /bin/cp "$ROOT/node_modules/$dependency/LICENSE" "$RESOURCES/THIRD_PARTY/$dependency-LICENSE.txt"
done
"$NODE" "$ROOT/tools/stage-shared-resources.mjs" --stage macos "$RESOURCES"
VERSION="$(/usr/bin/tr -d '[:space:]' < "$ROOT/macos/VERSION")"
/usr/bin/sed "s/__VERSION__/$VERSION/g" "$ROOT/hosts/macos/Info.plist" > "$CONTENTS/Info.plist"
GUI_VERSION_PATH="$ROOT/macos/GUI_VERSION"
if [ "${DREAMSKIN_UPDATE_TAG_PREFIX:-gui-v}" = v ]; then GUI_VERSION_PATH="$ROOT/macos/VERSION"; fi
GUI_VERSION="$(/usr/bin/tr -d '[:space:]' < "$GUI_VERSION_PATH")"
/usr/libexec/PlistBuddy -c "Add :DreamSkinGUIVersion string $GUI_VERSION" "$CONTENTS/Info.plist"
"$NODE" "$ROOT/macos/scripts/configure-gui-updater.mjs" "$ENGINE" "$GUI_VERSION_PATH"
/bin/bash "$ROOT/macos/scripts/generate-app-icon.sh" "$RESOURCES/DreamSkin.icns"
/bin/chmod 755 "$CONTENTS/MacOS/DreamSkinSharedHost" "$RESOURCES/runtime/node/node"
/usr/bin/codesign --force --deep --sign - --timestamp=none "$OUTPUT"
/usr/bin/printf 'Created manager app: %s\n' "$OUTPUT"
