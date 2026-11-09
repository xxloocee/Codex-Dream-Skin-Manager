import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
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

// Update handoff regressions use only a temporary ledger and fake platform.
async function updateFixture(t, overrides = {}) {
  const { mkdtemp, rm, realpath } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Updates } = await import("../build/shared/core/updates.mjs");
  const state = await realpath(await mkdtemp(join(tmpdir(), "dreamskin-update-handoff-")));
  const candidate = { currentVersion: "3.1.4", latestVersion: "3.1.5", channel: "macos-release", installMode: "macos-signed", binding: "fixture", releaseUrl: "https://github.com/owner/repo/releases/tag/v3.1.5", reason: "test", trust: "test" };
  const calls = { installs: 0, restarts: 0, receipt: null };
  const port = {
    async check() { return candidate; },
    async install() { calls.installs++; return { managerMustQuit: true }; },
    async restart() { calls.restarts++; },
    async receipt() { return calls.receipt; },
    ...overrides,
  };
  const session = randomUUID(), updates = new Updates(session, state, port, () => false);
  t.after(async () => { await updates.close(); await rm(state, { recursive: true, force: true }); });
  const proposal = await updates.check(), id = `${session}:${randomUUID()}`;
  await updates.install({ operationId: id, handle: proposal.handle, accepted: true });
  let op;
  for (let i = 0; i < 100; i++) {
    op = await updates.get(id);
    if (op.state === "handoff") break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(op.state, "handoff");
  return { updates, calls, id, state, port, Updates };
}

test("prepared update survives waiting beyond two minutes; querying never launches installer", async t => {
  const f = await updateFixture(t);
  t.mock.method(Date, "now", () => new Date("2099-01-01T00:00:00Z").getTime());
  for (let i = 0; i < 3; i++) assert.equal((await f.updates.get(f.id)).stage, "readyToRestart");
  assert.equal(f.calls.installs, 1);
  assert.equal(f.calls.restarts, 0);
  assert.deepEqual(await Promise.all([f.updates.quit(f.id), f.updates.quit(f.id)]), [{ quit: true }, { quit: true }]);
  assert.equal(f.calls.restarts, 1);
  assert.equal((await f.updates.get(f.id)).stage, "waitingForManagerExit");
  await f.updates.quit(f.id);
  assert.equal(f.calls.restarts, 1);
  f.calls.receipt = "failed";
  await assert.rejects(f.updates.quit(f.id), { code: "BUSY" });
  assert.equal((await f.updates.get(f.id)).state, "failed");
});

test("known installer launch failure retains prepared update for restart without redownload", async t => {
  const { UpdateNotStartedError } = await import("../build/shared/core/ports/updates.mjs");
  let attempts = 0;
  const f = await updateFixture(t, { async restart() { if (++attempts === 1) throw new UpdateNotStartedError("not started"); } });
  await assert.rejects(f.updates.quit(f.id), UpdateNotStartedError);
  assert.equal((await f.updates.get(f.id)).stage, "readyToRestart");
  assert.deepEqual(await f.updates.quit(f.id), { quit: true });
  assert.equal(attempts, 2);
  assert.equal(f.calls.installs, 1);
});

test("uncertain installer launch cannot be retried and reconciles from receipt", async t => {
  const f = await updateFixture(t, { async restart() { throw Error("lost launch response"); } });
  await assert.rejects(f.updates.quit(f.id), /lost launch/);
  assert.equal((await f.updates.get(f.id)).state, "indeterminate");
  await assert.rejects(f.updates.quit(f.id), { code: "BUSY" });
  f.calls.receipt = "installed";
  assert.equal((await f.updates.get(f.id)).state, "installed");
  assert.equal(f.updates.busy, false);
});

test("closing before restart leaves a definite non-install instead of blocking retries", async t => {
  const f = await updateFixture(t);
  await f.updates.close();
  const reopened = new f.Updates("next", f.state, f.port, () => false);
  t.after(() => reopened.close());
  assert.equal((await reopened.get(f.id)).stage, "preparedSessionClosed");
  assert.equal((await reopened.get(f.id)).state, "failed");
  await assert.rejects(reopened.quit(f.id), { code: "BUSY" });
  assert.equal(f.calls.restarts, 0);
  assert.equal((await reopened.check()).updateAvailable, true);
});

test("Windows installer handoff remains immediate and never requests manager restart", async t => {
  const f = await updateFixture(t, { async install() { return { managerMustQuit: false }; } });
  assert.equal((await f.updates.get(f.id)).stage, "installerStarted");
  await assert.rejects(f.updates.quit(f.id), { code: "BUSY" });
  assert.equal(f.calls.restarts, 0);
});

test("macOS platform prepares without spawning, then starts the staged helper on restart", { skip: process.platform !== "darwin" }, async t => {
  const { mkdtemp, mkdir, writeFile, readFile, realpath, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { PlatformUpdates } = await import("../build/shared/platforms/updates.mjs");
  const root = await realpath(await mkdtemp(join(tmpdir(), "dreamskin-platform-handoff-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = join(root, "state"), stage = join(state, "updates", "download-fixture"), app = join(stage, "payload", "Codex Dream Skin.app");
  const scripts = join(root, "macos", "scripts");
  await mkdir(app, { recursive: true }); await mkdir(scripts, { recursive: true });
  // This helper only writes a marker inside its temporary cwd. No real install.
  await writeFile(join(scripts, "gui-install-update.sh"), '#!/bin/bash\nprintf started > launched\n');
  const port = new PlatformUpdates(root, state), id = `${randomUUID()}:${randomUUID()}`;
  const candidate = { binding: "fixture", installMode: "macos-signed", currentVersion: "3.1.4", latestVersion: "3.1.5" };
  port.candidates.set("fixture", { raw: {}, repo: "owner/repo", bundle: "cc.dreamskin.manager", target: root });
  t.mock.method(port, "target", async () => root);
  t.mock.method(port, "signed", async () => ({ stage, stagedApp: app }));
  assert.deepEqual(await port.install(candidate, id), { managerMustQuit: true });
  await assert.rejects(readFile(join(stage, "launched")), { code: "ENOENT" });
  await assert.rejects(readFile(join(stage, "manager-install.log")), { code: "ENOENT" });
  await port.restart(id);
  let launched;
  for (let i = 0; i < 100; i++) {
    try { launched = await readFile(join(stage, "launched"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (launched) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(launched, "started");
  await assert.rejects(port.restart(id), { code: "IO_ERROR" });
});

test("restart waits for business operations and refuses after session close", async t => {
  const f = await updateFixture(t);
  t.mock.method(f.updates, "businessBusy", () => true);
  await assert.rejects(f.updates.quit(f.id), { code: "BUSY" });
  assert.equal(f.calls.restarts, 0);
  assert.equal((await f.updates.get(f.id)).stage, "readyToRestart");
  t.mock.method(f.updates, "businessBusy", () => false);
  await f.updates.close();
  await assert.rejects(f.updates.quit(f.id), { code: "BUSY" });
  assert.equal(f.calls.restarts, 0);
});
