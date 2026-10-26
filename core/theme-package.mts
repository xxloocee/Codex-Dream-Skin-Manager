import path from "node:path";
import { boundedText, ContractError, parseThemePatch, record } from "../contracts/manager.mjs";
import type { PackageDetails } from "../contracts/manager.mjs";
import { jsonObject, sha256 } from "./local-files.mjs";
import { canonicalJson, editTheme } from "./theme-edit.mjs";
import { parameters } from "./theme-model.mjs";
import { readThemeZip, writeThemeZip } from "./package-zip.mjs";

export interface PackagePayload {
  config: Record<string, unknown>; media: Uint8Array; extension: string; css: Uint8Array | null; license: Uint8Array | null;
  format: PackageDetails["format"]; signatureIgnored: boolean;
}
export interface PackageValidation {
  platform: "windows" | "macos";
  inspect(bytes: Uint8Array, extension: string): Promise<void>;
  css(bytes: Uint8Array): Promise<void>;
  legacyZip(files: Map<string, Buffer>): Promise<{ format: "official" | "simple"; image: string; signatureIgnored: boolean }>;
  payload(directory: string): Promise<void>;
}
export function packageFingerprint(config: Record<string, unknown>, media: Uint8Array, css: Uint8Array | null, license: Uint8Array | null): string {
  const semantic = structuredClone(config), { stored, preview } = parameters(config);
  for (const key of ["id", "image", "originalImage", "managerFingerprint", "managerFingerprintVersion", "packageOrigin"]) delete semantic[key];
  semantic.category ??= "custom"; semantic.tags ??= [];
  delete semantic.appearance;
  const art = record(semantic.art) ? semantic.art : {};
  for (const key of Object.keys(stored)) delete art[key];
  if (Object.keys(art).length) semantic.art = art; else delete semantic.art;
  for (const key of ["colors", "palette"]) {
    const container = semantic[key];
    if (record(container)) { delete container.accent; if (!Object.keys(container).length) delete semantic[key]; }
  }
  const render = { ...preview, focusX: stored.focusX, focusY: stored.focusY, shellOpacity: stored.shellOpacity, accent: stored.accent?.toUpperCase() ?? null };
  const origin: Record<string, unknown> = record(config.packageOrigin) && record(config.packageOrigin.manifest) ? config.packageOrigin.manifest : {};
  const attribution = { license: origin.license ?? null, publisher: origin.publisher ?? null, provenance: origin.provenance ?? null };
  return sha256([Buffer.from("dreamskin-package-semantic/1"), Buffer.from(canonicalJson({ config: semantic, render, attribution,
    cssPresent: css !== null, licensePresent: license !== null })), media, css ?? new Uint8Array(), license ?? new Uint8Array()]);
}
function metadata(config: Record<string, unknown>): void {
  if (config.schemaVersion !== 1 || !boundedText(config.name, 80) || !config.name.trim() ||
      !boundedText(config.category, 120) || !Array.isArray(config.tags) || config.tags.length > 20 || config.tags.some(tag => !boundedText(tag, 120))) {
    throw new ContractError("THEME_INVALID", "Invalid theme package metadata.");
  }
  if ((config.palette !== undefined && !record(config.palette)) || (config.colors !== undefined && !record(config.colors))) throw new ContractError("THEME_INVALID", "Invalid package colors.");
  parameters(config);
}
function portableMetadata(config: Record<string, unknown>): void {
  try { parseThemePatch({ name: config.name, storageCategory: config.category, tags: config.tags }); }
  catch { throw new ContractError("THEME_INVALID", "Format-1 packages require an 80-unit name, a supported category and at most eight 20-unit tags."); }
}
export async function decodeThemePackage(bytes: Uint8Array, extension: string, validation: PackageValidation, communityOfficial = false): Promise<PackagePayload> {
  try {
    const macZip = extension === ".zip" && (validation.platform === "macos" || communityOfficial);
    if (extension !== ".cdskin" && !macZip) throw new ContractError("MEDIA_UNSUPPORTED", "This package format is unavailable on this platform.");
    const files = readThemeZip(bytes, macZip);
    let config: Record<string, unknown>, image: string, format: PackageDetails["format"], signatureIgnored = false;
    if (macZip) {
      const checked = await validation.legacyZip(files); image = checked.image; format = checked.format; signatureIgnored = checked.signatureIgnored;
      if (communityOfficial && format !== "official") throw new ContractError("THEME_INVALID", "社区下载只允许官方 manifest ZIP。");
      config = jsonObject(files.get("theme.json")!);
      if (format === "official") config.packageOrigin = { format: "official", manifest: jsonObject(files.get("manifest.json")!), signatureVerified: false };
    } else {
      const lookup = (name: string) => [...files.keys()].find(key => key.toLowerCase() === name.toLowerCase());
      const manifest = lookup("manifest.json"); if (!manifest) throw new Error();
      config = jsonObject(files.get(manifest)!);
      if (config.formatVersion !== 1 || typeof config.image !== "string" || !/^[^/\\:]+\.(png|apng|jpe?g|webp|gif|mp4)$/i.test(config.image)) throw new Error();
      image = lookup(config.image) ?? "";
      if (!image || image.toLowerCase() === "manifest.json" || [...files.keys()].some(key => ![manifest.toLowerCase(), image.toLowerCase(), "theme.css", "license.txt"].includes(key.toLowerCase()))) throw new Error();
      // Normalize only registered filenames; metadata and unrecognized config
      // fields remain available for a later format-1 export.
      for (const name of ["theme.css", "LICENSE.txt"]) { const key = lookup(name); if (key && key !== name) { files.set(name, files.get(key)!); files.delete(key); } }
      delete config.formatVersion; config.schemaVersion = 1; format = "cdskin";
    }
    config.category ??= "custom"; config.tags ??= [];
    // The portable format has no originalImage entry. Never retain a dangling
    // reference supplied by an imported manifest or simplified ZIP.
    delete config.originalImage;
    if (record(config.packageOrigin)) config.packageOrigin.signatureVerified = false;
    const accent = parameters(config).stored.accent;
    config = editTheme(config, { parameters: { accent } }, validation.platform);
    metadata(config);
    if (format === "cdskin") portableMetadata(config);
    const mediaExtension = path.extname(image).toLowerCase(), media = files.get(image), css = files.get("theme.css") ?? null, license = files.get("LICENSE.txt") ?? null;
    if (!media || media.byteLength < 1 || !/^\.(png|apng|jpe?g|webp|gif|mp4)$/.test(mediaExtension)) throw new Error();
    config.image = "background" + mediaExtension;
    if (Buffer.byteLength(JSON.stringify(config)) > 1024 * 1024) throw new Error();
    await validation.inspect(media, mediaExtension); if (css !== null) await validation.css(css);
    return { config, media, extension: mediaExtension, css, license, format, signatureIgnored };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError("THEME_INVALID", "The package manifest, media, Safe CSS or payload failed validation.");
  }
}
export function describePackage(payload: PackagePayload): PackageDetails {
  return { format: payload.format, name: payload.config.name as string, storageCategory: payload.config.category as string,
    tags: payload.config.tags as string[], hasCss: payload.css !== null, license: payload.license === null ? null : new TextDecoder().decode(payload.license),
    signatureIgnored: payload.signatureIgnored, fingerprint: packageFingerprint(payload.config, payload.media, payload.css, payload.license),
    storedParameters: parameters(payload.config).stored, previewParameters: parameters(payload.config).preview };
}
export async function encodeThemePackage(config: Record<string, unknown>, media: Uint8Array, extension: string,
  css: Uint8Array | null, license: Uint8Array | null, validation: PackageValidation): Promise<Uint8Array> {
  if (!/^\.(png|apng|jpe?g|webp|gif|mp4)$/.test(extension)) throw new ContractError("MEDIA_UNSUPPORTED", "Convert this background before exporting a format-1 package.");
  await validation.inspect(media, extension); if (css !== null) await validation.css(css);
  portableMetadata({ ...config, category: config.category ?? "custom", tags: config.tags ?? [] });
  const portable = editTheme(config, { parameters: { accent: parameters(config).stored.accent } }, "windows");
  portable.category ??= "custom"; portable.tags ??= [];
  delete portable.schemaVersion; delete portable.originalImage;
  if (record(portable.art)) {
    for (const key of ["focusX", "focusY"]) if (portable.art[key] === null) delete portable.art[key];
  }
  if (record(portable.packageOrigin)) portable.packageOrigin.signatureVerified = false;
  const image = "art" + extension, manifest = Buffer.from(JSON.stringify({ ...portable, formatVersion: 1, image }) + "\n");
  const files = new Map<string, Uint8Array>([["manifest.json", manifest], [image, media]]);
  if (css !== null) files.set("theme.css", css); if (license !== null) files.set("LICENSE.txt", license);
  return writeThemeZip(files);
}
