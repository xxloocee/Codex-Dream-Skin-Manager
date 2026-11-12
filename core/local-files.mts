import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ContractError, record } from "../contracts/manager.mjs";
import type { LocalTheme } from "./ports/platform.mjs";

export const MAX_CONFIG_BYTES = 1024 * 1024;
export const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const normalized = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
const missing = (error: unknown): boolean => record(error) && error.code === "ENOENT";

export async function fileStamp(file: string, root: string): Promise<string[]> {
  await safePath(file, root);
  const value = await lstat(file, { bigint: true });
  if (!value.isFile()) throw new ContractError("THEME_INVALID", "Invalid theme dependency type.");
  return [file, String(value.dev), String(value.ino), String(value.size), String(value.mtimeNs), String(value.ctimeNs)];
}
export async function safePath(file: string, root: string): Promise<void> {
  const absolute = path.resolve(file), base = path.resolve(root);
  const relative = path.relative(base, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ContractError("THEME_INVALID", "A theme path leaves its allowed directory.");
  }
  // Check ancestors too: a junction/symlink in the library root is not trusted.
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new ContractError("THEME_INVALID", "Linked theme paths are not supported.");
    }
  }
  if (normalized(await realpath(absolute)) !== normalized(absolute)) {
    throw new ContractError("THEME_INVALID", "The theme path resolves to a different location.");
  }
}

export async function fileBytes(file: string, root: string, maximum = MAX_CONFIG_BYTES, minimum = 1): Promise<Uint8Array> {
  await safePath(file, root);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < minimum || before.size > maximum) {
      throw new ContractError("THEME_INVALID", "Invalid file type or size.");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw new ContractError("THEME_CHANGED", "A theme changed during reading.", true);
      offset += result.bytesRead;
    }
    const after = await handle.stat(), current = await lstat(file);
    await safePath(file, root);
    if (before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.size !== after.size ||
        current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) {
      throw new ContractError("THEME_CHANGED", "A theme changed during reading.", true);
    }
    return bytes;
  } finally { await handle.close(); }
}
export async function optionalBytes(file: string, root: string, maximum = MAX_CONFIG_BYTES, minimum = 1): Promise<Uint8Array | null> {
  try { return await fileBytes(file, root, maximum, minimum); } catch (error) { if (missing(error)) return null; throw error; }
}
export function jsonObject(bytes: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(decoder.decode(bytes).replace(/^\uFEFF/, "")); }
  catch { throw new ContractError("THEME_INVALID", "A configuration is not valid UTF-8 JSON."); }
  if (!record(value)) throw new ContractError("THEME_INVALID", "Expected a configuration object.");
  return value;
}
export async function directories(root: string): Promise<string[] | null> {
  try {
    await safePath(root, root);
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length > 10000) throw new ContractError("BUSY", "The theme directory is too large to read safely.");
    // Include links so the caller reports them as invalid entries instead of hiding them.
    return entries.filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
      .map(entry => entry.name).sort();
  } catch (error) { if (missing(error)) return null; throw error; }
}
export function sha256(parts: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const part of parts) { hash.update(String(part.byteLength)); hash.update(":"); hash.update(part); }
  return hash.digest("hex");
}
export function leaf(value: unknown): string {
  if (typeof value !== "string" || !/^[^\u0000-\u001f<>:"/\\|?*]{1,255}$/u.test(value) ||
      value === "." || value === ".." || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new ContractError("THEME_INVALID", "Invalid local media name.");
  }
  return value;
}
export function relativeMedia(value: unknown): string {
  if (typeof value !== "string" || /^[\\/]/.test(value)) {
    throw new ContractError("THEME_INVALID", "Invalid relative media path.");
  }
  return path.join(...value.split(/[\\/]/).map(part => leaf(part)));
}
export async function readLocalTheme(directory: string, source: "preset" | "saved", order: number, allowNested = false): Promise<LocalTheme> {
  const configFile = path.join(directory, "theme.json");
  const bytes = await fileBytes(configFile, directory);
  const config = jsonObject(bytes);
  const id = path.basename(directory);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) || config.schemaVersion !== 1 || config.id !== id) {
    throw new ContractError("THEME_INVALID", "Invalid theme identity or schema.");
  }
  // Rendering needs the config and rendered media. Operations that copy or
  // export attachments capture and verify those files when they use them.
  return {
    ref: { source, id }, config, revisionInputs: [bytes], mediaRoot: directory,
    revisionFiles: [{ file: configFile, root: directory, bytes }],
    mediaPath: path.join(directory, allowNested ? relativeMedia(config.image) : leaf(config.image)), cssPath: path.join(directory, "theme.css"),
    catalogOrder: order, modifiedAt: (await lstat(path.join(directory, "theme.json"))).mtime.toISOString(),
  };
}
