import path from "node:path";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { ContractError } from "../contracts/manager.mjs";
import { fileBytes, leaf, MAX_MEDIA_BYTES, optionalBytes, sha256 } from "./local-files.mjs";
import type { LocalTheme } from "./ports/platform.mjs";
import { themeDetails } from "./theme-model.mjs";
import { durableBytes } from "./write-files.mjs";
import { byteHash } from "./source-snapshots.mjs";
import { encodeThemePackage } from "./theme-package.mjs";
import type { PackageValidation } from "./theme-package.mjs";
import { MAX_PACKAGE_BYTES } from "./package-zip.mjs";

// Native-only result. The host consumes it and never forwards a local path.
export class NativeFiles {
  private readonly files = new Set<string>();
  constructor(private readonly directory: string) {}
  async exportPackage(local: LocalTheme, revision: string, validation: PackageValidation) {
    if ((await themeDetails(local)).revision !== revision) throw new ContractError("THEME_CHANGED", "Refresh before exporting this theme.");
    const media = await fileBytes(local.mediaPath, local.mediaRoot, MAX_MEDIA_BYTES);
    const css = local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null;
    const license = await optionalBytes(path.join(local.mediaRoot, "LICENSE.txt"), local.mediaRoot, 65536);
    if (sha256([...local.revisionInputs, media, css ?? new Uint8Array()]) !== revision) throw new ContractError("THEME_CHANGED", "The background no longer belongs to this revision.");
    const bytes = await encodeThemePackage(local.config, media, path.extname(local.mediaPath).toLowerCase(), css, license, validation);
    const same = (a: Uint8Array | null, b: Uint8Array | null) => a === null ? b === null : b !== null && Buffer.from(a).equals(b);
    if ((await themeDetails(local)).revision !== revision || !same(media, await fileBytes(local.mediaPath, local.mediaRoot, MAX_MEDIA_BYTES)) ||
        !same(css, local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null) ||
        !same(license, await optionalBytes(path.join(local.mediaRoot, "LICENSE.txt"), local.mediaRoot, 65536))) throw new ContractError("THEME_CHANGED", "The theme changed while preparing its export.");
    if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new ContractError("MEDIA_UNSUPPORTED", "The exported package exceeds the file size limit.");
    const fileName = randomBytes(24).toString("hex") + ".cdskin", file = path.join(this.directory, fileName);
    await durableBytes(file, this.directory, bytes); this.files.add(file);
    return { fileName, sha256: byteHash(bytes), byteLength: bytes.byteLength, extension: ".cdskin", suggestedName: "theme.cdskin" };
  }
  async original(local: LocalTheme, revision: string) {
    if ((await themeDetails(local)).revision !== revision) throw new ContractError("THEME_CHANGED", "Refresh before saving or opening original media.");
    const original = local.config.originalImage === undefined ? null : leaf(local.config.originalImage);
    const source = original ? path.join(local.mediaRoot, original) : local.mediaPath;
    const extension = path.extname(source).toLowerCase();
    if (!/^\.(png|apng|jpe?g|webp|gif|mp4|heic|heif|tiff?)$/.test(extension)) throw new ContractError("MEDIA_UNSUPPORTED", "Original media has an unsupported format.");
    const bytes = await fileBytes(source, local.mediaRoot, MAX_MEDIA_BYTES);
    if (!original) {
      const css = local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null;
      if (sha256([...local.revisionInputs, bytes, css ?? new Uint8Array()]) !== revision) throw new ContractError("THEME_CHANGED", "Original background bytes no longer belong to this revision.");
    }
    if ((await themeDetails(local)).revision !== revision || !Buffer.from(bytes).equals(await fileBytes(source, local.mediaRoot, MAX_MEDIA_BYTES))) {
      throw new ContractError("THEME_CHANGED", "The original media changed during snapshot preparation.");
    }
    const fileName = randomBytes(24).toString("hex") + extension, file = path.join(this.directory, fileName);
    await durableBytes(file, this.directory, bytes); this.files.add(file);
    return { fileName, sha256: byteHash(bytes), byteLength: bytes.byteLength, extension, suggestedName: "original" + extension };
  }
  async release(fileName: unknown): Promise<boolean> {
    if (typeof fileName !== "string" || !/^[a-f0-9]{48}\.(cdskin|png|apng|jpe?g|webp|gif|mp4|heic|heif|tiff?)$/.test(fileName)) throw new ContractError("INVALID_REQUEST", "Invalid native output identity.");
    const file = path.join(this.directory, fileName);
    if (!this.files.has(file)) return false;
    try { await unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.files.delete(file); return true;
  }
  async close() { for (const file of this.files) { try { await unlink(file); } catch { } } this.files.clear(); }
}
