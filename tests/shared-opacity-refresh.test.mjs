import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { WatcherLifecycle } from "../runtime/watcher-engine.mjs";
import { activeTheme } from "../build/shared/core/active-theme.mjs";
import { themeDetails } from "../build/shared/core/theme-model.mjs";
import { MacOSReadAdapter } from "../build/shared/platforms/macos/read-adapter.mjs";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const metadata = stat => ({ size: stat.size, mode: stat.mode, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });

test("macOS navigation keeps the latest desired payload after refresh verification fails", async () => {
  const source = await readFile(path.join(repo, "macos/scripts/injector.mjs"), "utf8");
  const start = source.indexOf("  const refreshPayload = async () => {");
  const end = source.indexOf("  const queuePayloadRefresh =", start);
  const eventStart = source.indexOf('          session.on("Page.loadEventFired", () => {');
  const eventEnd = source.indexOf("          const initialOperation = activeOperation;", eventStart);
  assert.ok(start >= 0 && end > start && eventStart >= 0 && eventEnd > eventStart);
  assert.ok(source.includes("const bootstrapPayload = desiredPayload;") && source.includes("const setupPayload = desiredPayload;"));
  for (const compatible of [true, false]) {
    const theme = { id: "fixture", name: "Fixture", opacityUpdateKey: "a".repeat(64), artMetadata: { video: true } };
    const original = { revision: "A", theme, payload: "A", mediaFilePath: "fixture.mp4", timings: { buildMs: 1 } };
    const updated = { ...original, revision: "B", payload: "B", theme: { ...theme, opacityUpdateKey: (compatible ? "a" : "b").repeat(64) } };
    let navigate, pass = false;
    const session = { closed: false, on(_event, callback) { navigate = callback; } };
    const record = { session, ready: true, needsLoadFallback: false, earlyScriptId: null, earlyScriptIds: new Set() };
    const lifecycle = new WatcherLifecycle({ sessionFor: value => value.session });
    lifecycle.sessions.set("fixture", record);
    const calls = [];
    const context = {
      current: original, desiredPayload: original, desiredOpacityOnly: false, publication: updated,
      lifecycle, sessions: lifecycle.sessions, session, record, target: { id: "fixture" },
      options: { timeoutMs: 1 }, waitForTargetSetups: async () => {},
      loadPayload: async () => context.publication, activeOperation: null, nextOperationToken: () => "fixture-token",
      presentOperationUi: async () => {}, registerEarlyForRecord: async () => "early", removeEarlyIdentifier: async () => {},
      applyLoadedToSession: async (_session, payload, options) => calls.push([payload.revision, options?.opacityOnly === true]),
      waitForVerifiedSession: async () => ({ pass }), setTimeout: callback => callback(), console: { log() {}, error() {} },
    };
    vm.runInNewContext(source.slice(start, end) + source.slice(eventStart, eventEnd) + "globalThis.refresh = refreshPayload;", context);
    await assert.rejects(context.refresh, /revision remains pending/);
    assert.equal(context.current, original);
    assert.equal(context.desiredPayload, updated);
    assert.deepEqual(calls, [["B", compatible]]);
    navigate();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), ["B", false], "Navigation must use B, not silently restore accepted-but-outdated A.");
    await assert.rejects(context.refresh, /revision remains pending/);
    assert.deepEqual(calls.at(-1), ["B", compatible], "An identical revision retry must retain its original update classification.");
    const opacityPublication = { ...updated, revision: "C", payload: "C" };
    context.publication = opacityPublication;
    await assert.rejects(context.refresh, /revision remains pending/);
    assert.equal(context.current, original);
    assert.deepEqual(calls.at(-1), ["C", true], "B-to-C opacity changes must stay strict even while accepted current is A.");
    navigate();
    await Promise.resolve();
    assert.deepEqual(calls.at(-1), ["C", false]);
    context.publication = original;
    pass = true;
    const beforeRevert = calls.length;
    await context.refresh();
    assert.equal(calls.length, beforeRevert + 1, "Returning to A must be applied even when the accepted baseline is still A.");
    assert.deepEqual(calls.at(-1), ["A", compatible]);
    assert.equal(context.desiredPayload, original);
  }
});

test("macOS opacity preparation uses a private sequential media cache without changing the active theme or user cache", {
  skip: process.platform !== "darwin", timeout: 60000,
}, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "dreamskin-opacity-prepare-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "isolated home"), temporary = path.join(root, "tmp");
  const state = path.join(home, "Library", "Application Support", "CodexDreamSkinStudio");
  const themeId = "opacity-video-fixture", library = path.join(state, "themes", themeId), active = path.join(state, "theme");
  const requests = path.join(state, "manager-operations", "requests");
  const cacheParent = path.join(home, "Library", "Caches", "CodexDreamSkinManager", "media-v1");
  const project = path.join(home, "projects", "example", "README.md"), chat = path.join(home, ".codex", "sessions", "fixture.jsonl");
  for (const directory of [temporary, library, active, requests, path.dirname(project), path.dirname(chat)]) await mkdir(directory, { recursive: true });
  const projectBytes = Buffer.from("Synthetic project sentinel; never modify.\n");
  const chatBytes = Buffer.from('{"fixture":true,"text":"Synthetic chat sentinel; never modify."}\n');
  await writeFile(project, projectBytes); await writeFile(chat, chatBytes);

  const fixture = Buffer.from(await readFile(path.join(repo, "tests", "fixtures", "h264-32x18-2fps.mp4.base64"), "utf8"), "base64");
  // Appending a free box preserves the fixture's sample offsets and valid MP4 structure.
  const padding = Buffer.alloc(8 * 1024 * 1024 + 8);
  padding.writeUInt32BE(padding.length, 0); padding.write("free", 4, "ascii");
  const media = Buffer.concat([fixture, padding]), mediaHash = hash(media);
  const base = { schemaVersion: 1, id: themeId, name: "Opacity fixture", image: "background.mp4", category: "custom", tags: [],
    appearance: "auto", art: { focusX: 0.5, focusY: 0.5, bubbleOpacity: 0.1, surfaceOpacity: 0.2 } };
  const activeBytes = Buffer.from(JSON.stringify(base) + "\n");
  const libraryBytes = Buffer.from(JSON.stringify({ ...base, art: { ...base.art, surfaceOpacity: 0.03 } }) + "\n");
  await writeFile(path.join(active, "theme.json"), activeBytes); await writeFile(path.join(active, "background.mp4"), media);
  await writeFile(path.join(library, "theme.json"), libraryBytes); await writeFile(path.join(library, "background.mp4"), media);
  const stateBytes = Buffer.from(JSON.stringify({ schemaVersion: 4, session: "active", themeId, fixture: true }) + "\n");
  await writeFile(path.join(state, "state.json"), stateBytes);

  const adapter = new MacOSReadAdapter(repo, state);
  const local = (await adapter.inventory()).themes.find(value => value.ref.id === themeId);
  assert.ok(local);
  const selected = await themeDetails(local), activeLocal = await activeTheme(state, "macos");
  assert.ok(activeLocal);
  const baseline = await themeDetails(activeLocal);
  assert.notEqual(selected.revision, baseline.revision);
  const environment = { ...process.env, HOME: home, CFFIXED_USER_HOME: home, CODEX_HOME: path.join(home, ".codex"),
    TMPDIR: temporary, DREAMSKIN_PREVIEW: "1" };
  delete environment.NODE_OPTIONS;
  const defaultCaches = [];

  for (const kind of ["symlink", "corrupt", "symlink"]) {
    const id = randomUUID(), requestFile = path.join(requests, id + ".json");
    await writeFile(requestFile, JSON.stringify({ schemaVersion: 1, operationId: `${randomUUID()}:${randomUUID()}`, theme: selected.ref,
      expectedRevision: selected.revision, preflightFingerprint: "f".repeat(64), confirmed: false,
      refresh: { activeRevision: baseline.revision, runtimeSessionId: "c".repeat(64), opacityOnly: true } }));
    const recordFile = path.join(root, id + ".cache.json"), preload = path.join(root, id + ".preload.mjs");
    // Import the same module instance as the real worker to identify its default cache.
    // No functions are mocked; poisoning this isolated cache makes an accidental use fail.
    await writeFile(preload, `import { mkdir, writeFile, symlink, lstat } from "node:fs/promises";
import path from "node:path";
import { MEDIA_CACHE_ROOT } from ${JSON.stringify(pathToFileURL(path.join(repo, "macos", "scripts", "media-cache.mjs")).href)};
const file = path.join(MEDIA_CACHE_ROOT, ${JSON.stringify(mediaHash + ".mp4")});
await mkdir(MEDIA_CACHE_ROOT, { recursive: true, mode: 0o700 });
if (${JSON.stringify(kind)} === "symlink") await symlink(${JSON.stringify(project)}, file);
else await writeFile(file, "corrupt fixture cache", { mode: 0o600 });
const metadata = stat => ({ size: stat.size, mode: stat.mode, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
await writeFile(${JSON.stringify(recordFile)}, JSON.stringify({ root: MEDIA_CACHE_ROOT, directory: metadata(await lstat(MEDIA_CACHE_ROOT)), file: metadata(await lstat(file)) }));
`);
    const { stdout, stderr } = await run(process.execPath, ["--import", preload, path.join(repo, "build", "shared", "core", "apply-worker.mjs"),
      "prepare", repo, requestFile], { cwd: root, env: environment, timeout: 20000, maxBuffer: 1024 * 1024 });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout), expectedDirectory = path.join(state, "manager-operations", "snapshots", id);
    assert.equal(result.directory, expectedDirectory); assert.equal(result.expectedRevision, selected.revision); assert.equal(result.video, true);
    assert.equal(JSON.parse(await readFile(path.join(result.directory, "theme.json"), "utf8")).art.surfaceOpacity, 0.03);
    const privateCache = path.join(result.directory, ".payload-cache"), privateMedia = path.join(privateCache, mediaHash + ".mp4");
    assert.deepEqual(await readdir(privateCache), [mediaHash + ".mp4"]);
    assert.equal((await lstat(privateMedia)).isSymbolicLink(), false);
    assert.equal(hash(await readFile(privateMedia)), mediaHash);

    const originalCache = JSON.parse(await readFile(recordFile, "utf8"));
    assert.equal(path.dirname(originalCache.root), cacheParent);
    defaultCaches.push({ ...originalCache, kind });
    assert.deepEqual((await readdir(cacheParent)).sort(), defaultCaches.map(value => path.basename(value.root)).sort());
    for (const cached of defaultCaches) {
      const poisoned = path.join(cached.root, mediaHash + ".mp4");
      assert.deepEqual(metadata(await lstat(cached.root)), cached.directory);
      assert.deepEqual(await readdir(cached.root), [mediaHash + ".mp4"]);
      assert.deepEqual(metadata(await lstat(poisoned)), cached.file);
      if (cached.kind === "symlink") assert.equal(await readlink(poisoned), project);
      else assert.equal(await readFile(poisoned, "utf8"), "corrupt fixture cache");
    }
    assert.deepEqual(await readFile(path.join(active, "theme.json")), activeBytes);
    assert.deepEqual(await readFile(path.join(library, "theme.json")), libraryBytes);
    assert.deepEqual(await readFile(path.join(state, "state.json")), stateBytes);
    assert.equal(hash(await readFile(path.join(active, "background.mp4"))), mediaHash);
    assert.equal(hash(await readFile(path.join(library, "background.mp4"))), mediaHash);
    assert.deepEqual(await readFile(project), projectBytes); assert.deepEqual(await readFile(chat), chatBytes);
  }
});
