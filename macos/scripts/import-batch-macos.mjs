import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const [requestPath, scriptPath] = process.argv.slice(2);
if (!requestPath || !scriptPath) throw new Error("Usage: import-batch-macos.mjs <request.json> <load-image-script>");
const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
if (!request || request.schemaVersion !== 1 || !Array.isArray(request.items) || request.items.length < 1 || request.items.length > 50) {
  throw new Error("批量导入请求必须使用 schemaVersion 1，且包含 1 到 50 项。");
}

const stateRoot = path.join(process.env.HOME, "Library/Application Support/CodexDreamSkinStudio");
const themesRoot = path.join(stateRoot, "themes");
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
await fs.mkdir(themesRoot, { recursive: true, mode: 0o700 });

const regularFile = async (file) => {
  const stat = await fs.lstat(file).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink();
};

function number(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

function framingEnabled(theme) {
  const art = theme?.art && typeof theme.art === "object" ? theme.art : {};
  return ["positionX", "positionY", "zoom", "positionMode"].some((key) => Object.hasOwn(art, key));
}

function itemFramingEnabled(item) {
  const framingKeys = ["positionX", "positionY", "zoom", "positionMode"];
  const hasFramingFields = framingKeys.some((key) => Object.hasOwn(item, key));
  if (Object.hasOwn(item, "framingEnabled")) {
    if (typeof item.framingEnabled !== "boolean") throw new Error("构图开关必须是布尔值。");
    return item.framingEnabled;
  }
  return hasFramingFields;
}

function managerFingerprint(theme, imageBytes) {
  const art = theme?.art && typeof theme.art === "object" ? theme.art : {};
  const accent = theme?.colors?.accent || theme?.palette?.accent || "";
  const imageHash = crypto.createHash("sha256").update(imageBytes).digest("hex").toUpperCase();
  const normalized = {
    imageHash,
    framingEnabled: framingEnabled(theme),
    appearance: ["auto", "light", "dark"].includes(theme?.appearance) ? theme.appearance : "auto",
    focusX: number(art.focusX, 0.5, 0, 1), focusY: number(art.focusY, 0.5, 0, 1),
    positionX: number(art.positionX, 0, -1, 1), positionY: number(art.positionY, 0, -1, 1),
    zoom: number(art.zoom, 1, 1, 2), positionMode: ["locked", "free"].includes(art.positionMode) ? art.positionMode : "locked",
    safeArea: ["auto", "left", "right", "center", "none"].includes(art.safeArea) ? art.safeArea : "auto",
    taskMode: ["auto", "ambient", "banner", "full", "off"].includes(art.taskMode) ? art.taskMode : "auto",
    accent: typeof accent === "string" ? accent.toUpperCase() : "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function readSavedFingerprints() {
  const known = new Map();
  const entries = await fs.readdir(themesRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !idPattern.test(entry.name)) continue;
    const directory = path.join(themesRoot, entry.name);
    const configPath = path.join(directory, "theme.json");
    if (!(await regularFile(configPath))) continue;
    try {
      const theme = JSON.parse(await fs.readFile(configPath, "utf8"));
      const imageName = path.basename(theme.image || "");
      if (!theme || theme.id !== entry.name || !imageName || imageName !== theme.image) continue;
      const imagePath = path.join(directory, imageName);
      if (!(await regularFile(imagePath))) continue;
      const stored = theme.managerFingerprintVersion === 2 && typeof theme.managerFingerprint === "string" ? theme.managerFingerprint : managerFingerprint(theme, await fs.readFile(imagePath));
      known.set(stored, directory);
    } catch { /* ignore malformed saved themes */ }
  }
  return known;
}

function run(args) {
  return new Promise((resolve) => {
    // Node cannot execute a .cmd/.bat file directly on Windows.  The batch
    // manager itself runs on macOS, but using cmd.exe here keeps the contract
    // testable from Windows without enabling shell parsing for normal scripts.
    const isWindowsBatch = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(scriptPath);
    const command = isWindowsBatch ? (process.env.ComSpec || "cmd.exe") : scriptPath;
    const commandArgs = isWindowsBatch ? ["/d", "/s", "/c", scriptPath, ...args] : args;
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
    child.on("error", (error) => resolve({ code: 1, stderr: error.message }));
  });
}

const known = await readSavedFingerprints();
const usedIds = new Set(await fs.readdir(themesRoot));
const results = [];
for (const item of request.items) {
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  try {
    if (!item || typeof item.imagePath !== "string" || !item.imagePath) throw new Error("缺少图片路径。");
    const imagePath = path.resolve(item.imagePath);
    if (!(await regularFile(imagePath))) throw new Error("图片必须是普通文件。");
    const imageBytes = await fs.readFile(imagePath);
    const id = (() => { let value; do value = `img-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`; while (usedIds.has(value)); usedIds.add(value); return value; })();
    const candidateTheme = {
      appearance: item.appearance || "auto",
      category: item.category || "custom",
      tags: Array.isArray(item.tags) ? item.tags : [],
      art: { focusX: item.focusX ?? 0.5, focusY: item.focusY ?? 0.5, safeArea: item.safeArea || "auto", taskMode: item.taskMode || "auto" },
    };
    if (itemFramingEnabled(item)) Object.assign(candidateTheme.art, { positionX: item.positionX ?? 0, positionY: item.positionY ?? 0, zoom: item.zoom ?? 1, positionMode: item.positionMode || "locked" });
    if (item.accent) candidateTheme.colors = { accent: String(item.accent) };
    const fingerprint = managerFingerprint(candidateTheme, imageBytes);
    if (known.has(fingerprint)) { results.push({ name, status: "skipped", message: "相同图片和主题参数已存在。", themeDirectory: known.get(fingerprint) }); continue; }
    const args = ["--file", imagePath, "--name", name || "Codex Dream Skin", "--appearance", candidateTheme.appearance, "--safe-area", candidateTheme.art.safeArea, "--task-mode", candidateTheme.art.taskMode, "--category", candidateTheme.category, "--tags-json", JSON.stringify(candidateTheme.tags), "--theme-id", id, "--focus-x", String(candidateTheme.art.focusX), "--focus-y", String(candidateTheme.art.focusY), "--no-apply"];
    if (item.accent) args.push("--accent", String(item.accent));
    if (Object.hasOwn(candidateTheme.art, "positionX")) args.push("--position-x", String(candidateTheme.art.positionX), "--position-y", String(candidateTheme.art.positionY), "--zoom", String(candidateTheme.art.zoom), "--position-mode", candidateTheme.art.positionMode, "--framing", "true");
    const result = await run(args);
    if (result.code !== 0) throw new Error(result.stderr || "图片导入失败。");
    const themeDirectory = path.join(themesRoot, id);
    const themePath = path.join(themeDirectory, "theme.json");
    if (!(await regularFile(themePath))) throw new Error("导入未生成有效主题。");
    const theme = JSON.parse(await fs.readFile(themePath, "utf8"));
    const finalFingerprint = managerFingerprint(theme, await fs.readFile(path.join(themeDirectory, theme.image)));
    const next = { ...theme, managerFingerprintVersion: 2, managerFingerprint: finalFingerprint };
    await fs.writeFile(themePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    // Keep both fingerprints: the persisted one describes the packaged image,
    // while the candidate fingerprint also deduplicates repeated source items
    // whose loader may transcode or otherwise normalize image bytes.
    known.set(fingerprint, themeDirectory);
    known.set(finalFingerprint, themeDirectory);
    results.push({ name, status: "imported", message: "", themeDirectory });
  } catch (error) { results.push({ name, status: "failed", message: error instanceof Error ? error.message : String(error), themeDirectory: "" }); }
}
const imported = results.filter((x) => x.status === "imported").length;
const skipped = results.filter((x) => x.status === "skipped").length;
console.log(JSON.stringify({ imported, skipped, failed: results.length - imported - skipped, results }));
