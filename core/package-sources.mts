import path from "node:path";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { boundedText, ContractError, failure, record } from "../contracts/manager.mjs";
import type { CommunityDownload, CommunityMetadata, SourceGrant, SourceSelection } from "../contracts/manager.mjs";
import type { SnapshotFile } from "./source-snapshots.mjs";
import type { PackageValidation, PackagePayload } from "./theme-package.mjs";
import { byteHash, inputSnapshotHandle, pruneOrphanInputs } from "./source-snapshots.mjs";
import { fileBytes, sha256 } from "./local-files.mjs";
import { durableBytes, privateDirectory, syncDirectory } from "./write-files.mjs";
import { MAX_PACKAGE_BYTES } from "./package-zip.mjs";
import { decodeThemePackage } from "./theme-package.mjs";
import { describePackage } from "./theme-package.mjs";
import { communityOrigin } from "./community-origin.mjs";

export class PackageSources {
  readonly directory: string;
  private readonly grants = new Map<string, { grant: SourceGrant; file: SnapshotFile }>();
  private readonly owned = new Set<string>();
  private readonly pins = new Map<string, string>();
  constructor(state: string, private readonly validation: PackageValidation) { this.directory = path.join(state, "manager-operations", "package-snapshots"); }
  private async budget() {
    await privateDirectory(this.directory);
    await pruneOrphanInputs(this.directory);
    for (const [handle, entry] of this.grants) if (Date.parse(entry.grant.expiresAt) <= Date.now()) this.grants.delete(handle);
    await this.prune();
  }
  private async prune(): Promise<void> {
    const active = new Set([...this.grants.values()].map(entry => entry.file.fileName));
    for (const name of this.pins.values()) active.add(name);
    for (const name of this.owned) {
      if (active.has(name) || !/^[a-f0-9]{48}\.(cdskin|zip|community\.zip)$/.test(name)) continue;
      try { await unlink(path.join(this.directory, name)); this.owned.delete(name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; this.owned.delete(name); }
    }
  }
  async register(paths: string[]): Promise<SourceSelection> {
    await this.budget();
    if (paths.length < 1 || paths.length > 32) throw new ContractError("INVALID_REQUEST", "Select at most 32 packages.");
    const result: SourceSelection = { cancelled: false, sources: [], failures: [] }, accepted = new Map<string, { grant: SourceGrant; file: SnapshotFile }>();
    for (const file of paths) {
      const name = path.basename(file);
      let created: string | null = null;
      try {
        const extension = path.extname(name).toLowerCase();
        if (!path.isAbsolute(file) || !boundedText(name, 255) || (extension !== ".cdskin" && !(extension === ".zip" && this.validation.platform === "macos"))) throw new ContractError("MEDIA_UNSUPPORTED", "Unsupported selected package.");
        const bytes = await fileBytes(file, path.parse(file).root, MAX_PACKAGE_BYTES);
        const handle = inputSnapshotHandle(), fileName = handle + extension;
        await durableBytes(path.join(this.directory, fileName), this.directory, bytes);
        created = fileName;
        const snapshot = { fileName, sha256: byteHash(bytes), byteLength: bytes.byteLength };
        await this.decode(snapshot); await syncDirectory(this.directory);
        const grant: SourceGrant = { handle, name, extension, byteLength: bytes.byteLength, expiresAt: new Date(Date.now() + 1800000).toISOString() };
        accepted.set(handle, { grant, file: snapshot }); result.sources.push(grant);
      } catch (error) {
        if (created) try { await unlink(path.join(this.directory, created)); } catch { }
        const response = failure(null, error); result.failures.push({ name: boundedText(name, 255) ? name : "所选主题包", error: response.ok ? { code: "IO_ERROR", message: "Package selection failed.", retryable: false } : response.error });
      }
    }
    if (accepted.size) {
      for (const [handle, entry] of this.grants) if (!entry.file.fileName.endsWith(".community.zip") || Date.parse(entry.grant.expiresAt) <= Date.now()) this.grants.delete(handle);
      for (const [handle, entry] of accepted) { this.grants.set(handle, entry); this.owned.add(entry.file.fileName); }
      await this.prune();
    }
    return result;
  }
  get(handle: string): SnapshotFile {
    const entry = this.grants.get(handle);
    if (!entry || Date.parse(entry.grant.expiresAt) <= Date.now()) throw new ContractError("RESOURCE_EXPIRED", "Select this package again; its authorization expired.");
    return structuredClone(entry.file);
  }
  async registerCommunity(bytes: Uint8Array, metadata: CommunityMetadata): Promise<CommunityDownload> {
    const payload = await decodeThemePackage(bytes, ".zip", this.validation, true); await this.budget();
    // Provenance records what was actually downloaded, not what the listing claimed.
    const sha256 = byteHash(bytes), handle = inputSnapshotHandle(), file: SnapshotFile = { fileName: handle + ".community.zip", sha256, byteLength: bytes.byteLength,
      community: { version: metadata.id, packageSha256: sha256 } };
    await durableBytes(path.join(this.directory, file.fileName), this.directory, bytes);
    await syncDirectory(this.directory);
    const grant: SourceGrant = { handle, name: metadata.name + ".zip", extension: ".zip", byteLength: bytes.byteLength, expiresAt: new Date(Date.now() + 1800000).toISOString() };
    this.owned.add(file.fileName);
    this.grants.set(handle, { grant, file }); return { source: structuredClone(grant), details: describePackage(payload), origin: { version: metadata.id, packageSha256: sha256 } };
  }
  async read(raw: unknown): Promise<Uint8Array> {
    if (!record(raw) || Object.keys(raw).some(key => !["fileName", "sha256", "byteLength", "community"].includes(key)) ||
        typeof raw.fileName !== "string" || !/^[a-f0-9]{48}\.(cdskin|zip|community\.zip)$/.test(raw.fileName) ||
        typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.sha256) || typeof raw.byteLength !== "number" || !Number.isSafeInteger(raw.byteLength) || raw.byteLength < 1 || raw.byteLength > MAX_PACKAGE_BYTES) throw new ContractError("INVALID_REQUEST", "Invalid package snapshot descriptor.");
    if (raw.community !== undefined && (!raw.fileName.endsWith(".community.zip") || !communityOrigin(raw.community) ||
        communityOrigin(raw.community)!.packageSha256 !== raw.sha256)) throw new ContractError("INVALID_REQUEST", "Invalid community snapshot provenance.");
    const bytes = await fileBytes(path.join(this.directory, raw.fileName), this.directory, MAX_PACKAGE_BYTES);
    if (bytes.byteLength !== raw.byteLength || byteHash(bytes) !== raw.sha256) throw new ContractError("THEME_CHANGED", "The package snapshot changed."); return bytes;
  }
  async decode(file: SnapshotFile): Promise<PackagePayload> { return decodeThemePackage(await this.read(file), path.extname(file.fileName), this.validation, file.fileName.endsWith(".community.zip")); }
  async release(handles: string[]): Promise<number> { let count = 0; for (const handle of handles) if (this.grants.delete(handle)) count++; await this.prune(); return count; }
  pin(handle: string, operationId: string): void { this.pins.set(operationId, this.get(handle).fileName); }
  async finish(operationId: string): Promise<void> { this.pins.delete(operationId); await this.prune(); }
  async close(): Promise<void> { this.grants.clear(); await this.prune(); }
  revision(file: SnapshotFile): string { return sha256([Buffer.from(JSON.stringify(file))]); }
}
