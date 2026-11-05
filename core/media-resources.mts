import { randomBytes, createHash } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ContractError, PROTOCOL } from "../contracts/manager.mjs";
import type { MediaResource, MethodMap } from "../contracts/manager.mjs";
import { fileStamp, MAX_MEDIA_BYTES, optionalBytes, safePath } from "./local-files.mjs";
import type { LocalTheme } from "./ports/platform.mjs";
import { readThemeContent, themeListStamp } from "./theme-model.mjs";

// Private native transport: never relay this envelope to the web page.
export interface ResourceRegistration {
  protocol: typeof PROTOCOL; kind: "resource.register"; backendSessionId: string;
  resourceId: string; fileName: string; sha256: string; variant: "thumbnail" | "preview"; expiresAt: string;
}
export interface ResourceRelease {
  protocol: typeof PROTOCOL; kind: "resource.release"; backendSessionId: string; resourceId: string;
}
export class MediaResources {
  private readonly files = new Map<string, { file: string; expires: number; key: string; session: string; stamp: string | undefined; result: Omit<MediaResource, "leaseId">; leases: Set<string> }>();
  private readonly leases = new Map<string, string>();
  private totalBytes = 0;
  private preparingCount = 0;
  private preparingBytes = 0;
  private readonly sizes = new Map<string, number>();
  private readonly cleanup = setInterval(() => {
    for (const [id, file] of this.files) if (file.expires <= Date.now()) void this.remove(id).catch(() => {});
  }, 30000).unref();
  constructor(private readonly directory: string, private readonly origin: string,
    private readonly register: (message: ResourceRegistration | ResourceRelease) => Promise<void>,
    private readonly inspect: (bytes: Uint8Array, extension: string) => Promise<void>,
    private readonly postersDirectory?: string) {
    if (!path.isAbsolute(directory) || !["https://media.dreamskin.invalid", "dreamskin-media://resource"].includes(origin)) {
      throw new ContractError("INVALID_REQUEST", "Invalid native media configuration.");
    }
  }
  async resolve(local: LocalTheme, params: MethodMap["media.resolve"]["params"], session: string): Promise<MediaResource> {
    await safePath(this.directory, this.directory);
    const now = Date.now();
    for (const [id, file] of this.files) if (file.expires <= now) await this.remove(id);
    const key = `${local.ref.source}:${local.ref.id}:${params.revision}:${params.variant}`;
    const stamp = await themeListStamp(local);
    const cached = this.cached(key, now, session, stamp); if (cached) return cached;
    // Busy retries must not repeatedly read/hash large custom videos while earlier URLs load.
    // Presets may use tiny bundled posters, so their actual cost is checked after substitution.
    if (local.ref.source === "saved") {
      const bytes = Number((await fileStamp(local.mediaPath, local.mediaRoot))[3]);
      if (bytes > 0 && bytes <= MAX_MEDIA_BYTES) this.requireCapacity(bytes);
    }
    const { details, media } = await readThemeContent(local);
    if (details.revision !== params.revision || await themeListStamp(local) !== stamp) throw new ContractError("THEME_CHANGED", "Refresh the theme before previewing it.", true);
    return this.resolveBytes(media, path.extname(local.mediaPath).toLowerCase(), key, params.variant, session, stamp);
  }
  async resolveBytes(bytes: Uint8Array, extension: string, key: string, variant: "thumbnail" | "preview", session: string, stamp?: string): Promise<MediaResource> {
    await safePath(this.directory, this.directory);
    for (const [id, file] of this.files) if (file.expires <= Date.now()) await this.remove(id);
    const cached = this.cached(key, Date.now(), session, stamp); if (cached) return cached;
    if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new ContractError("MEDIA_UNSUPPORTED", "Preview media exceeds its size limit.");
    await this.inspect(bytes, extension);
    if (extension === ".mp4" && this.postersDirectory) {
      // Send the small bundled image to the host, rather than copying every
      // full video into the 256 MiB session budget during thumbnail warmup.
      const digest = createHash("sha256").update(bytes).digest("hex");
      try {
        const poster = await optionalBytes(path.join(this.postersDirectory, digest + ".jpg"), this.postersDirectory, 8 * 1024 * 1024);
        if (poster) { await this.inspect(poster, ".jpg"); bytes = poster; extension = ".jpg"; }
      } catch { /* Missing or damaged posters fall back to native video extraction. */ }
    }
    this.requireCapacity(bytes.byteLength);
    // Keep returned URLs pinned until their consumers finish, including before the native GET.
    // Return BUSY rather than waiting: the serial transport must remain free to accept releases.
    while (this.files.size + this.preparingCount >= 64 || this.totalBytes + this.preparingBytes + bytes.byteLength > 256 * 1024 * 1024) {
      const available = [...this.files].find(([, entry]) => !entry.leases.size);
      if (!available) throw new ContractError("BUSY", "Preview resources are still loading; try again shortly.", true);
      await this.remove(available[0]);
    }
    const resourceId = randomBytes(24).toString("hex");
    const fileName = resourceId + extension;
    const file = path.join(this.directory, fileName), expires = Date.now() + 5 * 60 * 1000;
    const result: Omit<MediaResource, "leaseId"> = { resourceId, url: `${this.origin}/${resourceId}`, mimeType: "image/png", expiresAt: new Date(expires).toISOString() };
    // Concurrent community reads reserve capacity before the first disk await.
    this.preparingCount++; this.preparingBytes += bytes.byteLength;
    try {
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
      this.files.set(resourceId, { file, expires, key, session, stamp, result, leases: new Set() });
      this.sizes.set(resourceId, bytes.byteLength); this.totalBytes += bytes.byteLength;
    } finally { this.preparingCount--; this.preparingBytes -= bytes.byteLength; }
    try {
      // Pin while the host registers it so another read cannot evict it first.
      const leased = this.lease(resourceId);
      await this.register({ protocol: PROTOCOL, kind: "resource.register", backendSessionId: session,
        resourceId, fileName, sha256: createHash("sha256").update(bytes).digest("hex"), variant, expiresAt: result.expiresAt });
      return leased;
    } catch (error) { await this.remove(resourceId); throw error; }
  }
  cachedCommunity(version: string, variant: "thumbnail" | "preview", session: string): MediaResource | null {
    return this.cached(`community:${version}:${variant}`, Date.now(), session);
  }
  private requireCapacity(bytes: number): void {
    let count = 0, size = 0;
    for (const [id, entry] of this.files) if (entry.leases.size) { count++; size += this.sizes.get(id) ?? 0; }
    if (count + this.preparingCount >= 64 || size + this.preparingBytes + bytes > 256 * 1024 * 1024) {
      throw new ContractError("BUSY", "Preview resources are still loading; try again shortly.", true);
    }
  }
  private lease(resourceId: string): MediaResource {
    if (this.leases.size >= 256) throw new ContractError("BUSY", "Too many preview consumers are still loading.", true);
    const entry = this.files.get(resourceId)!;
    const leaseId = randomBytes(24).toString("hex");
    entry.leases.add(leaseId); this.leases.set(leaseId, resourceId);
    return { ...entry.result, leaseId };
  }
  release(leaseId: string, session: string): { released: boolean } {
    const resourceId = this.leases.get(leaseId), entry = resourceId ? this.files.get(resourceId) : undefined;
    if (!entry || entry.session !== session) return { released: false };
    this.leases.delete(leaseId);
    return { released: entry.leases.delete(leaseId) };
  }
  private cached(key: string, now: number, session: string, stamp?: string): MediaResource | null {
    for (const [id, file] of this.files) if (file.key === key && file.session === session && file.stamp === stamp && file.expires > now + 30000) {
      this.files.delete(id); this.files.set(id, file);
      return this.lease(id);
    }
    return null;
  }
  private async remove(id: string): Promise<void> {
    const entry = this.files.get(id);
    if (!entry) return;
    // Claim removal before yielding so timer/eviction/close cannot double-count.
    this.totalBytes -= this.sizes.get(id) ?? 0; this.sizes.delete(id); this.files.delete(id);
    for (const leaseId of entry.leases) this.leases.delete(leaseId);
    try {
      await this.register({ protocol: PROTOCOL, kind: "resource.release", backendSessionId: entry.session, resourceId: id });
    } finally {
      try { await unlink(entry.file); } catch { /* native host also cleans its own session directory on exit */ }
    }
  }
  async close(): Promise<void> { clearInterval(this.cleanup); for (const id of this.files.keys()) await this.remove(id).catch(() => {}); }
}
