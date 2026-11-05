import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { boundedText, ContractError, failure, record } from "../contracts/manager.mjs";
import type { CommunityOrigin, SourceGrant, SourceSelection } from "../contracts/manager.mjs";
import { fileBytes, jsonObject, MAX_MEDIA_BYTES, sha256 } from "./local-files.mjs";
import { durableBytes, privateDirectory, syncDirectory } from "./write-files.mjs";

export interface SnapshotFile { fileName: string; sha256: string; byteLength: number; community?: CommunityOrigin }
export interface SourceSnapshot { media: SnapshotFile; original: SnapshotFile | null }
const formats = [".png", ".apng", ".jpg", ".jpeg", ".webp", ".gif", ".mp4"];
const convertedFormats = [".heic", ".tif", ".tiff"];
export type SourceConverter = (sourceFile: string, destinationFile: string) => Promise<void>;
export const byteHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// A recognizable owner PID lets later sessions reclaim only inputs from a
// dead manager. Existing unmarked files and ambiguous process identities stay.
export function inputSnapshotHandle(): string {
  return "d5c0" + process.pid.toString(16).padStart(8, "0") + randomBytes(18).toString("hex");
}
export async function pruneOrphanInputs(directory: string): Promise<void> {
  const state = path.dirname(path.dirname(directory)), requests = path.join(state, "manager-operations", "library-requests");
  const referenced = new Set<string>();
  let names: string[];
  try { names = await readdir(requests); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; names = []; }
  for (const name of names) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const request = jsonObject(await fileBytes(path.join(requests, name), requests, 16384));
      const source = request.source;
      if (record(source)) for (const file of [source, source.media, source.original]) if (record(file) && typeof file.fileName === "string") referenced.add(file.fileName);
    } catch { return; } // Unreadable intent may still own an input.
  }
  for (const name of await readdir(directory)) {
    const match = /^d5c0([a-f0-9]{8})[a-f0-9]{36}\.(?:png|apng|jpe?g|webp|gif|mp4|heic|tiff?|cdskin|zip|community\.zip)$/.exec(name);
    if (!match || referenced.has(name)) continue;
    const owner = parseInt(match[1]!, 16); if (owner < 1) continue;
    try { process.kill(owner, 0); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue; }
    // unlink never traverses a leaf symlink; only our marked, unreferenced file.
    await unlink(path.join(directory, name)).catch(() => {});
  }
}

// Only the native stdin channel can register paths. Grants never contain them.
export class SourceSnapshots {
  readonly directory: string;
  private readonly grants = new Map<string, { grant: SourceGrant; snapshot: SourceSnapshot }>();
  private readonly owned = new Set<string>();
  private readonly pins = new Map<string, Set<string>>();
  constructor(state: string, private readonly platform: "windows" | "macos",
    private readonly inspect: (bytes: Uint8Array, extension: string) => Promise<void>, private readonly convertSource?: SourceConverter) {
    this.directory = path.join(state, "manager-operations", "source-snapshots");
  }
  private async budget(): Promise<void> {
    await privateDirectory(this.directory);
    await pruneOrphanInputs(this.directory);
    for (const [handle, entry] of this.grants) if (Date.parse(entry.grant.expiresAt) <= Date.now()) this.grants.delete(handle);
    await this.prune();
  }
  private async prune(): Promise<void> {
    const active = new Set<string>();
    for (const entry of this.grants.values()) {
      active.add(entry.snapshot.media.fileName); if (entry.snapshot.original) active.add(entry.snapshot.original.fileName);
    }
    for (const names of this.pins.values()) for (const name of names) active.add(name);
    for (const name of this.owned) {
      if (active.has(name) || !/^[a-f0-9]{48}\.(png|apng|jpe?g|webp|gif|mp4|heic|tiff?)$/.test(name)) continue;
      try { await unlink(path.join(this.directory, name)); this.owned.delete(name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; this.owned.delete(name); }
    }
  }
  async register(paths: string[]): Promise<SourceSelection> {
    await this.budget();
    for (const [handle, value] of this.grants) if (Date.parse(value.grant.expiresAt) <= Date.now()) this.grants.delete(handle);
    if (paths.length < 1 || paths.length > 32) throw new ContractError("BUSY", "Select at most 32 source files.");
    const selectedGrants = new Map<string, { grant: SourceGrant; snapshot: SourceSnapshot }>();
    // The editor and console may own separate selections. Retain both until
    // explicit release/expiry, within a bounded session budget.
    let retainedBytes = [...this.grants.values()].reduce((total, value) => total + value.snapshot.media.byteLength + (value.snapshot.original?.byteLength ?? 0), 0);
    const result: SourceSelection = { cancelled: false, sources: [], failures: [] };
    for (const file of paths) {
      const name = path.basename(file);
      const created: string[] = [];
      try {
        if (this.grants.size + selectedGrants.size >= 64) throw new ContractError("BUSY", "Too many selected sources are still in use. Finish the current import first.");
        if (!path.isAbsolute(file) || !boundedText(name, 255)) throw new ContractError("INVALID_REQUEST", "Invalid selected file.");
        const extension = path.extname(file).toLowerCase(), convert = this.platform === "macos" && convertedFormats.includes(extension);
        if (!formats.includes(extension) && !convert) throw new ContractError("MEDIA_UNSUPPORTED", "This selected media format is unsupported.");
        const bytes = await fileBytes(file, path.parse(file).root, MAX_MEDIA_BYTES);
        if (retainedBytes + bytes.byteLength > 32 * MAX_MEDIA_BYTES) throw new ContractError("BUSY", "Selected sources exceed the session storage budget.");
        const handle = inputSnapshotHandle(), fileName = handle + extension;
        await durableBytes(path.join(this.directory, fileName), this.directory, bytes);
        created.push(fileName);
        const describe = (fileName: string, bytes: Uint8Array): SnapshotFile => ({ fileName, sha256: byteHash(bytes), byteLength: bytes.byteLength });
        let media = describe(fileName, bytes), original: SnapshotFile | null = null;
        if (convert) {
          const png = handle + ".png";
          try {
            if (!this.convertSource) throw new Error();
            created.push(png);
            await this.convertSource(path.join(this.directory, fileName), path.join(this.directory, png));
          }
          catch { throw new ContractError("MEDIA_UNSUPPORTED", "The native image conversion could not complete."); }
          const converted = await fileBytes(path.join(this.directory, png), this.directory, MAX_MEDIA_BYTES);
          // sips wrote the private file; reopen and sync it through the same durable snapshot boundary.
          const { open } = await import("node:fs/promises");
          const fd = await open(path.join(this.directory, png), "r+"); try { await fd.sync(); } finally { await fd.close(); }
          original = media; media = describe(png, converted);
        }
        const snapshot = { media, original };
        const snapshotBytes = media.byteLength + (original?.byteLength ?? 0);
        if (retainedBytes + snapshotBytes > 32 * MAX_MEDIA_BYTES) throw new ContractError("BUSY", "Selected sources exceed the session storage budget.");
        await this.inspect(await this.read(media), path.extname(media.fileName));
        await syncDirectory(this.directory);
        const grant: SourceGrant = { handle, name, extension: path.extname(media.fileName), byteLength: media.byteLength,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
        selectedGrants.set(handle, { grant, snapshot }); result.sources.push(grant); retainedBytes += snapshotBytes;
      } catch (error) {
        // A rejected selection never becomes part of a future transaction.
        for (const fileName of created) try { await unlink(path.join(this.directory, fileName)); } catch { }
        const response = failure(null, error);
        result.failures.push({ name: boundedText(name, 255) ? name : "所选素材", error: response.ok ? { code: "IO_ERROR", message: "Source selection failed.", retryable: false } : response.error });
      }
    }
    if (selectedGrants.size) {
      for (const [handle, value] of selectedGrants) {
        this.grants.set(handle, value); this.owned.add(value.snapshot.media.fileName);
        if (value.snapshot.original) this.owned.add(value.snapshot.original.fileName);
      }
      await this.prune();
    }
    return result;
  }
  get(handle: string): SourceSnapshot {
    const entry = this.grants.get(handle);
    if (!entry || Date.parse(entry.grant.expiresAt) <= Date.now()) throw new ContractError("RESOURCE_EXPIRED", "Select the source again; its authorization expired.");
    return structuredClone(entry.snapshot);
  }
  async read(file: SnapshotFile): Promise<Uint8Array> {
    if (!/^[a-f0-9]{48}\.(png|apng|jpe?g|webp|gif|mp4|heic|tiff?)$/.test(file.fileName) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > MAX_MEDIA_BYTES) {
      throw new ContractError("INVALID_REQUEST", "Invalid source snapshot.");
    }
    const bytes = await fileBytes(path.join(this.directory, file.fileName), this.directory, MAX_MEDIA_BYTES);
    if (bytes.byteLength !== file.byteLength || byteHash(bytes) !== file.sha256) throw new ContractError("THEME_CHANGED", "The source snapshot changed.");
    return bytes;
  }
  async release(handles: string[]): Promise<number> {
    let count = 0; for (const handle of handles) if (this.grants.delete(handle)) count++;
    await this.prune(); return count;
  }
  pin(handle: string, operationId: string): void {
    const snapshot = this.get(handle), names = new Set([snapshot.media.fileName, ...(snapshot.original ? [snapshot.original.fileName] : [])]);
    this.pins.set(operationId, names);
  }
  async finish(operationId: string): Promise<void> { this.pins.delete(operationId); await this.prune(); }
  async close(): Promise<void> { this.grants.clear(); await this.prune(); }
  revision(snapshot: SourceSnapshot): string { return sha256([new TextEncoder().encode(JSON.stringify(snapshot))]); }
}
