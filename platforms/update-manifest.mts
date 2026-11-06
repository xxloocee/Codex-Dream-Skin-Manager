import { createPublicKey, verify } from "node:crypto";
import { jsonObject, sha256 } from "../core/local-files.mjs";

// Network problems are retryable and expected behind unstable GitHub access;
// trust problems mean the release itself must not be used.
export class ManifestNetworkError extends Error {}
export class ManifestTrustError extends Error {}
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface VerifiedManifest { manifest: Buffer; manifestDigest: string; publicKeyDigest: string }

const hosts = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function downloadManifest(url: string, limit: number, fetcher: Fetcher = fetch): Promise<Buffer> {
  const signal = AbortSignal.timeout(20000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !hosts.has(parsed.hostname)) throw new ManifestTrustError("Update URL is outside the allowed GitHub hosts.");
    let response: Response;
    try { response = await fetcher(url, { redirect: "manual", signal, headers: { Accept: "application/octet-stream", "User-Agent": "CodexDreamSkinManager", "Cache-Control": "no-cache" } }); }
    catch (error) { throw new ManifestNetworkError(error instanceof Error ? error.message : "Network request failed."); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw new ManifestNetworkError("Redirect without location.");
      url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      // A missing release asset (4xx) is a publishing problem, not a connectivity one.
      throw response.status >= 500 || response.status === 429 ? new ManifestNetworkError(`HTTP ${response.status}`) : new ManifestTrustError(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new ManifestTrustError("Update manifest is too large."); }
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) { await response.body.cancel().catch(() => {}); throw new ManifestTrustError("Update manifest is too large."); }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof ManifestTrustError) throw error;
      throw new ManifestNetworkError(error instanceof Error ? error.message : "Download interrupted.");
    }
    if (!size) throw new ManifestTrustError("Empty update manifest.");
    return Buffer.concat(chunks);
  }
  throw new ManifestNetworkError("Too many update redirects.");
}

export async function verifiedReleaseManifest(repository: string, keyBytes: Uint8Array, fetcher: Fetcher = fetch): Promise<VerifiedManifest> {
  let key;
  try { key = createPublicKey(Buffer.from(keyBytes)); } catch { throw new ManifestTrustError("Invalid updater key."); }
  if (key.asymmetricKeyType !== "ed25519") throw new ManifestTrustError("Invalid updater key.");
  const manifest = await downloadManifest(`https://github.com/${repository}/releases/latest/download/update.json`, 1048576, fetcher);
  // The unverified tag is used only to select the fixed repository's signature.
  let discovery: Record<string, unknown>;
  try { discovery = jsonObject(manifest); } catch { throw new ManifestTrustError("Update manifest is not JSON."); }
  const tag = discovery.tag_name;
  if (typeof tag !== "string" || tag.length > 65 || stableTag.exec(tag)?.[0] !== tag) throw new ManifestTrustError("Invalid release tag.");
  const signature = (await downloadManifest(`https://github.com/${repository}/releases/download/${tag}/update.json.sig`, 1024, fetcher)).toString("ascii").trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature) || !verify(null, manifest, key, Buffer.from(signature, "base64"))) throw new ManifestTrustError("Invalid update signature.");
  if (discovery.schemaVersion !== 1 || discovery.draft !== false || discovery.prerelease !== false || discovery.html_url !== `https://github.com/${repository}/releases/tag/${tag}`) throw new ManifestTrustError("Invalid signed release.");
  return { manifest, manifestDigest: sha256([manifest]), publicKeyDigest: sha256([keyBytes]) };
}
