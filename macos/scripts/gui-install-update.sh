#!/bin/bash
# Runs outside the app bundle so replacing the old bundle cannot remove us.
set -euo pipefail
STAGED="$1"
TARGET="$2"
OLD_PID="$3"
EXPECTED_VERSION="$4"
RESULT="$5"
EXPECTED_BUNDLE="$6"
case "$OLD_PID" in ''|*[!0-9]*) exit 2 ;; esac
[ -d "$STAGED" ] && [ ! -L "$STAGED" ] && [ ! -L "$TARGET" ] || exit 2
case "$TARGET" in *.app) ;; *) exit 2 ;; esac
HAD_TARGET="false"
if [ -e "$TARGET" ]; then
  [ -d "$TARGET" ] || exit 2
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET/Contents/Info.plist")" = "$EXPECTED_BUNDLE" ] || exit 2
  HAD_TARGET="true"
fi
PARENT="$(dirname "$TARGET")"
[ -w "$PARENT" ] || exit 2
TEMP_APP="$(mktemp -d "$PARENT/.dreamskin-update.XXXXXX")"
BACKUP="$PARENT/.dreamskin-previous-$(date +%Y%m%d%H%M%S)-$$.app"
cleanup() { rm -rf "$TEMP_APP"; }
finish() {
  local code=$?
  if [ "$code" -ne 0 ] && [ ! -e "$TARGET" ] && [ -d "$BACKUP" ]; then /bin/mv "$BACKUP" "$TARGET" || true; fi
  if [ "$code" -ne 0 ]; then write_result failed "自动更新失败（退出码 ${code}），请查看安装日志；主题数据未改动。" || true; fi
  cleanup
  exit "$code"
}
trap finish EXIT
write_result() {
  /usr/bin/plutil -create xml1 "$RESULT.tmp"
  /usr/bin/plutil -insert status -string "$1" "$RESULT.tmp"
  /usr/bin/plutil -insert message -string "$2" "$RESULT.tmp"
  /bin/mv -f "$RESULT.tmp" "$RESULT"
}
/usr/bin/ditto "$STAGED" "$TEMP_APP/Codex Dream Skin.app"
CANDIDATE="$TEMP_APP/Codex Dream Skin.app"
/usr/bin/codesign --verify --deep --strict "$CANDIDATE"
[ "$(/usr/libexec/PlistBuddy -c 'Print :DreamSkinGUIVersion' "$CANDIDATE/Contents/Info.plist")" = "$EXPECTED_VERSION" ] || exit 3
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CANDIDATE/Contents/Info.plist")" = "$EXPECTED_BUNDLE" ] || exit 3
# Never kill the manager or Codex. The manager exits through its normal busy guard.
for ((i=0;i<120;i++)); do
  if ! /bin/kill -0 "$OLD_PID" 2>/dev/null; then break; fi
  /bin/sleep 1
done
if /bin/kill -0 "$OLD_PID" 2>/dev/null; then
  write_result failed '管理器仍在运行，已取消安装。'
  exit 4
fi
if [ "$HAD_TARGET" = "true" ]; then /bin/mv "$TARGET" "$BACKUP"; fi
if ! /bin/mv "$CANDIDATE" "$TARGET"; then
  [ "$HAD_TARGET" != "true" ] || /bin/mv "$BACKUP" "$TARGET"
  write_result failed '安装失败，原应用保持可用。'
  [ "$HAD_TARGET" != "true" ] || /usr/bin/open "$TARGET"
  exit 5
fi
if [ "$HAD_TARGET" = "true" ]; then
  write_result installed "已安装 ${EXPECTED_VERSION}。旧版备份：${BACKUP}"
else
  write_result installed "已安装 ${EXPECTED_VERSION}，位置：${TARGET}"
fi
if ! /usr/bin/open "$TARGET"; then
  /bin/mv "$TARGET" "$TEMP_APP/failed.app"
  [ "$HAD_TARGET" != "true" ] || /bin/mv "$BACKUP" "$TARGET"
  write_result failed '新版无法启动，已撤销安装，原应用保持可用。'
  [ "$HAD_TARGET" != "true" ] || /usr/bin/open "$TARGET"
  exit 6
fi
# Keep the previous signed bundle for manual rollback; never touch the theme library.
