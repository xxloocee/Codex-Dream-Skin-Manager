import https from "node:https";
import { ContractError, parseCommunityQuery } from "../contracts/manager.mjs";
import type { CommunityQuery } from "../contracts/manager.mjs";
import type { CommunityHTTP } from "../core/community.mjs";

// Bundled Node TLS adapter on both platforms. The UI cannot supply a URL,
// credentials, proxy, headers or a redirect policy.
export class FixedCommunityHTTP implements CommunityHTTP {
  private readonly pending = new Set<() => void>();
  private closed = false;
  async read(version: string, download: boolean, maximum: number): Promise<Uint8Array> {
    if (this.closed || /^ver_[a-z0-9]{8,64}$/.exec(version)?.[0] !== version) return Promise.reject(new ContractError("INVALID_REQUEST", "Invalid community request."));
    return (await this.request(`/v1/themes/${version}${download ? "/download" : ""}`, [download ? "application/zip" : "application/json"], maximum)).bytes;
  }
  async list(query: CommunityQuery): Promise<Uint8Array> {
    parseCommunityQuery(query);
    const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset), sort: query.sort });
    if (query.query) params.set("q", query.query);
    if (query.appearance !== "all") params.set("appearance", query.appearance);
    return (await this.request(`/v1/themes?${params}`, ["application/json"], 512 * 1024)).bytes;
  }
  async image(version: string, variant: "thumbnail" | "preview"): Promise<{ bytes: Uint8Array; extension: string }> {
    if (/^ver_[a-z0-9]{8,64}$/.exec(version)?.[0] !== version || !["thumbnail", "preview"].includes(variant)) throw new ContractError("INVALID_REQUEST", "Invalid community preview.");
    const result = await this.request(`/v1/themes/${version}/preview/${variant === "thumbnail" ? "thumbnail" : "background"}`,
      ["image/jpeg", "image/png", "image/webp"], (variant === "thumbnail" ? 2 : 12) * 1024 * 1024);
    return { bytes: result.bytes, extension: imageExtension(result.type, result.bytes) };
  }
  private request(relative: string, types: string[], maximum: number): Promise<{ bytes: Uint8Array; type: string }> {
    if (this.closed) return Promise.reject(new ContractError("BACKEND_UNAVAILABLE", "社区会话已关闭。"));
    const url = new URL(relative, "https://api.dreamskin.cc");
    return new Promise((resolve, reject) => {
      let settled = false; const chunks: Buffer[] = []; let length = 0;
      const finish = (error?: Error, bytes?: Uint8Array, type = "") => {
        if (settled) return; settled = true; this.pending.delete(cancel);
        if (error) { request.destroy(); reject(error); } else resolve({ bytes: bytes!, type });
      };
      const request = https.get(url, { agent: false, timeout: 20000, maxHeaderSize: 16384,
        headers: { Accept: types.join(", "), "Accept-Encoding": "identity", "Cache-Control": "no-store", "User-Agent": "CodexDreamSkinManager" } }, response => {
        const type = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (response.statusCode !== 200) { response.destroy(); finish(new ContractError("IO_ERROR", `社区服务返回 HTTP ${response.statusCode ?? "未知状态"}。`)); return; }
        response.on("data", (chunk: Buffer) => {
          length += chunk.byteLength;
          if (length > maximum) { response.destroy(); finish(new ContractError("THEME_INVALID", "社区响应超过允许大小。")); } else chunks.push(chunk);
        });
        response.on("end", () => {
          if (!response.complete || length < 1) finish(new ContractError("IO_ERROR", "社区响应不完整。"));
          else finish(undefined, Buffer.concat(chunks, length), type);
        });
        response.on("error", () => finish(new ContractError("IO_ERROR", "社区下载连接中断；未自动重试。")));
        response.on("aborted", () => finish(new ContractError("IO_ERROR", "社区响应被中断。")));
      });
      const cancel = () => finish(new ContractError("BACKEND_UNAVAILABLE", "社区连接已关闭。"));
      this.pending.add(cancel);
      request.on("timeout", () => finish(new ContractError("TIMEOUT", "社区连接 20 秒内没有数据。")));
      request.on("error", () => finish(new ContractError("IO_ERROR", "无法读取固定社区服务；未自动重试。")));
    });
  }
  close(): void { this.closed = true; for (const cancel of [...this.pending]) cancel(); }
}

// The server's content-type is trusted when it names an image; otherwise the
// bytes decide, so a generic type never blocks a preview.
function imageExtension(type: string, bytes: Uint8Array): string {
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  return ".webp";
}
