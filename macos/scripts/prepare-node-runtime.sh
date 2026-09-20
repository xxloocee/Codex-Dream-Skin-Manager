#!/bin/bash

# Build-time only. Users receive this runtime in the app/ZIP and never download
# or install Node themselves. Match a single-arch app when explicitly requested.
set -euo pipefail
export LC_ALL=C
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE_VERSION="22.22.2"
# Pinned from https://nodejs.org/dist/v22.22.2/SHASUMS256.txt.
ARM64_SHA256="db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000"
X64_SHA256="12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba"
OUTPUT="${1:-$ROOT/runtime/node}"
[ "$#" -le 1 ] && [ -n "$OUTPUT" ] \
  || { printf 'Usage: prepare-node-runtime.sh [new runtime/node directory]\n' >&2; exit 2; }
[ "$(/usr/bin/uname -s)" = Darwin ] \
  || { printf 'The bundled Node runtime must be prepared on macOS.\n' >&2; exit 1; }
[ ! -e "$OUTPUT" ] && [ ! -L "$OUTPUT" ] \
  || { printf 'Node runtime output already exists: %s\n' "$OUTPUT" >&2; exit 1; }

TMP="$(/usr/bin/mktemp -d /tmp/codex-dream-node.XXXXXX)"
trap 'status=$?; /bin/rm -rf "$TMP"; exit "$status"' EXIT
for arch in arm64 x64; do
  distribution="node-v$NODE_VERSION-darwin-$arch"
  archive="$TMP/$distribution.tar.gz"
  case "$arch" in arm64) expected="$ARM64_SHA256" ;; x64) expected="$X64_SHA256" ;; esac
  /usr/bin/curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' \
    --output "$archive" "https://nodejs.org/dist/v$NODE_VERSION/$distribution.tar.gz"
  actual="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')"
  [ "$actual" = "$expected" ] \
    || { printf 'Node %s archive checksum mismatch.\n' "$arch" >&2; exit 1; }
  /usr/bin/tar -xzf "$archive" -C "$TMP" "$distribution/bin/node" "$distribution/LICENSE"
done

/bin/mkdir -p "$TMP/runtime/bin"
/usr/bin/lipo -create \
  "$TMP/node-v$NODE_VERSION-darwin-arm64/bin/node" \
  "$TMP/node-v$NODE_VERSION-darwin-x64/bin/node" \
  -output "$TMP/runtime/bin/node"
/usr/bin/lipo "$TMP/runtime/bin/node" -verify_arch arm64 x86_64
case "${DREAMSKIN_ARCHS:-arm64 x86_64}" in
  arm64|x86_64)
    /usr/bin/lipo "$TMP/runtime/bin/node" -thin "$DREAMSKIN_ARCHS" -output "$TMP/runtime/bin/node-thin"
    /bin/mv "$TMP/runtime/bin/node-thin" "$TMP/runtime/bin/node"
    ;;
esac
/bin/chmod 755 "$TMP/runtime/bin/node"
/bin/cp "$TMP/node-v$NODE_VERSION-darwin-arm64/LICENSE" "$TMP/runtime/LICENSE"
/usr/bin/printf '%s\n' "$NODE_VERSION" > "$TMP/runtime/VERSION"
/bin/chmod 644 "$TMP/runtime/LICENSE" "$TMP/runtime/VERSION"
# lipo changes the executable: sign the combined binary before the outer app.
/usr/bin/codesign --force --sign - --timestamp=none "$TMP/runtime/bin/node"
/usr/bin/codesign --verify --strict "$TMP/runtime/bin/node"
# Exercise the native slice before shipping; this needs no installed Codex.
"$TMP/runtime/bin/node" -e '
  if (process.versions.node !== process.argv[1] || typeof WebSocket !== "function" || typeof fetch !== "function") process.exit(1);
' "$NODE_VERSION"
/bin/mkdir -p "$(dirname "$OUTPUT")"
/usr/bin/ditto "$TMP/runtime" "$OUTPUT"
/usr/bin/printf 'Bundled Node.js %s (%s): %s\n' "$NODE_VERSION" "${DREAMSKIN_ARCHS:-arm64 x86_64}" "$OUTPUT"
