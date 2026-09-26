// Build-time conversion of the Windows source catalog into macOS preset packs.
// The public release excludes the Arina reference artwork, as documented in NOTICE.md.
import fs from 'node:fs/promises';
import path from 'node:path';

const [catalogPath, outputRoot] = process.argv.slice(2);
if (!catalogPath || !outputRoot) throw Error('Usage: prepare-gui-presets.mjs <catalog.json> <output presets directory>');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.themes) || catalog.themes.length !== 36) {
  throw Error('Windows preset catalog has an unexpected format or count.');
}
const sourceRoot = path.dirname(catalogPath);
const excluded = new Set(['arina-hashimoto']);
const seen = new Set();
let added = 0;
for (const entry of catalog.themes) {
  const {id, image, name, category, tags, appearance, focusX, focusY, safeArea, taskMode, accent} = entry;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || seen.has(id)) throw Error('Invalid or duplicate catalog ID.');
  seen.add(id);
  if (excluded.has(id)) continue;
  if (typeof image !== 'string' || image !== path.basename(image) || !/\.(jpe?g|png|apng|webp|gif|mp4)$/i.test(image)) throw Error(`Invalid media name: ${id}`);
  if (typeof name !== 'string' || !name.trim() || !Array.isArray(tags) || !Number.isFinite(focusX) || !Number.isFinite(focusY) || focusX < 0 || focusX > 1 || focusY < 0 || focusY > 1) throw Error(`Invalid theme metadata: ${id}`);
  const source = path.join(sourceRoot, image);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size < 1 || sourceStat.size > 128 * 1024 * 1024) throw Error(`Invalid theme media: ${id}`);
  const directory = path.join(outputRoot, `preset-${id}`);
  // The two video packs already carry reviewed macOS-specific metadata.
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error(`Unsafe preset directory: ${id}`);
    if (id !== 'ink-feather-glow' && id !== 'silver-glass-dream') throw Error(`Unexpected existing preset: ${id}`);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!['dream', 'nature', 'cyber', 'minimal', 'dark', 'warm'].includes(category) || appearance !== 'auto' || !['auto', 'left', 'right', 'center', 'none'].includes(safeArea) || !['auto', 'ambient', 'banner', 'full', 'off'].includes(taskMode) || (accent && !/^#[0-9a-f]{6}$/i.test(accent))) throw Error(`Invalid theme options: ${id}`);
  const theme = {schemaVersion: 1, id: `preset-${id}`, name, image, category, tags, appearance,
    art: {focusX, focusY, safeArea, taskMode}, ...(accent ? {colors: {accent: accent.toUpperCase()}} : {})};
  await fs.mkdir(directory, {recursive: false});
  await fs.copyFile(source, path.join(directory, image));
  await fs.writeFile(path.join(directory, 'theme.json'), `${JSON.stringify(theme, null, 2)}\n`);
  added++;
}
if (seen.size !== 36 || added !== 33) throw Error(`Unexpected GUI preset count: ${seen.size} catalog entries, ${added} generated`);
console.log(`Added ${added} Windows catalog presets; retained two video packs and the Gothic default; excluded Arina reference artwork.`);
