import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { ManifestNetworkError, ManifestTrustError, verifiedReleaseManifest } from "../build/shared/platforms/update-manifest.mjs";

const repo = "owner/repo", tag = "v1.2.3";
const latestUrl = `https://github.com/${repo}/releases/latest/download/update.json`;
const tagUrl = `https://github.com/${repo}/releases/download/${tag}/update.json`;
const sigUrl = tagUrl + ".sig";
const publisher = generateKeyPairSync("ed25519"), stranger = generateKeyPairSync("ed25519");
const pem = key => Buffer.from(key.export({ type: "spki", format: "pem" }));
const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, tag_name: tag, html_url: `https://github.com/${repo}/releases/tag/${tag}`, draft: false, prerelease: false, assets: [] }));
const signature = (bytes, key = publisher.privateKey) => Buffer.from(sign(null, bytes, key).toString("base64") + "\n");

function fetcher(routes) {
  return async url => {
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (typeof route === "number") return new Response(null, { status: route });
    if (typeof route === "string") return new Response(null, { status: 302, headers: { location: route } });
    if (!route) return new Response(null, { status: 404 });
    return new Response(route, { status: 200 });
  };
}
const release = (body = manifest, sig = signature(manifest)) => fetcher({ [latestUrl]: tagUrl, [tagUrl]: body, [sigUrl]: sig });

test("accepts a manifest signed by the pinned key, following the latest redirect", async () => {
  const result = await verifiedReleaseManifest(repo, pem(publisher.publicKey), release());
  assert.deepEqual(result.manifest, manifest);
  assert.match(result.manifestDigest, /^[a-f0-9]{64}$/);
  assert.match(result.publicKeyDigest, /^[a-f0-9]{64}$/);
});

test("rejects a tampered manifest", async () => {
  const tampered = Buffer.from(manifest.toString().replace('"assets":[]', '"assets":[{}]'));
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), release(tampered, signature(manifest))), ManifestTrustError);
});

test("rejects a signature from another key", async () => {
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), release(manifest, signature(manifest, stranger.privateKey))), ManifestTrustError);
});

test("a release without update.json.sig is a trust failure, not a network failure", async () => {
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), fetcher({ [latestUrl]: tagUrl, [tagUrl]: manifest })), ManifestTrustError);
});

test("connection errors and server errors are reported as network failures", async () => {
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), fetcher({ [latestUrl]: new TypeError("fetch failed") })), ManifestNetworkError);
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), fetcher({ [latestUrl]: 503 })), ManifestNetworkError);
});

test("refuses redirects outside the GitHub allowlist", async () => {
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), fetcher({ [latestUrl]: "https://evil.example/update.json" })), ManifestTrustError);
});

test("rejects a correctly signed manifest that is not a stable release", async () => {
  const draft = Buffer.from(manifest.toString().replace('"draft":false', '"draft":true'));
  await assert.rejects(verifiedReleaseManifest(repo, pem(publisher.publicKey), release(draft, signature(draft))), ManifestTrustError);
});
