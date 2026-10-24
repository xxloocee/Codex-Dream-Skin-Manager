import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { build } from "esbuild";
import { PROTOCOL, MAX_MESSAGE_BYTES, CONFIRMATION_KINDS, confirmationCopy, parseApplyRefresh, parseRequest, parseThemePatch } from "../build/shared/contracts/manager.mjs";
import { serve } from "../build/shared/core/ndjson.mjs";
import { Operations } from "../build/shared/core/operations.mjs";
import { OperationStore } from "../build/shared/core/operation-store.mjs";
import { parameters } from "../build/shared/core/theme-model.mjs";
import { editTheme } from "../build/shared/core/theme-edit.mjs";
import { themeFingerprint } from "../build/shared/core/theme-fingerprint.mjs";
import { decodeThemePackage, encodeThemePackage, packageFingerprint } from "../build/shared/core/theme-package.mjs";
import { mergedPreset } from "../build/shared/platforms/local-library.mjs";
import { finishPublication } from "../build/shared/platforms/publication-history.mjs";

// Vite's locked esbuild dependency bundles pure UI helpers for Node; no DOM,
// native host, actual backend, network or user state is opened by this suite.
const bundled = await build({ stdin: { contents: 'export * from "./ui/manager/src/ui-message.ts"; export * from "./ui/manager/src/confirmation-copy.ts"; export * from "./ui/manager/src/preview-model.ts";',
  resolveDir: path.resolve(import.meta.dirname, ".."), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
const { uiMessage, renderMessage, UiMessageError, errorMessage, confirmationText, previewParameters } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const revision = "a".repeat(64);
const theme = { source: "saved", id: "sample" };
const request = (method, params = {}, requestId = "request-1") => ({ protocol: PROTOCOL, kind: "request", requestId, method, params });
const code = expected => error => error.code === expected;

test("background overlay opacity is optional, bounded and never backfilled by another parameter edit", () => {
  for (const value of [0, 0.58, 0.64, 1, null]) {
    const patch = { parameters: { shellOpacity: value } };
    assert.deepEqual(parseThemePatch(patch), patch);
  }
  for (const value of [-0.01, 1.01, NaN, Infinity, "0.5", undefined]) {
    assert.throws(() => parseThemePatch({ parameters: { shellOpacity: value } }), code("INVALID_REQUEST"));
  }
  for (const appearance of ["auto", "dark", "light"]) {
    const config = { appearance, art: { bubbleOpacity: 0.2, surfaceOpacity: 0.3 } };
    const values = parameters(config);
    assert.equal(values.stored.shellOpacity, null);
    assert.equal(values.preview.shellOpacity, appearance === "light" ? 0.64 : 0.58);
    const edited = editTheme(config, { parameters: { bubbleOpacity: 0.4 } }, "macos");
    assert.deepEqual(edited, { appearance, art: { bubbleOpacity: 0.4, surfaceOpacity: 0.3 } });
    const overlay = editTheme(config, { parameters: { shellOpacity: 0.12 } }, "macos");
    assert.equal(parameters(overlay).stored.shellOpacity, 0.12);
    assert.equal(overlay.art.surfaceOpacity, 0.3);
    assert.deepEqual(editTheme(overlay, { parameters: { shellOpacity: null } }, "macos"), config);
  }
  assert.throws(() => parameters({ art: { shellOpacity: 1.01 } }), code("THEME_INVALID"));
});
test("overlay preview follows system appearance only while the parameter remains unset", () => {
  const stored = Object.freeze(parameters({ appearance: "auto", art: {} }).stored);
  assert.equal(previewParameters(stored, {}, true).shellOpacity, 0.58);
  assert.equal(previewParameters(stored, {}, false).shellOpacity, 0.64);
  assert.equal(previewParameters(previewParameters(stored), {}, false).shellOpacity, 0.64);
  assert.equal(previewParameters(stored, { appearance: "light" }, true).shellOpacity, 0.64);
  assert.equal(previewParameters(stored, { appearance: "dark" }, false).shellOpacity, 0.58);
  assert.equal(previewParameters(stored, { shellOpacity: 0 }, false).shellOpacity, 0);
  assert.equal(previewParameters(stored, { shellOpacity: 1 }, true).shellOpacity, 1);
  assert.equal(stored.shellOpacity, null);
  assert.equal(renderMessage("en-US", uiMessage("背景遮罩不透明度")), "Background overlay opacity");
});
test("Windows preset overrides retain explicit overlay opacity and remove it when reset to default", async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "dreamskin-preset-overlay-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mediaRoot = path.join(root, "preset"), settings = path.join(root, "preset-settings");
  await mkdir(mediaRoot); await mkdir(settings);
  const source = { ref: { source: "preset", id: "preset-overlay" },
    config: { schemaVersion: 1, id: "preset-overlay", name: "Overlay fixture", image: "background.png", appearance: "auto",
      art: { shellOpacity: 0.45, surfaceOpacity: 0.3, futureArtField: "preserved" } },
    mediaRoot, mediaPath: path.join(mediaRoot, "background.png"), cssPath: null, catalogOrder: 0, modifiedAt: null,
    revisionInputs: [], revisionFiles: [] };
  const settingsPath = path.join(settings, "preset-overlay.json");
  for (const shellOpacity of [0, 0.12, 1, undefined]) {
    await writeFile(settingsPath, JSON.stringify({ schemaVersion: 1, appearance: "auto", accent: "",
      art: { surfaceOpacity: 0.3, ...(shellOpacity === undefined ? {} : { shellOpacity }) } }));
    const merged = await mergedPreset(source, root);
    assert.equal(merged.config.art.shellOpacity, shellOpacity);
    assert.equal(parameters(merged.config).stored.shellOpacity, shellOpacity ?? null);
    assert.equal(merged.config.art.surfaceOpacity, 0.3);
    assert.equal(merged.config.art.futureArtField, "preserved");
    assert.equal(source.config.art.shellOpacity, 0.45, "Preset settings must not mutate the bundled contract.");
  }
});
test("portable theme roundtrips preserve overlay opacity and distinguish system defaults in deduplication", async () => {
  const config = { schemaVersion: 1, id: "overlay-fixture", name: "Overlay fixture", image: "art.png", category: "custom", tags: [], appearance: "auto", art: {} };
  const media = Buffer.from("isolated media fixture"), validation = { platform: "macos", async inspect() {}, async css() {} };
  for (const value of [undefined, 0, 0.38, 1]) {
    const source = { ...config, art: value === undefined ? {} : { shellOpacity: value } };
    const bytes = await encodeThemePackage(source, media, ".png", null, null, validation);
    const decoded = await decodeThemePackage(bytes, ".cdskin", validation);
    assert.deepEqual(decoded.config.art, source.art);
    assert.equal(parameters(decoded.config).stored.shellOpacity, value ?? null);
  }
  assert.notEqual(packageFingerprint(config, media, null, null),
    packageFingerprint({ ...config, art: { shellOpacity: 0.58 } }, media, null, null),
    "A system-dependent default must not deduplicate against a fixed opacity that differs in light mode.");
  assert.notEqual(themeFingerprint(config, media, null),
    themeFingerprint({ ...config, art: { shellOpacity: 0.58 } }, media, null),
    "Direct media imports must preserve the same distinction as package imports.");
});

test("wire contract rejects unknown fields, methods, private envelopes and invalid identities", () => {
  assert.equal(parseRequest(request("status.get")).method, "status.get");
  for (const value of [{ ...request("status.get"), extra: true }, request("status.get", { path: "C:/private" }),
    { ...request("status.get"), kind: "native.request" }, request("themes.get", { theme: { source: "saved", id: "../outside" } })]) {
    assert.throws(() => parseRequest(value), code("INVALID_REQUEST"));
  }
  assert.throws(() => parseRequest(request("unknown.method")), code("METHOD_UNSUPPORTED"));
  assert.throws(() => parseRequest({ ...request("status.get"), protocol: "other/1" }), code("PROTOCOL_UNSUPPORTED"));
});
test("hot refresh contract requires exact active and runtime identities and a strict opacity-only flag", () => {
  const refresh = { activeRevision: "b".repeat(64), runtimeSessionId: "c".repeat(64) };
  const params = { operationId: `${randomUUID()}:${randomUUID()}`, theme, expectedRevision: revision };
  assert.equal(parseRequest(request("skin.apply", params)).params.refresh, undefined);
  for (const value of [refresh, { ...refresh, opacityOnly: true }]) {
    assert.deepEqual(parseApplyRefresh(value), value);
    assert.deepEqual(parseRequest(request("skin.apply", { ...params, refresh: value })).params.refresh, value);
  }
  for (const value of [null, [], "refresh", {}, { activeRevision: refresh.activeRevision }, { runtimeSessionId: refresh.runtimeSessionId },
    { ...refresh, activeRevision: "b".repeat(63) }, { ...refresh, activeRevision: "B".repeat(64) },
    { ...refresh, runtimeSessionId: "g".repeat(64) }, { ...refresh, runtimeSessionId: 1 },
    { ...refresh, opacityOnly: false }, { ...refresh, opacityOnly: "true" }, { ...refresh, opacityOnly: 1 },
    { ...refresh, allowRestart: true }]) {
    assert.throws(() => parseApplyRefresh(value), code("INVALID_REQUEST"));
    assert.throws(() => parseRequest(request("skin.apply", { ...params, refresh: value })), code("INVALID_REQUEST"));
  }
  assert.throws(() => parseRequest(request("themes.delete", { ...params, refresh })), code("INVALID_REQUEST"));
});

async function wire(chunks) {
  const lines = []; const calls = [];
  const output = new Writable({ write(chunk, _encoding, callback) { lines.push(chunk.toString()); callback(); } });
  const service = { isClosing: false, attachEvents() {}, async execute(value) { calls.push(value.method); return value.params; },
    async executeNative() { throw new Error("No native calls expected"); } };
  await serve(Readable.from(chunks), output, service);
  return { replies: lines.join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)), calls };
}
const line = value => Buffer.from(JSON.stringify(value) + "\n");
test("NDJSON requires a handshake and unique request IDs", async () => {
  const { replies, calls } = await wire([line(request("status.get", {}, "early")), line(request("system.hello", {}, "hello")),
    line(request("status.get", {}, "ok")), line(request("status.get", {}, "ok"))]);
  assert.deepEqual(calls, ["system.hello", "status.get"]);
  assert.deepEqual(replies.map(value => value.ok), [false, true, true, false]);
});
test("NDJSON rejects invalid UTF-8, truncated and oversized requests without execution", async () => {
  for (const chunks of [[Buffer.from([0xff, 10])], [Buffer.from('{"unfinished":')], [Buffer.alloc(MAX_MESSAGE_BYTES + 1, 32)]]) {
    const { replies, calls } = await wire(chunks);
    assert.deepEqual(calls, []); assert.equal(replies.length, 1); assert.equal(replies[0].error.code, "INVALID_REQUEST");
  }
});
test("NDJSON accepts UTF-8 and CRLF split across arbitrary chunks", async () => {
  const copy = request("themes.copy", { operationId: `${randomUUID()}:${randomUUID()}`, theme, expectedRevision: revision,
    patch: {}, name: "中文素材" }, "copy");
  const bytes = Buffer.from(JSON.stringify(request("system.hello", {}, "hello")) + "\r\n" + JSON.stringify(copy) + "\r\n");
  const { replies, calls } = await wire([...bytes].map(value => Buffer.from([value])));
  assert.deepEqual(calls, ["system.hello", "themes.copy"]); assert.equal(replies[0].ok, true);
  assert.equal(replies[1].result.name, "中文素材");
});

test("owned messages translate at display time while diagnostic and subject strings stay raw", () => {
  const owned = uiMessage("控制台");
  assert.equal(renderMessage("zh-CN", owned), "控制台"); assert.equal(renderMessage("en-US", owned), "Console");
  assert.equal(renderMessage("en-US", "控制台"), "控制台");
  assert.equal(renderMessage("en-US", uiMessage("删除“{subject}”？", { subject: "控制台" })), "Delete “控制台”?");
  assert.equal(renderMessage("en-US", errorMessage(new Error("控制台"), "已完成")), "控制台");
  assert.equal(renderMessage("en-US", errorMessage(new UiMessageError(owned), "已完成")), "Console");
  assert.equal(renderMessage("en-US", uiMessage("已完成", undefined, { before: "[", after: "]" })), "[Completed]");
});
test("all 13 confirmation kinds bind to their method and invalid copy fully falls back", () => {
  const methods = ["skin.apply", "skin.resume", "skin.reset", "runtime.repair", "skin.restore", "runtime.upgrade",
    "themes.delete", "themes.delete", ...Array(5).fill("library.recover")];
  CONFIRMATION_KINDS.forEach((kind, index) => {
    const copy = { kind, ...(kind.startsWith("delete") || kind.startsWith("recover") ? { subject: "控制台" } : {}) };
    const confirmation = { reason: "original reason", impact: "original impact", copy };
    const actual = confirmationText("en-US", { method: methods[index], confirmation });
    assert.notEqual(actual.reason, confirmation.reason); assert.notEqual(actual.impact, confirmation.impact);
    if (copy.subject) assert.ok(actual.reason.includes("控制台"));
    assert.equal(confirmationText("en-US", { method: "themes.copy", confirmation }), confirmation);
  });
  for (const copy of [undefined, { kind: "unknown" }, { kind: "deleteSaved" }, { kind: "applyRestart", subject: "bad" },
    { kind: "deleteSaved", subject: "ok", unexpected: true }, { kind: "deleteSaved", subject: "x".repeat(257) }]) {
    assert.equal(confirmationCopy(copy), undefined);
    const confirmation = { reason: "raw", impact: "raw impact", copy };
    assert.equal(confirmationText("en-US", { method: "themes.delete", confirmation }), confirmation);
  }
});

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dreamskin-shared-test-"));
  const session = randomUUID(), store = new OperationStore(root);
  let executions = 0, fingerprint = "original";
  const calls = { preflight: [], apply: [] };
  const port = { async preflight(...args) { calls.preflight.push(structuredClone(args)); return { fingerprint, requiresConfirmation: options.confirm ?? false, reason: "restart", impact: "work interrupted" }; },
    async apply(...args) { calls.apply.push(structuredClone(args)); executions++; if (options.fail) throw new Error("simulated connection loss");
      return { effects: { themeCommitted: true, rendererApplied: true, codexRestarted: options.codexRestarted === undefined ? false : options.codexRestarted }, committedRevision: revision,
        verifiedRendererRevision: revision, runtimeSessionId: options.runtimeSessionId ?? "fake-runtime" }; } };
  const operations = new Operations(session, store, port, async () => null, async () => {});
  t.after(async () => { try { await operations.close(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { operations, store, root, port, session, calls, params: { operationId: `${session}:${randomUUID()}`, theme, expectedRevision: revision },
    executions: () => executions, drift() { fingerprint = "changed"; } };
}
test("same ID is queried without replay; changed arguments and old-session IDs are rejected", async t => {
  const f = await fixture(t);
  await f.operations.apply(f.params); await f.operations.drain();
  assert.equal((await f.operations.apply(f.params)).state, "succeeded"); assert.equal(f.executions(), 1);
  await assert.rejects(f.operations.apply({ ...f.params, expectedRevision: "b".repeat(64) }), code("OPERATION_CONFLICT"));
  await assert.rejects(f.operations.apply({ ...f.params, operationId: `${randomUUID()}:${randomUUID()}` }), code("OPERATION_UNKNOWN"));
  const reopened = new Operations(randomUUID(), f.store, f.port, async () => null, async () => {});
  assert.equal((await reopened.get(f.params.operationId)).state, "succeeded"); assert.equal(f.executions(), 1);
});
test("a hot refresh operation identity cannot be reused with changed or removed safety constraints", async t => {
  const refresh = { activeRevision: "b".repeat(64), runtimeSessionId: "c".repeat(64), opacityOnly: true };
  const f = await fixture(t, { runtimeSessionId: refresh.runtimeSessionId });
  const params = { ...f.params, refresh };
  await f.operations.apply(params); await f.operations.drain();
  assert.equal((await f.operations.apply(params)).state, "succeeded");
  for (const changed of [{ ...refresh, activeRevision: "d".repeat(64) }, { ...refresh, runtimeSessionId: "d".repeat(64) },
    { activeRevision: refresh.activeRevision, runtimeSessionId: refresh.runtimeSessionId }]) {
    await assert.rejects(f.operations.apply({ ...params, refresh: changed }), code("OPERATION_CONFLICT"));
  }
  await assert.rejects(f.operations.apply(f.params), code("OPERATION_CONFLICT"));
  assert.equal(f.executions(), 1);
});
test("hot refresh fails without confirmation or writer execution when a restart would be required", async t => {
  const f = await fixture(t, { confirm: true });
  const refresh = { activeRevision: "b".repeat(64), runtimeSessionId: "c".repeat(64), opacityOnly: true };
  const states = [];
  f.operations.onChanged = value => states.push(value.state);
  await f.operations.apply({ ...f.params, refresh }); await f.operations.drain();
  const result = await f.operations.get(f.params.operationId);
  assert.equal(result.state, "failed"); assert.equal(result.error.code, "RUNTIME_UNAVAILABLE");
  assert.equal(result.confirmation, null); assert.equal(states.includes("awaitingConfirmation"), false);
  assert.deepEqual(result.effects, { themeCommitted: false, rendererApplied: false, codexRestarted: false });
  assert.deepEqual(f.calls.preflight, [[theme, revision, refresh]]);
  assert.equal(f.executions(), 0); assert.deepEqual(f.calls.apply, []); assert.deepEqual(f.operations.activeIds, []);
});
test("hot refresh forwards its unchanged constraints to preflight and apply without restart", async t => {
  for (const opacityOnly of [false, true]) await t.test(opacityOnly ? "video opacity" : "full hot refresh", async t => {
    const refresh = { activeRevision: "b".repeat(64), runtimeSessionId: "c".repeat(64), ...(opacityOnly ? { opacityOnly: true } : {}) };
    const f = await fixture(t, { runtimeSessionId: refresh.runtimeSessionId });
    await f.operations.apply({ ...f.params, refresh }); await f.operations.drain();
    const result = await f.operations.get(f.params.operationId);
    assert.equal(result.state, "succeeded"); assert.equal(result.confirmation, null);
    assert.equal(result.effects.rendererApplied, true); assert.equal(result.effects.codexRestarted, false);
    assert.equal(result.runtimeSessionId, refresh.runtimeSessionId);
    assert.deepEqual(f.calls.preflight, [[theme, revision, refresh]]); assert.equal(f.calls.apply.length, 1);
    const [sentTheme, sentRevision, preflight, confirmed, operationId, sentRefresh] = f.calls.apply[0];
    assert.deepEqual(sentTheme, theme); assert.equal(sentRevision, revision); assert.equal(preflight.requiresConfirmation, false);
    assert.equal(confirmed, false); assert.equal(operationId, f.params.operationId); assert.deepEqual(sentRefresh, refresh);
  });
});
test("hot refresh cannot report success after a restart, unknown restart effect or runtime session change", async t => {
  const refresh = { activeRevision: "b".repeat(64), runtimeSessionId: "c".repeat(64), opacityOnly: true };
  const outcomes = [
    { name: "reported restart", codexRestarted: true, runtimeSessionId: refresh.runtimeSessionId },
    { name: "unknown restart", codexRestarted: null, runtimeSessionId: refresh.runtimeSessionId },
    { name: "different runtime", codexRestarted: false, runtimeSessionId: "d".repeat(64) },
  ];
  for (const outcome of outcomes) await t.test(outcome.name, async t => {
    const f = await fixture(t, outcome);
    await f.operations.apply({ ...f.params, refresh }); await f.operations.drain();
    const result = await f.operations.get(f.params.operationId);
    assert.equal(result.state, "indeterminate"); assert.equal(result.error.code, "RENDERER_UNVERIFIED");
    assert.equal(result.confirmation, null); assert.equal(result.effects.codexRestarted, outcome.codexRestarted);
    assert.equal(f.executions(), 1);
    await f.operations.apply({ ...f.params, refresh }); assert.equal(f.executions(), 1);
    assert.deepEqual((await f.store.read(f.params.operationId)).refresh, refresh);
    const receiptPort = { ...f.port, async receipt() {
      return { effects: result.effects, committedRevision: revision, verifiedRendererRevision: revision, runtimeSessionId: outcome.runtimeSessionId };
    } };
    const reopened = new Operations(randomUUID(), f.store, receiptPort, async () => null, async () => {});
    try {
      const reconciled = await reopened.get(f.params.operationId);
      assert.equal(reconciled.state, "indeterminate"); assert.equal(reconciled.confirmation, null);
      assert.equal(f.executions(), 1);
    } finally { await reopened.close(); }
  });
});
test("confirmation decline and fingerprint drift cannot execute the writer", async t => {
  const f = await fixture(t, { confirm: true });
  await f.operations.apply(f.params); await f.operations.drain();
  const first = await f.operations.get(f.params.operationId);
  assert.equal(first.state, "awaitingConfirmation"); assert.equal(f.executions(), 0);
  await assert.rejects(f.operations.confirm({ operationId: first.id, confirmationId: "wrong", accepted: true }), code("CONFIRMATION_EXPIRED"));
  f.drift();
  await f.operations.confirm({ operationId: first.id, confirmationId: first.confirmation.id, accepted: true }); await f.operations.drain();
  const changed = await f.operations.get(first.id);
  assert.equal(changed.state, "awaitingConfirmation"); assert.notEqual(changed.confirmation.id, first.confirmation.id); assert.equal(f.executions(), 0);
  await f.operations.confirm({ operationId: first.id, confirmationId: changed.confirmation.id, accepted: false });
  assert.equal((await f.operations.get(first.id)).state, "cancelled"); assert.equal(f.executions(), 0);
});
test("confirmation is single-use and session close cancels an unused confirmation", async t => {
  const f = await fixture(t, { confirm: true, codexRestarted: true });
  await f.operations.apply(f.params); await f.operations.drain();
  const current = await f.operations.get(f.params.operationId);
  const approval = { operationId: current.id, confirmationId: current.confirmation.id, accepted: true };
  await f.operations.confirm(approval); await f.operations.drain();
  const applied = await f.operations.get(current.id);
  assert.equal(applied.state, "succeeded"); assert.equal(applied.effects.codexRestarted, true);
  await assert.rejects(f.operations.confirm(approval), code("CONFIRMATION_EXPIRED")); assert.equal(f.executions(), 1);
  const next = { ...f.params, operationId: `${f.session}:${randomUUID()}` };
  await f.operations.apply(next); await f.operations.drain(); await f.operations.close();
  assert.equal((await f.store.read(next.operationId)).operation.state, "cancelled"); assert.equal(f.executions(), 1);
});
test("execution loss and reopened unfinished journal stay indeterminate without replay", async t => {
  const f = await fixture(t, { fail: true });
  await f.operations.apply(f.params); await f.operations.drain();
  assert.equal((await f.operations.get(f.params.operationId)).state, "indeterminate");
  await f.operations.apply(f.params); assert.equal(f.executions(), 1);
  const record = await f.store.read(f.params.operationId);
  record.operation.state = "running"; await f.store.write(record);
  const reopened = new Operations(randomUUID(), f.store, f.port, async () => null, async () => {});
  assert.equal((await reopened.get(f.params.operationId)).state, "indeterminate"); assert.equal(f.executions(), 1);
});
test("journal drops invalid optional display metadata and refuses corrupt required fields", async t => {
  const f = await fixture(t, { confirm: true });
  await f.operations.apply(f.params); await f.operations.drain();
  const record = await f.store.read(f.params.operationId);
  record.operation.confirmation.copy = { kind: "bad", subject: "wrong" }; await f.store.write(record);
  const sanitized = await f.store.read(f.params.operationId);
  assert.equal(sanitized.operation.confirmation.copy, undefined); assert.equal(sanitized.operation.confirmation.reason, "restart");
  const directory = path.join(f.root, "manager-operations", "ledger");
  const filename = path.join(directory, (await readdir(directory))[0]);
  const damaged = JSON.parse(await readFile(filename, "utf8")); damaged.operation.expectedRevision = "bad";
  await writeFile(filename, JSON.stringify(damaged));
  await assert.rejects(f.store.read(f.params.operationId), code("IO_ERROR"));
});
test("hot refresh settlement preserves prior recovery evidence until the same runtime is verified without restart", async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "dreamskin-refresh-settlement-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const operations = path.join(root, "manager-operations"), requests = path.join(operations, "requests"), snapshots = path.join(operations, "snapshots");
  await mkdir(requests, { recursive: true }); await mkdir(snapshots);
  const refresh = { activeRevision: "b".repeat(64), runtimeSessionId: "c".repeat(64), opacityOnly: true };
  const verified = { effects: { themeCommitted: true, rendererApplied: true, codexRestarted: false }, committedRevision: revision,
    verifiedRendererRevision: "d".repeat(20), runtimeSessionId: refresh.runtimeSessionId };
  async function prepare(constraint) {
    const id = randomUUID(), operationId = `${randomUUID()}:${randomUUID()}`, file = path.join(requests, id + ".json");
    await mkdir(path.join(snapshots, id));
    await writeFile(path.join(snapshots, id, "sentinel"), "retained publication evidence");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, operationId, theme, expectedRevision: revision,
      ...(constraint === undefined ? {} : { refresh: constraint }) }));
    return { id, file, receipt: path.join(operations, "apply-results", createHash("sha256").update(operationId).digest("hex") + ".json") };
  }
  const previous = await prepare();
  await finishPublication(root, previous.file, { ...verified, effects: { ...verified.effects, codexRestarted: true } });
  const currentFile = path.join(operations, "current.json"), originalCurrent = await readFile(currentFile);
  const originalSettled = await readFile(path.join(requests, previous.id + ".settled"));
  const missing = error => error.code === "ENOENT";
  const rejected = [
    { name: "different runtime", outcome: { ...verified, runtimeSessionId: "e".repeat(64) } },
    { name: "reported restart", outcome: { ...verified, effects: { ...verified.effects, codexRestarted: true } } },
    { name: "unknown restart", outcome: { ...verified, effects: { ...verified.effects, codexRestarted: null } } },
    { name: "missing restart proof", outcome: { ...verified, effects: { themeCommitted: true, rendererApplied: true } } },
    { name: "invalid refresh binding", outcome: verified, refresh: { ...refresh, opacityOnly: false } },
  ];
  for (const attempt of rejected) {
    const next = await prepare(attempt.refresh ?? refresh);
    await assert.rejects(finishPublication(root, next.file, attempt.outcome), undefined, attempt.name);
    assert.deepEqual(await readFile(currentFile), originalCurrent, attempt.name);
    assert.deepEqual(await readFile(path.join(requests, previous.id + ".settled")), originalSettled, attempt.name);
    assert.equal(await readFile(path.join(snapshots, previous.id, "sentinel"), "utf8"), "retained publication evidence", attempt.name);
    await assert.rejects(readFile(path.join(requests, next.id + ".settled")), missing);
    await assert.rejects(readFile(next.receipt), missing);
  }
  const accepted = await prepare(refresh);
  await finishPublication(root, accepted.file, verified);
  assert.equal(JSON.parse(await readFile(currentFile, "utf8")).requestFile, accepted.id + ".json");
  assert.deepEqual(JSON.parse(await readFile(accepted.receipt, "utf8")).outcome, verified);
  assert.deepEqual(JSON.parse(await readFile(path.join(requests, accepted.id + ".settled"), "utf8")), { schemaVersion: 1 });
  await assert.rejects(readFile(path.join(snapshots, previous.id, "sentinel")), missing);
  assert.equal(await readFile(path.join(snapshots, accepted.id, "sentinel"), "utf8"), "retained publication evidence");
});
