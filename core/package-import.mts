import path from "node:path";
import { lstat, mkdir, rm } from "node:fs/promises";
import { ContractError, failure, record } from "../contracts/manager.mjs";
import type { ThemePackageCommand, ThemeRef } from "../contracts/manager.mjs";
import type { SnapshotFile } from "./source-snapshots.mjs";
import type { PlatformPort } from "./ports/platform.mjs";
import type { LibraryOutcome } from "./ports/library.mjs";
import type { PackageValidation } from "./theme-package.mjs";
import { PackageSources } from "./package-sources.mjs";
import { packageFingerprint } from "./theme-package.mjs";
import { fileBytes, MAX_MEDIA_BYTES, optionalBytes, safePath } from "./local-files.mjs";
import { themeDetails } from "./theme-model.mjs";
import { durableBytes, privateDirectory, syncDirectory } from "./write-files.mjs";
import type { LibraryTransactions } from "./library-transactions.mjs";
import { communityOrigin } from "./community-origin.mjs";

export async function importPackage(state: string, command: ThemePackageCommand, raw: unknown, adapter: PlatformPort,
  validation: PackageValidation, validateMedia: (file: string) => Promise<void>, journals: LibraryTransactions): Promise<LibraryOutcome> {
  let libraryChanged: boolean | null = false, resultTheme: ThemeRef | null = null;
  let temporaryStage: string | null = null;
  try {
    const sources = new PackageSources(state, validation); await sources.read(raw);
    const source = raw as SnapshotFile, payload = await sources.decode(source);
    const id = "custom-" + command.params.operationId.split(":")[1];
    const origin = source.community;
    const config: Record<string, unknown> = { ...payload.config, id, ...(origin ? { managerCommunity: origin } : {}) };
    const library = path.join(state, "themes"), stage = path.join(library, ".manager-package-" + id.slice(7)), destination = path.join(library, id);
    await privateDirectory(library); await safePath(library, state);
    try { await lstat(destination); throw new ContractError("OPERATION_CONFLICT", "The package import identity already exists; it cannot be overwritten."); }
    catch (error) { if (!record(error) || error.code !== "ENOENT") throw error; }
    const staged = new Map<string, Uint8Array>([[String(config.image), payload.media], ["theme.json", Buffer.from(JSON.stringify(config) + "\n")]]);
    if (payload.css !== null) staged.set("theme.css", payload.css); if (payload.license !== null) staged.set("LICENSE.txt", payload.license);
    await mkdir(stage, { mode: 0o700 }); temporaryStage = stage; await safePath(stage, library);
    for (const [name, bytes] of staged) await durableBytes(path.join(stage, name), stage, bytes);
    await validateMedia(path.join(stage, String(config.image)));
    if (payload.format !== "cdskin") await validation.payload(stage);
    const fingerprint = packageFingerprint(config, payload.media, payload.css, payload.license);
    for (const local of (await adapter.inventory()).themes) {
      if (local.ref.source !== "saved") continue;
      const existingOrigin = communityOrigin(local.config.managerCommunity);
      // Keep community downloads independent from personal themes, even when
      // their media and display settings happen to be identical.
      if (origin ? existingOrigin?.version !== origin.version || existingOrigin.packageSha256 !== origin.packageSha256 : existingOrigin !== null) continue;
      let duplicate: { theme: ThemeRef; revision: string } | null = null;
      try {
        const details = await themeDetails(local), media = await fileBytes(local.mediaPath, local.mediaRoot, MAX_MEDIA_BYTES);
        const css = local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null;
        const license = await optionalBytes(path.join(local.mediaRoot, "LICENSE.txt"), local.mediaRoot, 65536);
        if (fingerprint !== packageFingerprint(local.config, media, css, license)) continue;
        if ((await themeDetails(local)).revision !== details.revision || !Buffer.from(media).equals(await fileBytes(local.mediaPath, local.mediaRoot, MAX_MEDIA_BYTES)) ||
            !equal(css, local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null) ||
            !equal(license, await optionalBytes(path.join(local.mediaRoot, "LICENSE.txt"), local.mediaRoot, 65536))) continue;
        duplicate = { theme: local.ref, revision: details.revision };
      } catch { /* An unreadable existing entry cannot suppress a valid package. */ }
      if (duplicate) {
        await sources.read(source); await safePath(stage, library); await rm(stage, { recursive: true }); temporaryStage = null;
        return { libraryChanged: false, resultTheme: duplicate.theme, resultRevision: duplicate.revision, disposition: "duplicate", error: null };
      }
    }
    for (const [name, bytes] of staged) {
      if (!Buffer.from(bytes).equals(await fileBytes(path.join(stage, name), stage, name === String(config.image) ? MAX_MEDIA_BYTES : name === "theme.css" ? 256 * 1024 : name === "LICENSE.txt" ? 65536 : 1024 * 1024))) {
        throw new ContractError("IO_ERROR", "The staged package bytes changed before publication.");
      }
    }
    await sources.read(source); await safePath(stage, library); await safePath(library, state); await syncDirectory(stage);
    resultTheme = { source: "saved", id }; libraryChanged = null;
    await journals.publish(command.params.operationId, stage, resultTheme); libraryChanged = true;
    const local = (await adapter.inventory()).themes.find(theme => theme.ref.source === "saved" && theme.ref.id === id);
    if (!local) throw new ContractError("IO_ERROR", "The imported package could not be read back.");
    return { libraryChanged, resultTheme, resultRevision: (await themeDetails(local)).revision, disposition: "created", error: null };
  } catch (error) {
    // A stage with no attempted commit is not recovery material.
    if (temporaryStage && libraryChanged === false) {
      try { await safePath(temporaryStage, path.join(state, "themes")); await rm(temporaryStage, { recursive: true }); } catch { /* Keep an inaccessible stage; do not publish after cleanup failed. */ }
    }
    const response = failure(null, error); return { libraryChanged, resultTheme, resultRevision: null, disposition: null, error: response.ok ? null : response.error };
  }
}
function equal(a: Uint8Array | null, b: Uint8Array | null): boolean { return a === null ? b === null : b !== null && Buffer.from(a).equals(b); }
