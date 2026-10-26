import path from "node:path";
import { boundedText, ContractError, record } from "../contracts/manager.mjs";
import type { ThemeDetails, ThemeParameters } from "../contracts/manager.mjs";
import { fileBytes, fileStamp, MAX_MEDIA_BYTES, optionalBytes, sha256 } from "./local-files.mjs";
import type { LocalTheme, RevisionFile } from "./ports/platform.mjs";

function numeric(object: Record<string, unknown>, key: string, min: number, max: number): number | null {
  if (!Object.hasOwn(object, key) || ((key === "focusX" || key === "focusY") && object[key] === null)) return null;
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ContractError("THEME_INVALID", "A theme parameter is outside its supported range.");
  }
  return value;
}
function choice<T extends string>(object: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  if (!Object.hasOwn(object, key)) return null;
  const value = object[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ContractError("THEME_INVALID", "A theme parameter has an unsupported value.");
  }
  return value as T;
}
export function parameters(config: Record<string, unknown>): { stored: ThemeParameters; preview: ThemeParameters } {
  if (config.art !== undefined && !record(config.art)) throw new ContractError("THEME_INVALID", "Invalid theme art configuration.");
  const art = record(config.art) ? config.art : {};
  if (art.framingEnabled !== undefined && typeof art.framingEnabled !== "boolean") {
    throw new ContractError("THEME_INVALID", "Invalid framing flag.");
  }
  const palette = record(config.palette) ? config.palette : {};
  const colors = record(config.colors) ? config.colors : {};
  const accent = colors.accent ?? palette.accent ?? null;
  if (accent !== null && accent !== "" && (typeof accent !== "string" || !/^#[0-9a-f]{6}$/i.test(accent))) {
    throw new ContractError("THEME_INVALID", "Unsupported theme accent value.");
  }
  const stored: ThemeParameters = {
    appearance: choice(config, "appearance", ["auto", "light", "dark"]),
    focusX: numeric(art, "focusX", 0, 1), focusY: numeric(art, "focusY", 0, 1),
    positionX: numeric(art, "positionX", -1, 1), positionY: numeric(art, "positionY", -1, 1),
    zoom: numeric(art, "zoom", 1, 2), positionMode: choice(art, "positionMode", ["locked", "free"]),
    playbackRate: numeric(art, "playbackRate", 0.25, 2),
    framingEnabled: typeof art.framingEnabled === "boolean" ? art.framingEnabled : null,
    safeArea: choice(art, "safeArea", ["auto", "left", "right", "center", "none"]),
    taskMode: choice(art, "taskMode", ["auto", "ambient", "banner", "full", "off"]),
    bubbleOpacity: numeric(art, "bubbleOpacity", 0, 1), surfaceOpacity: numeric(art, "surfaceOpacity", 0, 1),
    shellOpacity: numeric(art, "shellOpacity", 0, 1),
    accent: accent === "" ? null : accent as string | null,
  };
  const framing = stored.framingEnabled ?? ["positionX", "positionY", "zoom", "positionMode"].some(key => Object.hasOwn(art, key));
  return { stored, preview: {
    appearance: stored.appearance ?? "auto", focusX: stored.focusX ?? 0.5, focusY: stored.focusY ?? 0.5,
    positionX: framing ? stored.positionX ?? 0 : 0, positionY: framing ? stored.positionY ?? 0 : 0,
    zoom: framing ? stored.zoom ?? 1 : 1, positionMode: framing ? stored.positionMode ?? "locked" : "locked",
    playbackRate: stored.playbackRate ?? 1,
    framingEnabled: framing, safeArea: stored.safeArea ?? "auto", taskMode: stored.taskMode ?? "auto",
    bubbleOpacity: stored.bubbleOpacity ?? 0, surfaceOpacity: stored.surfaceOpacity ?? 0.3, accent: stored.accent,
    shellOpacity: stored.shellOpacity ?? (stored.appearance === "light" ? 0.64 : 0.58),
  } };
}

const categories = ["dynamic", "people", "anime", "landscape", "city", "animals", "technology", "art"];
const labels = ["动态", "人物", "动漫", "风景", "城市", "萌宠", "科技", "艺术"];
function displayCategories(category: string, tags: string[], extension: string): string[] {
  const result = categories.filter((id, index) => category.toLowerCase() === id ||
    tags.some(tag => tag.toLowerCase() === id || tag === labels[index]));
  if ([".mp4", ".gif", ".apng"].includes(extension) && !result.includes("dynamic")) result.unshift("dynamic");
  if (!result.length || (result.length === 1 && result[0] === "dynamic")) {
    if (category.toLowerCase() === "nature") result.push("landscape");
    else if (category.toLowerCase() === "cyber") result.push("technology");
    else if (!result.length) result.push("art");
  }
  return result;
}
const mimeTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".apng": "image/apng",
  ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
  ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff", ".tiff": "image/tiff",
};
export async function themeDetails(local: LocalTheme): Promise<ThemeDetails> {
  return (await readThemeContent(local)).details;
}
// Metadata stamps invalidate read-only summaries and preview resources.
// Writers still read an exact content snapshot before publishing.
export async function themeListStamp(local: LocalTheme): Promise<string> {
  const files = [...local.revisionFiles.map(value => ({ file: value.file, root: value.root })),
    { file: local.mediaPath, root: local.mediaRoot }, ...(local.cssPath ? [{ file: local.cssPath, root: local.mediaRoot }] : [])];
  const stamps: unknown[] = [];
  for (const { file, root } of files) {
    try {
      stamps.push(await fileStamp(file, root));
    } catch (error) {
      if (!record(error) || error.code !== "ENOENT") throw error;
      stamps.push([file, null]);
    }
  }
  return sha256([...local.revisionInputs, Buffer.from(JSON.stringify({ config: local.config, stamps, order: local.catalogOrder, modifiedAt: local.modifiedAt }))]);
}
// Return the exact media bytes used by the validated revision so preview
// preparation need not read and validate the same content again.
export async function readThemeContent(local: LocalTheme): Promise<{ details: ThemeDetails; media: Uint8Array; css: Uint8Array | null }> {
  const config = local.config;
  if (config.schemaVersion !== 1 || config.id !== local.ref.id || !boundedText(config.name, 80)) {
    throw new ContractError("THEME_INVALID", "Invalid theme schema, identity or name.");
  }
  const category = config.category ?? (local.ref.source === "preset" ? "uncategorized" : "custom");
  if (!boundedText(category, 120) || (config.tags !== undefined && (!Array.isArray(config.tags) ||
      config.tags.length > 20 || config.tags.some(tag => !boundedText(tag, 120))))) {
    throw new ContractError("THEME_INVALID", "Invalid theme category or tags.");
  }
  const tags = (config.tags ?? []) as string[];
  const values = parameters(config);
  const extension = path.extname(local.mediaPath).toLowerCase(), mimeType = mimeTypes[extension];
  if (!mimeType) throw new ContractError("MEDIA_UNSUPPORTED", "This local media format is not supported.");
  const media = await fileBytes(local.mediaPath, local.mediaRoot, MAX_MEDIA_BYTES);
  const css = local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null;
  // Re-read the complete dependency set after collecting it. An atomic
  // directory swap between inventory and media reads must not publish a mixed revision.
  const checks: RevisionFile[] = [...local.revisionFiles,
    { file: local.mediaPath, root: local.mediaRoot, bytes: media, maximum: MAX_MEDIA_BYTES },
    ...(local.cssPath ? [{ file: local.cssPath, root: local.mediaRoot, bytes: css, maximum: 256 * 1024 }] : [])];
  for (const check of checks) {
    const bytes = await optionalBytes(check.file, check.root, check.maximum);
    const current = check.digest && bytes ? new TextEncoder().encode(sha256([bytes])) : bytes;
    if ((current === null) !== (check.bytes === null) ||
        (current !== null && check.bytes !== null && !Buffer.from(current).equals(check.bytes))) {
      throw new ContractError("THEME_CHANGED", "The theme dependency set changed during reading.", true);
    }
  }
  return { media, css, details: {
    ref: local.ref, name: config.name, storageCategory: category, displayCategories: displayCategories(category, tags, extension), tags,
    mediaKind: extension === ".mp4" ? "video" : [".gif", ".apng"].includes(extension) ? "animatedImage" : "image",
    catalogOrder: local.catalogOrder, addedAt: null, modifiedAt: local.modifiedAt,
    revision: sha256([...local.revisionInputs, media, css ?? new Uint8Array()]),
    storedParameters: values.stored, previewParameters: values.preview,
    media: { mimeType, byteLength: media.byteLength, width: null, height: null },
    warnings: [{ code: "MEDIA_NOT_INSPECTED", message: "Dimensions are not included in this response. Preview resolution separately checks existing media metadata limits and native decoding support." }],
    availability: { apply: { allowed: false, reasonCode: "METHOD_UNSUPPORTED" }, update: { allowed: false, reasonCode: "METHOD_UNSUPPORTED" },
      copy: { allowed: false, reasonCode: "METHOD_UNSUPPORTED" } },
  } };
}

const observedThemes = new Map<string, { stamp: string; details: ThemeDetails }>();
export async function observedThemeDetails(local: LocalTheme): Promise<ThemeDetails> {
  const key = local.mediaPath, stamp = await themeListStamp(local), cached = observedThemes.get(key);
  if (cached?.stamp === stamp) return structuredClone(cached.details);
  const details = await themeDetails(local);
  if (await themeListStamp(local) !== stamp) throw new ContractError("THEME_CHANGED", "The theme changed during observation.", true);
  if (observedThemes.size >= 128) observedThemes.delete(observedThemes.keys().next().value!);
  observedThemes.set(key, { stamp, details });
  return structuredClone(details);
}
