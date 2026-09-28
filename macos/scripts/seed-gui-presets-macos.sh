#!/bin/bash
# Import missing presets from the bundled GUI, including an upgraded video
# variant when the library still contains the original Silver Glass preset.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
ensure_state_root
NODE="$PROJECT_ROOT/runtime/node/bin/node"
[ -f "$NODE" ] && [ -x "$NODE" ] && [ ! -L "$NODE" ] || fail "Bundled Node.js is missing."
/usr/bin/codesign --verify --strict "$NODE" >/dev/null 2>&1 || fail "Bundled Node.js signature is invalid."
seed_bundled_presets
"$NODE" - "$PROJECT_ROOT/presets/preset-silver-glass-dream" "$STATE_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const [source, stateRoot] = process.argv.slice(2);
const themesRoot = path.join(stateRoot, 'themes');
const oldPreset = path.join(themesRoot, 'preset-silver-glass-dream');
const upgradedID = 'preset-silver-glass-dream-4k';
const upgradedPreset = path.join(themesRoot, upgradedID);
const deletedMarker = path.join(stateRoot, 'deleted-presets', upgradedID);
const oldDeletedMarker = path.join(stateRoot, 'deleted-presets', 'preset-silver-glass-dream');

const exists = (file) => {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const regular = (file) => {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// A fresh install already has the bundled 4K preset under the original ID.
// Existing libraries may contain any older or customized version, so compare
// with the current bundle instead of requiring one exact historical hash.
// Never replace saved content or restore a theme the user deleted.
const sourceTheme = path.join(source, 'theme.json');
const sourceVideo = path.join(source, 'background.mp4');
const oldIsCurrent = () => exists(oldPreset) && !fs.lstatSync(oldPreset).isSymbolicLink() &&
  regular(path.join(oldPreset, 'theme.json')) && regular(path.join(oldPreset, 'background.mp4')) &&
  digest(path.join(oldPreset, 'theme.json')) === digest(sourceTheme) &&
  digest(path.join(oldPreset, 'background.mp4')) === digest(sourceVideo);
if (!exists(upgradedPreset) && !exists(deletedMarker) && !exists(oldDeletedMarker) &&
    regular(sourceTheme) && regular(sourceVideo) && !oldIsCurrent()) {
  const stage = fs.mkdtempSync(path.join(stateRoot, '.preset-seed.'));
  try {
    const theme = JSON.parse(fs.readFileSync(path.join(source, 'theme.json'), 'utf8'));
    if (theme.id !== 'preset-silver-glass-dream' || theme.image !== 'background.mp4') {
      throw Error('Bundled Silver Glass preset metadata is invalid.');
    }
    theme.id = upgradedID;
    fs.writeFileSync(path.join(stage, 'theme.json'), JSON.stringify(theme, null, 2) + '\n', {mode: 0o600});
    fs.copyFileSync(path.join(source, 'background.mp4'), path.join(stage, 'background.mp4'), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(stage, 'background.mp4'), 0o600);
    if (!exists(upgradedPreset) && !exists(deletedMarker)) {
      try { fs.renameSync(stage, upgradedPreset); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    }
  } finally {
    if (exists(stage)) fs.rmSync(stage, {recursive: true});
  }
}
NODE
