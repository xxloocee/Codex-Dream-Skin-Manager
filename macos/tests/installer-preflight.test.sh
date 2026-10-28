#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

if [ "$(/usr/bin/uname -s)" != "Darwin" ]; then
  printf 'SKIP: installer preflight integration requires macOS.\n'
  exit 0
fi

TMP="$(/usr/bin/mktemp -d /tmp/dreamskin-installer-preflight.XXXXXX)"
DUMMY_PID=""
stop_dummy() {
  [ -n "$DUMMY_PID" ] || return 0
  /bin/kill "$DUMMY_PID" 2>/dev/null || true
  wait "$DUMMY_PID" 2>/dev/null || true
  DUMMY_PID=""
}
cleanup() {
  stop_dummy
  /bin/chmod -R u+w "$TMP" 2>/dev/null || true
  /bin/rm -rf "$TMP"
}
trap cleanup EXIT

TEST_HOME="$TMP/home"
FAKE_APP="$TMP/FakeChatGPT.app"
FAKE_EXE="$FAKE_APP/Contents/MacOS/ChatGPT"
FAKE_PLIST="$FAKE_APP/Contents/Info.plist"
LIVE_ENGINE="$TEST_HOME/.codex/codex-dream-skin-studio"
OUTPUT="$TMP/install-output.txt"
FIXTURE_SOURCE="$TMP/source"
FIXTURE_SCRIPTS="$FIXTURE_SOURCE/scripts"

/bin/mkdir -p "$FAKE_APP/Contents/MacOS" "$TEST_HOME/.codex" "$LIVE_ENGINE" "$FIXTURE_SCRIPTS"
# Keep the real environment guard; substitute only the account-home lookup.
/usr/bin/printf '%s\n' '#!/bin/bash' \
  '/usr/bin/printf "NFSHomeDirectory: %s\n" "$FIXTURE_ACCOUNT_HOME"' \
  > "$TMP/dscl-mock.sh"
/bin/chmod 700 "$TMP/dscl-mock.sh"
/usr/bin/sed "s|/usr/bin/dscl|$TMP/dscl-mock.sh|g" \
  "$ROOT/scripts/common-macos.sh" > "$FIXTURE_SCRIPTS/common-macos.sh"
/bin/cp "$ROOT/scripts/localization-macos.sh" "$ROOT/scripts/process-identity-macos.sh" "$ROOT/scripts/install-dream-skin-macos.sh" "$FIXTURE_SCRIPTS/"
/usr/bin/printf '%s\n' \
  '#include <signal.h>' \
  '#include <unistd.h>' \
  'static void stop(int signal_number) { (void)signal_number; _exit(0); }' \
  'int main(void) { signal(SIGTERM, stop); for (;;) pause(); }' \
  > "$TMP/fake-chatgpt.c"
if ! /usr/bin/xcrun clang -Os -o "$FAKE_EXE" "$TMP/fake-chatgpt.c" \
  2>"$TMP/clang-error.txt"; then
  /bin/cat "$TMP/clang-error.txt" >&2
  exit 1
fi
/usr/bin/plutil -create xml1 "$FAKE_PLIST"
/usr/bin/plutil -insert CFBundleIdentifier -string com.openai.codex "$FAKE_PLIST"
/usr/bin/plutil -insert CFBundleExecutable -string ChatGPT "$FAKE_PLIST"
/usr/bin/plutil -insert CFBundleShortVersionString -string 99.0.0 "$FAKE_PLIST"
/usr/bin/printf '%s\n' 'previous-engine' > "$LIVE_ENGINE/old-engine-marker"

# A closed app reaches the signed-runtime gate. That intentional failure
# must not emit an unbound-variable error or replace the previous engine.
if /usr/bin/env -u CODEX_EXE -u CODEX_BUNDLE -u CODEX_HOME -u CFFIXED_USER_HOME -u DREAMSKIN_PREVIEW \
  HOME="$TEST_HOME" FIXTURE_ACCOUNT_HOME="$TEST_HOME" CODEX_APP_BUNDLE="$FAKE_APP" \
  /bin/bash "$FIXTURE_SCRIPTS/install-dream-skin-macos.sh" --no-launch \
  >"$OUTPUT" 2>&1; then
  printf 'Unsigned fixture unexpectedly completed engine installation.\n' >&2
  exit 1
fi
if /usr/bin/grep -F -q 'unbound variable' "$OUTPUT"; then
  printf 'Outer installer used an app variable before discovery.\n' >&2
  exit 1
fi
/usr/bin/grep -F -q 'The ChatGPT app signature is not valid.' "$OUTPUT"
[ -f "$LIVE_ENGINE/old-engine-marker" ]
[ ! -f "$LIVE_ENGINE/VERSION" ]
[ -z "$(/usr/bin/find "$TEST_HOME/.codex" -maxdepth 1 \
  \( -name 'codex-dream-skin-studio.installing.*' \
  -o -name 'codex-dream-skin-studio.previous.*' \
  -o -name 'codex-dream-skin-studio.broken.*' \) -print -quit)" ]

# A process whose command and executable both match the discovered app must be
# rejected before deploy_project can move or copy any engine bytes.
"$FAKE_EXE" 120 &
DUMMY_PID="$!"
for _ in 1 2 3 4 5; do
  /usr/sbin/lsof -a -p "$DUMMY_PID" -d txt -Fn 2>/dev/null \
    | /usr/bin/grep -F -q "n$FAKE_EXE" && break
  /bin/sleep 0.1
done
/bin/kill -0 "$DUMMY_PID"
/bin/chmod 500 "$TEST_HOME/.codex"
if /usr/bin/env -u CODEX_EXE -u CODEX_BUNDLE -u CODEX_HOME -u CFFIXED_USER_HOME -u DREAMSKIN_PREVIEW \
  HOME="$TEST_HOME" FIXTURE_ACCOUNT_HOME="$TEST_HOME" CODEX_APP_BUNDLE="$FAKE_APP" \
  /bin/bash "$FIXTURE_SCRIPTS/install-dream-skin-macos.sh" --no-launch \
  >"$OUTPUT" 2>&1; then
  printf 'Installer continued while the discovered app executable was running.\n' >&2
  exit 1
fi
/bin/chmod 700 "$TEST_HOME/.codex"
stop_dummy
/usr/bin/grep -F -q 'Close Codex before installation' "$OUTPUT"
[ -f "$LIVE_ENGINE/old-engine-marker" ]
[ ! -f "$LIVE_ENGINE/VERSION" ]
[ -z "$(/usr/bin/find "$TEST_HOME/.codex" -maxdepth 1 \
  \( -name 'codex-dream-skin-studio.installing.*' \
  -o -name 'codex-dream-skin-studio.previous.*' \
  -o -name 'codex-dream-skin-studio.broken.*' \) -print -quit)" ]

printf 'PASS: macOS outer installer discovers the app before guarding and preserves the engine on preflight failure.\n'
