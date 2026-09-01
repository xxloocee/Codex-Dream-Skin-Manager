import fs from "node:fs/promises";
import path from "node:path";

const [stateRoot] = process.argv.slice(2);
if (!stateRoot) throw new Error("Usage: list-manager-themes-macos.mjs <state-root>");
const themesRoot = path.resolve(stateRoot, "themes");
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function text(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return Array.from(value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, " ").trim()).slice(0, 120).join("") || fallback;
}

function number(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

function choice(value, fallback, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

async function readTheme(directory, order) {
  const id = path.basename(directory);
  if (!idPattern.test(id)) return null;
  const directoryStat = await fs.lstat(directory).catch(() => null);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) return null;
  const configPath = path.join(directory, "theme.json");
  const configStat = await fs.lstat(configPath).catch(() => null);
  if (!configStat?.isFile() || configStat.isSymbolicLink() || configStat.size < 1 || configStat.size > 1024 * 1024) return null;
  let theme;
  try { theme = JSON.parse(await fs.readFile(configPath, "utf8")); } catch { return null; }
  if (!theme || typeof theme !== "object" || theme.schemaVersion !== 1 || theme.id !== id || typeof theme.image !== "string") return null;
  const image = path.basename(theme.image);
  if (image !== theme.image || !image) return null;
  const imagePath = path.join(directory, image);
  const imageStat = await fs.lstat(imagePath).catch(() => null);
  if (!imageStat?.isFile() || imageStat.isSymbolicLink() || imageStat.size < 1) return null;
  const art = theme.art && typeof theme.art === "object" && !Array.isArray(theme.art) ? theme.art : {};
  const isPreset = id.startsWith("preset-");
  const tags = Array.isArray(theme.tags) ? theme.tags.map((value) => text(value)).filter(Boolean).slice(0, 20) : [];
  return {
    id,
    name: text(theme.name, id),
    imagePath,
    themeDirectory: directory,
    isPreset,
    category: text(theme.category, isPreset ? "uncategorized" : "custom"),
    tags,
    source: isPreset ? "preset" : "saved",
    order,
    addedAt: directoryStat.birthtime.toISOString(),
    appearance: choice(theme.appearance, "auto", ["auto", "light", "dark"]),
    focusX: number(art.focusX, 0.5, 0, 1),
    focusY: number(art.focusY, 0.5, 0, 1),
    positionX: number(art.positionX, 0, -1, 1),
    positionY: number(art.positionY, 0, -1, 1),
    zoom: number(art.zoom, 1, 1, 2),
    positionMode: choice(art.positionMode, "locked", ["locked", "free"]),
    framingEnabled: art.framingEnabled === true,
    safeArea: choice(art.safeArea, "auto", ["auto", "left", "right", "center", "none"]),
    taskMode: choice(art.taskMode, "auto", ["auto", "ambient", "banner", "full", "off"]),
    accent: typeof theme.colors?.accent === "string" && /^#[0-9a-f]{6}$/i.test(theme.colors.accent) ? theme.colors.accent : "",
  };
}

const entries = await fs.readdir(themesRoot, { withFileTypes: true }).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
const directories = entries
  .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && idPattern.test(entry.name))
  .map((entry) => path.join(themesRoot, entry.name))
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
const themes = (await Promise.all(directories.map((directory, index) => readTheme(directory, index)))).filter(Boolean);
console.log(JSON.stringify(themes));
