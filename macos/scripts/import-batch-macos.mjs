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

const themesRoot = path.join(process.env.HOME, "Library/Application Support/CodexDreamSkinStudio", "themes");
const regularFile = async (file) => {
  const stat = await fs.lstat(file).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink();
};
const framing = (theme) => ["positionX", "positionY", "zoom", "positionMode"].some((key) => Object.hasOwn(theme?.art ?? {}, key));
const fingerprint = (theme, bytes) => {
  const art = theme?.art ?? {};
  const normalized = {
    imageHash: crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    framingEnabled: framing(theme), appearance: ["auto", "light", "dark"].includes(theme?.appearance) ? theme.appearance : "auto",
    focusX: Number.isFinite(art.focusX) ? art.focusX : 0.5, focusY: Number.isFinite(art.focusY) ? art.focusY : 0.5,
    positionX: Number.isFinite(art.positionX) ? art.positionX : 0, positionY: Number.isFinite(art.positionY) ? art.positionY : 0,
    zoom: Number.isFinite(art.zoom) ? art.zoom : 1, positionMode: ["locked", "free"].includes(art.positionMode) ? art.positionMode : "locked",
    safeArea: ["auto", "left", "right", "center", "none"].includes(art.safeArea) ? art.safeArea : "auto",
    taskMode: ["auto", "ambient", "banner", "full", "off"].includes(art.taskMode) ? art.taskMode : "auto",
    accent: typeof theme?.colors?.accent === "string" ? theme.colors.accent.toUpperCase() : "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
};
await fs.mkdir(themesRoot, { recursive: true, mode: 0o700 });
const known = new Map();
for (const entry of await fs.readdir(themesRoot, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
  const dir = path.join(themesRoot, entry.name), configPath = path.join(dir, "theme.json");
  if (!(await regularFile(configPath))) continue;
  try {
    const theme = JSON.parse(await fs.readFile(configPath, "utf8")), image = path.join(dir, path.basename(theme.image || ""));
    if (theme.id !== entry.name || !(await regularFile(image))) continue;
    known.set(theme.managerFingerprintVersion === 2 && typeof theme.managerFingerprint === "string" ? theme.managerFingerprint : fingerprint(theme, await fs.readFile(image)), dir);
  } catch { /* Ignore malformed saved themes. */ }
}
const usedIds = new Set(await fs.readdir(themesRoot));
function run(args) {
  return new Promise((resolve) => {
    const isWindowsBatch = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(scriptPath);
    const command = isWindowsBatch ? (process.env.ComSpec || "cmd.exe") : scriptPath;
    const commandArgs = isWindowsBatch ? ["/d", "/s", "/c", scriptPath, ...args] : args;
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] }); let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
    child.on("error", (error) => resolve({ code: 1, stderr: error.message }));
  });
}

const results = [];
for (const item of request.items) {
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  try {
    if (!item || typeof item.imagePath !== "string" || !item.imagePath) throw new Error("缺少图片路径。");
    const imagePath = path.resolve(item.imagePath);
    if (!(await regularFile(imagePath))) throw new Error("图片必须是普通文件。");
    const imageBytes = await fs.readFile(imagePath);
    const id = (() => { let value; do value = `img-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`; while (usedIds.has(value)); usedIds.add(value); return value; })();
    const candidate = { appearance: item.appearance || "auto", category: item.category || "custom", tags: Array.isArray(item.tags) ? item.tags : [], art: { focusX: item.focusX ?? 0.5, focusY: item.focusY ?? 0.5, safeArea: item.safeArea || "auto", taskMode: item.taskMode || "auto" } };
    if (item.framingEnabled ?? ["positionX", "positionY", "zoom", "positionMode"].some((key) => Object.hasOwn(item, key))) Object.assign(candidate.art, { positionX: item.positionX ?? 0, positionY: item.positionY ?? 0, zoom: item.zoom ?? 1, positionMode: item.positionMode || "locked" });
    if (item.accent) candidate.colors = { accent: String(item.accent) };
    const candidateFingerprint = fingerprint(candidate, imageBytes);
    if (known.has(candidateFingerprint)) { results.push({ name, status: "skipped", message: "相同图片和主题参数已存在。", themeDirectory: known.get(candidateFingerprint) }); continue; }
    const args = ["--file", imagePath, "--name", name || "Codex Dream Skin", "--appearance", candidate.appearance, "--safe-area", candidate.art.safeArea, "--task-mode", candidate.art.taskMode, "--category", candidate.category, "--tags-json", JSON.stringify(candidate.tags), "--theme-id", id, "--focus-x", String(candidate.art.focusX), "--focus-y", String(candidate.art.focusY), "--no-apply"];
    if (item.accent) args.push("--accent", String(item.accent));
    if (framing(candidate)) args.push("--position-x", String(candidate.art.positionX), "--position-y", String(candidate.art.positionY), "--zoom", String(candidate.art.zoom), "--position-mode", candidate.art.positionMode, "--framing", "true");
    const result = await run(args);
    if (result.code !== 0) throw new Error(result.stderr || "图片导入失败。");
    const themeDirectory = path.join(themesRoot, id), themePath = path.join(themeDirectory, "theme.json");
    if (!(await regularFile(themePath))) throw new Error("导入未生成有效主题。");
    const theme = JSON.parse(await fs.readFile(themePath, "utf8")), finalFingerprint = fingerprint(theme, await fs.readFile(path.join(themeDirectory, theme.image)));
    await fs.writeFile(themePath, `${JSON.stringify({ ...theme, managerFingerprintVersion: 2, managerFingerprint: finalFingerprint }, null, 2)}\n`, { mode: 0o600 });
    known.set(candidateFingerprint, themeDirectory); known.set(finalFingerprint, themeDirectory);
    results.push({ name, status: "imported", message: "", themeDirectory });
  } catch (error) { results.push({ name, status: "failed", message: error instanceof Error ? error.message : String(error), themeDirectory: "" }); }
}
const imported = results.filter((item) => item.status === "imported").length;
const skipped = results.filter((item) => item.status === "skipped").length;
console.log(JSON.stringify({ imported, skipped, failed: results.length - imported - skipped, results }));
