import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const [stateRoot, themeDirectory, activeId = ""] = process.argv.slice(2);
if (!stateRoot || !themeDirectory) throw new Error("Usage: delete-theme-macos.mjs <state-root> <theme-directory> [active-id]");
const root = path.resolve(stateRoot, "themes");
const target = path.resolve(themeDirectory);
const relative = path.relative(root, target);
if (!relative || path.isAbsolute(relative) || relative.includes(path.sep)) {
  throw new Error("只能删除主题库中的直接子目录。");
}
const targetStat = await fs.lstat(target).catch(() => null);
if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) throw new Error("主题目录不存在或不安全。");

async function assertNoSymbolicLinks(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("主题目录包含不安全的符号链接。");
    if (entry.isDirectory()) await assertNoSymbolicLinks(entryPath);
  }
}

await assertNoSymbolicLinks(target);
const configPath = path.join(target, "theme.json");
const configStat = await fs.lstat(configPath).catch(() => null);
if (!configStat?.isFile() || configStat.isSymbolicLink()) throw new Error("主题配置不存在或不安全。");
let theme;
try { theme = JSON.parse(await fs.readFile(configPath, "utf8")); } catch { throw new Error("主题配置不是有效 JSON。"); }
if (!theme || typeof theme.id !== "string" || theme.id !== relative) throw new Error("主题 ID 与目录不匹配。");
if (activeId && theme.id === activeId) throw new Error("当前正在使用该主题，请先应用其他主题后再删除。");

const quarantine = path.join(path.dirname(root), `.manager-delete-${randomUUID()}`);
await fs.rename(target, quarantine);
let cleanupPending = false;
try { await fs.rm(quarantine, { recursive: true, force: true }); }
catch { cleanupPending = true; }
console.log(JSON.stringify({ id: theme.id, name: typeof theme.name === "string" ? theme.name : theme.id, deleted: true, cleanupPending }));
