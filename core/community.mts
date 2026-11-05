import { randomBytes } from "node:crypto";
import { ContractError, parseCommunityQuery, record } from "../contracts/manager.mjs";
import type { CommunityDownload, CommunityMetadata, CommunityPage, CommunityProposal, CommunityQuery, CommunityTheme } from "../contracts/manager.mjs";
import type { PackageSources } from "./package-sources.mjs";
import { MAX_PACKAGE_BYTES } from "./package-zip.mjs";
import { communityCompatibility } from "./community-origin.mjs";

export interface CommunityHTTP {
  read(version: string, download: boolean, maximum: number): Promise<Uint8Array>;
  list(query: CommunityQuery): Promise<Uint8Array>;
  image(version: string, variant: "thumbnail" | "preview"): Promise<{ bytes: Uint8Array; extension: string }>;
  close(): void;
}
export function communityVersion(link: string): string {
  const match = /^dreamskin:\/\/apply\?version=(ver_[a-z0-9]{8,64})$/.exec(link);
  if (!match || match[0] !== link) throw new ContractError("INVALID_REQUEST", "只支持完整的 Dream Skin 社区应用链接。");
  return match[1]!;
}
function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function count(value: unknown): number { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0; }
function json(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8").decode(bytes)); } catch { throw new ContractError("THEME_INVALID", "社区返回的内容不是有效的 JSON。"); }
}
const versionPattern = /^ver_[a-z0-9]{8,64}$/;
// Descriptive fields are display-only: a missing or odd value falls back to a
// placeholder instead of blocking the theme. Only the id decides usability.
function metadata(value: unknown, version?: string): CommunityMetadata {
  if (!record(value) || typeof value.id !== "string" || !versionPattern.test(value.id) || version !== undefined && value.id !== version) {
    throw new ContractError("THEME_INVALID", "社区返回的主题信息缺少有效标识。");
  }
  return { id: value.id, themeId: text(value.themeId, value.id), name: text(value.name, value.id), version: text(value.version, "-"),
    authorDisplayName: text(value.authorDisplayName, "-"), license: text(value.license, "-"),
    packageSha256: typeof value.packageSha256 === "string" ? value.packageSha256 : "", packageBytes: count(value.packageBytes), applyCompatible: value.applyCompatible !== false,
    compatibility: communityCompatibility({ ...value, ...(record(value.displayMeta) ? value.displayMeta : {}) }) };
}
export function communityMetadata(bytes: Uint8Array, version: string): CommunityMetadata { return metadata(json(bytes), version); }
export function communityPage(bytes: Uint8Array, query: CommunityQuery): CommunityPage {
  const value = json(bytes);
  if (!record(value) || !Array.isArray(value.items)) throw new ContractError("THEME_INVALID", "社区主题列表格式无法识别。");
  const ids = new Set<string>(), items: CommunityTheme[] = [];
  // One malformed entry must not hide the rest of the page.
  for (const item of value.items as unknown[]) {
    let meta: CommunityMetadata;
    try { meta = metadata(item); } catch { continue; }
    if (ids.has(meta.id)) continue;
    ids.add(meta.id);
    const raw = item as Record<string, unknown>, displayMeta = record(raw.displayMeta) ? raw.displayMeta : {};
    const platforms: CommunityTheme["platforms"] = Array.isArray(displayMeta.platforms) ?
      [...new Set(displayMeta.platforms.filter((platform): platform is "windows" | "macos" => platform === "windows" || platform === "macos"))] : [];
    const appearance = displayMeta.appearance;
    items.push({ ...meta, platforms, appearance: appearance === "auto" || appearance === "light" || appearance === "dark" ? appearance : null,
      downloadCount: count(raw.downloadCount), favoriteCount: count(raw.favoriteCount), downloaded: null });
  }
  return { items, total: Math.max(count(value.total), query.offset + items.length), limit: query.limit, offset: query.offset };
}
interface Ticket { proposal: CommunityProposal; job?: Promise<CommunityDownload> }
// Tickets only bind "inspect" to "download" for the bridge contract; they carry no
// expiry or concurrency limits. A failed download may simply be retried.
export class Community {
  private readonly tickets = new Map<string, Ticket>();
  private closed = false;
  constructor(private readonly http: CommunityHTTP, private readonly packages: PackageSources) {}
  private open(): void { if (this.closed) throw new ContractError("BACKEND_UNAVAILABLE", "社区会话已关闭。"); }
  async list(query: CommunityQuery): Promise<CommunityPage> {
    this.open();
    parseCommunityQuery(query);
    return communityPage(await this.http.list(query), query);
  }
  async image(version: string, variant: "thumbnail" | "preview"): Promise<{ bytes: Uint8Array; extension: string }> {
    this.open();
    return this.http.image(version, variant);
  }
  async inspect(link: string): Promise<CommunityProposal> {
    this.open();
    const version = communityVersion(link);
    const metadata = communityMetadata(await this.http.read(version, false, 65536), version);
    this.open();
    const proposal: CommunityProposal = { handle: randomBytes(24).toString("hex"), expiresAt: new Date(Date.now() + 300000).toISOString(), source: "https://api.dreamskin.cc", metadata };
    this.tickets.set(proposal.handle, { proposal });
    return structuredClone(proposal);
  }
  async download(handle: string): Promise<CommunityDownload> {
    this.open();
    const ticket = this.tickets.get(handle);
    if (!ticket) throw new ContractError("RESOURCE_EXPIRED", "请重新读取社区链接并确认下载。");
    if (ticket.job) return ticket.job;
    const meta = ticket.proposal.metadata;
    const job = (async () => {
      const bytes = await this.http.read(meta.id, true, MAX_PACKAGE_BYTES);
      this.open();
      return this.packages.registerCommunity(bytes, meta);
    })();
    ticket.job = job;
    // Concurrent callers share one run; a failure clears it so the user can retry.
    job.catch(() => { if (ticket.job === job) delete ticket.job; });
    return job;
  }
  async close(): Promise<void> {
    this.closed = true; this.http.close();
    await Promise.allSettled([...this.tickets.values()].flatMap(ticket => ticket.job ? [ticket.job] : []));
    this.tickets.clear();
  }
}
