import path from "node:path";
import { boundedText, ContractError, record } from "../contracts/manager.mjs";
import type { Diagnostic } from "../contracts/manager.mjs";
import { directories, fileBytes, jsonObject, optionalBytes, readLocalTheme } from "../core/local-files.mjs";
import type { LocalTheme, ThemeInventory } from "../core/ports/platform.mjs";

export async function scanLibrary(root: string, classify: (id: string) => "preset" | "saved", order: (id: string) => number, allowNested = false): Promise<ThemeInventory> {
  const names = await directories(root);
  const themes: LocalTheme[] = [], warnings: Diagnostic[] = [];
  if (names === null) {
    warnings.push({ code: "LIBRARY_NOT_INITIALIZED", message: "The existing theme directory is absent; this reader does not initialize it." });
    return { themes, warnings };
  }
  for (const id of names) {
    try { themes.push(await readLocalTheme(path.join(root, id), classify(id), order(id), allowNested)); }
    catch { warnings.push({ code: "THEME_INVALID", message: "An unreadable or unsafe theme directory was omitted." }); }
  }
  return { themes, warnings };
}
export async function readVersion(file: string, root: string): Promise<string | null> {
  const bytes = await optionalBytes(file, root, 128);
  if (!bytes) return null;
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  return /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value) ? value : null;
}
export async function catalogEntries(file: string, root: string): Promise<{ bytes: Uint8Array; entries: Record<string, unknown>[] } | null> {
  const bytes = await optionalBytes(file, root);
  if (!bytes) return null;
  const value = jsonObject(bytes);
  if (value.schemaVersion !== 1 || !Array.isArray(value.themes) || value.themes.length < 1 || value.themes.length > 100) {
    throw new ContractError("THEME_INVALID", "Invalid preset catalog schema.");
  }
  const ids = new Set<string>();
  for (const entry of value.themes) {
    if (!record(entry) || typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) ||
        ids.has(entry.id) || !boundedText(entry.name, 80)) {
      throw new ContractError("THEME_INVALID", "Invalid or duplicate preset catalog identity.");
    }
    ids.add(entry.id);
  }
  return { bytes, entries: value.themes as Record<string, unknown>[] };
}
export async function activeId(file: string, root: string): Promise<string | null> {
  const bytes = await optionalBytes(file, root);
  if (!bytes) return null;
  const id = jsonObject(bytes).id;
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) ? id : null;
}
export async function existingTheme(root: string, id: string, source: "preset" | "saved", allowNested = false): Promise<boolean> {
  try { await readLocalTheme(path.join(root, id), source, 0, allowNested); return true; }
  catch { return false; }
}
export async function mergedPreset(theme: LocalTheme, stateRoot: string): Promise<LocalTheme> {
  // Flat presets have no theme.json reader. Include their shared LICENSE in the
  // revision so a copy cannot silently pick up different attribution bytes.
  const licenseFile = path.join(theme.mediaRoot, "LICENSE.txt");
  if (!theme.revisionFiles.some(value => value.file === licenseFile)) {
    const license = await optionalBytes(licenseFile, theme.mediaRoot, 65536);
    theme = { ...theme, revisionInputs: [...theme.revisionInputs, new TextEncoder().encode(JSON.stringify({ license: license !== null })), license ?? new Uint8Array()],
      revisionFiles: [...theme.revisionFiles, { file: licenseFile, root: theme.mediaRoot, bytes: license, maximum: 65536 }] };
  }
  const file = path.join(stateRoot, "preset-settings", `${theme.ref.id}.json`);
  const bytes = await optionalBytes(file, stateRoot, 16384);
  const revisionFiles = [...theme.revisionFiles, { file, root: stateRoot, bytes, maximum: 16384 }];
  if (!bytes) return { ...theme, revisionFiles };
  const settings = jsonObject(bytes);
  if (settings.schemaVersion !== 1 || !["auto", "light", "dark"].includes(String(settings.appearance)) || !record(settings.art)) {
    throw new ContractError("THEME_INVALID", "Invalid preset settings schema.");
  }
  // Old settings replace these fields, including omissions; they do not overlay defaults.
  const art = record(theme.config.art) ? { ...theme.config.art } : {};
  for (const key of ["focusX", "focusY", "safeArea", "taskMode", "bubbleOpacity", "surfaceOpacity", "shellOpacity", "positionX", "positionY", "zoom", "positionMode", "framingEnabled", "playbackRate"]) {
    delete art[key];
    if (Object.hasOwn(settings.art, key)) art[key] = settings.art[key];
  }
  const palette = record(theme.config.palette) ? { ...theme.config.palette } : {};
  delete palette.accent;
  if (settings.accent !== undefined && settings.accent !== "") palette.accent = settings.accent;
  return { ...theme, config: { ...theme.config, appearance: settings.appearance, art, palette },
    revisionInputs: [...theme.revisionInputs, bytes], revisionFiles };
}
