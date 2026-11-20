import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { OperationStore } from "../build/shared/core/operation-store.mjs";
import { LibraryTransactions } from "../build/shared/core/library-transactions.mjs";
import { WindowsReadAdapter } from "../build/shared/platforms/windows/read-adapter.mjs";
import { themeDetails } from "../build/shared/core/theme-model.mjs";
import { treeRevision, treeSnapshot } from "../build/shared/core/managed-tree.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const identity = () => `${randomUUID()}:${randomUUID()}`;
const present = file => lstat(file).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
const windows = { skip: process.platform !== "win32", timeout: 60000 };
const quotePS = text => "'" + text.replaceAll("'", "''") + "'";

function launch(executable, args, env) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
  return { child, done };
}
async function waitFile(file, processResult) {
  const until = Date.now() + 15000;
  let exited;
  processResult.then(result => { exited = result; });
  while (!await present(file)) {
    if (exited) assert.fail(JSON.stringify(exited));
    assert.ok(Date.now() < until, `Timed out waiting for fixture signal ${path.basename(file)}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dreamskin-worker-proof-"));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  const pending = [], releases = [];
  t.after(async () => {
    for (const release of releases) await writeFile(release, "release");
    await Promise.allSettled(pending);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const app = path.join(root, "应用 with spaces"), local = path.join(root, "local"), state = path.join(local, "CodexDreamSkin");
  const scripts = path.join(app, "windows", "scripts"), presets = path.join(app, "windows", "presets");
  await mkdir(scripts, { recursive: true }); await mkdir(presets); await mkdir(path.join(state, "themes"), { recursive: true });
  await cp(path.join(repo, "build/shared"), path.join(app, "shared"), { recursive: true });
  await mkdir(path.join(app, "runtime/node"), { recursive: true });
  await cp(process.execPath, path.join(app, "runtime/node/node.exe"));
  for (const file of ["manager-library.ps1", "theme-windows.ps1", "config-utf8.ps1", "runtime-version.ps1"]) {
    await cp(path.join(repo, "windows/scripts", file), path.join(scripts, file));
  }
  const lockPrefix = `Local\\DreamSkinProof-${randomUUID()}.$sid.Operation`;
  const common = await readFile(path.join(repo, "windows/scripts/common-windows.ps1"), "utf8");
  const originalLock = "Local\\CodexDreamSkin.$sid.Operation";
  assert.equal(common.split(originalLock).length, 2, "Exactly one operation mutex identity must be isolated");
  await writeFile(path.join(scripts, "common-windows.ps1"), common.replace(originalLock, lockPrefix));
  await writeFile(path.join(scripts, "platform-theme.ps1"), `param($Action,$SkillRoot,$StateRoot,[switch]$SkipThemes,[switch]$Quick)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[IO.File]::ReadAllText((Join-Path $StateRoot 'fixture-status.json'))
`);
  await writeFile(path.join(app, "windows/VERSION"), "1.7.0\n");
  const status = value => writeFile(path.join(state, "fixture-status.json"), JSON.stringify({ isPaused: false, statusKind: "stopped", isRunning: false, activeThemeId: null, appliedThemeId: null, ...value }));
  await status({});
  const catalog = { schemaVersion: 1, themes: ["paper-light", "removable", "keep"].map(id => ({ id, name: id, image: id + ".png", category: "custom" })) };
  await writeFile(path.join(presets, "catalog.json"), JSON.stringify(catalog) + "\n");
  for (const entry of catalog.themes) await writeFile(path.join(presets, entry.image), "synthetic preset " + entry.id);
  const adapter = new WindowsReadAdapter(app, state), store = new OperationStore(state), journals = new LibraryTransactions(state, app, "windows");
  const env = { ...process.env, LOCALAPPDATA: local };
  delete env.NODE_OPTIONS; delete env.CODEX_MANAGER_LIBRARY_LOCK_HELD;
  const ps = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const track = process => { pending.push(process.done); return process.done; };
  async function jsonProcess(exe, args, environment = env) {
    const result = await track(launch(exe, args, environment));
    assert.equal(result.code, 0, JSON.stringify(result));
    return JSON.parse(result.stdout);
  }
  async function theme(name = "saved-example") {
    const directory = path.join(state, "themes", name); await mkdir(directory);
    await writeFile(path.join(directory, "theme.json"), JSON.stringify({ schemaVersion: 1, id: name, name: "中文样本", image: "background.png", category: "custom", tags: [], art: {}, appearance: "auto", futureField: { keep: true } }) + "\n");
    await writeFile(path.join(directory, "background.png"), "synthetic media bytes");
    await writeFile(path.join(directory, "LICENSE.txt"), "fixture attribution");
    return details({ source: "saved", id: name });
  }
  async function details(ref) {
    const local = (await adapter.inventory()).themes.find(item => item.ref.id === ref.id && item.ref.source === ref.source);
    assert.ok(local); return themeDetails(local);
  }
  async function intent(command, stateValue = "running") {
    const now = new Date().toISOString();
    const value = { schemaVersion: 1, requestDigest: "a".repeat(64), preflight: null, operation: {
      id: command.params.operationId, method: command.method, state: stateValue, theme: command.params.theme ?? { source: "saved", id: "recovery-fixture" },
      expectedRevision: command.params.expectedRevision, committedRevision: null, resultRevision: null, resultTheme: null,
      effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: false },
      startedAt: now, updatedAt: now, stage: "fixture", error: null, confirmation: null,
    } };
    await store.create(value); return value;
  }
  async function request(payload) {
    const directory = path.join(state, "manager-operations/library-requests"); await mkdir(directory, { recursive: true });
    const file = path.join(directory, randomUUID() + ".json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, ...payload })); return file;
  }
  async function worker(payload, overrides = {}, location) {
    const file = location ?? await request(payload);
    return jsonProcess(path.join(app, "runtime/node/node.exe"), [path.join(app, "shared/core/library-worker.mjs"), app, file], { ...env, CODEX_MANAGER_LIBRARY_LOCK_HELD: "1", ...overrides });
  }
  async function call(method, args, hook) {
    const driver = path.join(root, randomUUID() + ".mjs");
    await writeFile(driver, `import {PlatformLibrary} from ${JSON.stringify(pathToFileURL(path.join(app, "shared/platforms/library.mjs")).href)};
const library = new PlatformLibrary(${JSON.stringify(app)}, ${JSON.stringify(state)});
console.log(JSON.stringify(await library[${JSON.stringify(method)}](...${JSON.stringify(args)})));
`);
    return jsonProcess(process.execPath, [driver], { ...env, ...(hook ? { NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` } : {}) });
  }
  const command = (method, details, extra = {}) => ({ method, params: { operationId: identity(), theme: details.ref, expectedRevision: details.revision, ...extra } });
  async function hold(kind) {
    const ready = path.join(root, randomUUID() + ".ready"), release = path.join(root, randomUUID() + ".release"); releases.push(release);
    const file = path.join(root, randomUUID() + ".ps1");
    await writeFile(file, `\uFEFF$ErrorActionPreference='Stop'
. ${quotePS(path.join(scripts, "common-windows.ps1"))}
$mutex = Enter-DreamSkinOperationLock -TimeoutMilliseconds 0
try {
 [IO.File]::WriteAllText(${quotePS(ready)},'ready')
 $watch=[Diagnostics.Stopwatch]::StartNew()
 while (-not [IO.File]::Exists(${quotePS(release)})) { if ($watch.Elapsed.TotalSeconds -gt 25) { throw 'Fixture release timed out' }; Start-Sleep -Milliseconds 25 }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
`);
    const run = launch(ps, ["-NoProfile", "-NonInteractive", "-File", file], env); track(run);
    await waitFile(ready, run.done);
    return async () => { await writeFile(release, "release"); const result = await run.done; assert.equal(result.code, 0, JSON.stringify(result)); };
  }
  async function hook(source) {
    const file = path.join(root, randomUUID() + ".mjs");
    await writeFile(file, source + "\nimport {syncBuiltinESMExports as syncProofBuiltinExports} from 'node:module'; syncProofBuiltinExports();\n");
    return file;
  }
  return { root, app, state, presets, status, adapter, store, journals, theme, details, intent, request, worker, call, command, hold, hook };
}

test("worker invocation gates preserve state; running intent permits a real configuration edit", windows, async t => {
  const f = await fixture(t), details = await f.theme(), edit = f.command("themes.update", details, { patch: { name: "已更新 🐾" } });
  const before = treeRevision(await treeSnapshot(path.join(f.state, "themes")));
  const missingLock = await f.worker({ command: edit }, { CODEX_MANAGER_LIBRARY_LOCK_HELD: "" });
  assert.equal(missingLock.error.code, "INVALID_REQUEST");
  const outside = path.join(f.root, randomUUID() + ".json"); await writeFile(outside, JSON.stringify({ schemaVersion: 1, command: edit }));
  assert.equal((await f.worker({}, {}, outside)).error.code, "INVALID_REQUEST");
  assert.equal((await f.worker({ schemaVersion: 9, command: edit })).error.code, "INVALID_REQUEST");
  assert.equal((await f.worker({ command: edit })).error.code, "OPERATION_UNKNOWN");
  const value = await f.intent(edit, "succeeded");
  assert.equal((await f.worker({ command: edit })).error.code, "OPERATION_UNKNOWN");
  assert.equal(treeRevision(await treeSnapshot(path.join(f.state, "themes"))), before);
  assert.equal(await f.journals.read(edit.params.operationId), null);
  value.operation.state = "running"; await f.store.write(value);
  const result = await f.call("edit", [edit]);
  assert.equal(result.error, null); assert.equal(result.libraryChanged, true);
  assert.equal((await f.details(details.ref)).name, "已更新 🐾");
  const config = JSON.parse(await readFile(path.join(f.state, "themes", details.ref.id, "theme.json"), "utf8"));
  assert.deepEqual(config.futureField, { keep: true });
  assert.equal(await readFile(path.join(f.state, "themes", details.ref.id, "LICENSE.txt"), "utf8"), "fixture attribution");
  assert.deepEqual(await f.call("receipt", [edit.params.operationId, edit.method, edit.params.expectedRevision]), result);
  assert.equal(await f.call("receipt", [edit.params.operationId, edit.method, "b".repeat(64)]), null);
  const after = treeRevision(await treeSnapshot(path.join(f.state, "themes")));
  assert.equal((await f.call("edit", [edit])).error.code, "OPERATION_CONFLICT");
  assert.equal(treeRevision(await treeSnapshot(path.join(f.state, "themes"))), after);
});

test("real worker edits Windows preset overrides without changing bundled catalog/media", windows, async t => {
  const f = await fixture(t), details = await f.details({ source: "preset", id: "preset-removable" });
  const before = treeRevision(await treeSnapshot(f.presets));
  const command = f.command("themes.update", details, { patch: { parameters: { appearance: "dark", focusX: 0.25 } } }); await f.intent(command);
  const result = await f.call("edit", [command]); assert.equal(result.error, null);
  const value = JSON.parse(await readFile(path.join(f.state, "preset-settings/preset-removable.json"), "utf8"));
  assert.equal(value.appearance, "dark"); assert.equal(value.art.focusX, 0.25);
  assert.equal(treeRevision(await treeSnapshot(f.presets)), before);
  assert.equal((await f.details(details.ref)).revision, result.resultRevision);
});

for (const lock of ["operation"]) test(`isolated ${lock} mutex blocks wrapper before worker; release permits edit and reacquisition`, windows, async t => {
  const f = await fixture(t), details = await f.theme(), edit = f.command("themes.update", details, { patch: { name: "after release" } }); await f.intent(edit);
  const before = treeRevision(await treeSnapshot(path.join(f.state, "themes"))), release = await f.hold(lock);
  try {
    const blocked = await f.call("edit", [edit]);
    assert.equal(blocked.error.code, "RUNTIME_UNAVAILABLE"); assert.equal(blocked.libraryChanged, false);
    assert.equal(await f.journals.read(edit.params.operationId), null);
    assert.equal(treeRevision(await treeSnapshot(path.join(f.state, "themes"))), before);
  } finally { await release(); }
  assert.equal((await f.call("edit", [edit])).error, null);
  assert.equal((await f.details(details.ref)).name, "after release");
  assert.ok(await f.call("receipt", [edit.params.operationId, edit.method, edit.params.expectedRevision]));
});

test("worker deletion rejects protected, uncertain, pending and changed inputs before removing bytes", windows, async t => {
  const f = await fixture(t), details = await f.theme(), command = f.command("themes.delete", details);
  const before = treeRevision(await treeSnapshot(path.join(f.state, "themes")));
  for (const status of [{ activeThemeId: details.ref.id }, { appliedThemeId: details.ref.id }, { statusKind: "unknown" }, { statusKind: "applying" }]) {
    await f.status(status); assert.equal((await f.worker({ action: "propose", command })).error.code, "THEME_PROTECTED");
  }
  await f.status({});
  const pending = f.command("themes.update", details, { patch: { name: "pending" } }), record = await f.intent(pending);
  assert.equal((await f.worker({ action: "propose", command })).error.code, "THEME_PROTECTED");
  record.operation.state = "failed"; await f.store.write(record);
  const protectedPreset = f.command("themes.delete", await f.details({ source: "preset", id: "preset-paper-light" }));
  assert.equal((await f.worker({ action: "propose", command: protectedPreset })).error.code, "THEME_PROTECTED");
  const catalogFile = path.join(f.presets, "catalog.json"), catalogBytes = await readFile(catalogFile);
  const catalog = JSON.parse(catalogBytes); catalog.themes = catalog.themes.filter(entry => entry.id === "removable");
  await writeFile(catalogFile, JSON.stringify(catalog));
  const lastPreset = f.command("themes.delete", await f.details({ source: "preset", id: "preset-removable" }));
  assert.equal((await f.worker({ action: "propose", command: lastPreset })).error.code, "THEME_PROTECTED");
  await writeFile(catalogFile, catalogBytes);
  const proposed = await f.worker({ action: "propose", command }); assert.ok(proposed.challenge);
  await f.intent(command); await f.status({ activeThemeId: details.ref.id });
  const denied = await f.worker({ command, fingerprint: proposed.challenge.fingerprint });
  assert.equal(denied.error.code, "THEME_PROTECTED"); assert.equal(denied.deleted, false);
  assert.equal(treeRevision(await treeSnapshot(path.join(f.state, "themes"))), before);
});

test("saved deletion permanently cleans only the confirmed tree and settles its receipt", windows, async t => {
  const f = await fixture(t), details = await f.theme(); await f.theme("saved-neighbor");
  const neighbor = path.join(f.state, "themes/saved-neighbor"), before = treeRevision(await treeSnapshot(neighbor));
  const command = f.command("themes.delete", details), challenge = await f.call("propose", [command]); await f.intent(command);
  const result = await f.call("executeConfirmed", [command, challenge.fingerprint]);
  assert.equal(result.error, null); assert.equal(result.deleted, true); assert.equal(result.cleanupPending, false);
  const value = await f.journals.read(command.params.operationId); assert.equal(value.phase, "final");
  assert.equal(await present(path.join(f.state, "themes", details.ref.id)), false); assert.equal(await present(f.journals.stage(value)), false);
  assert.equal(treeRevision(await treeSnapshot(neighbor)), before);
  assert.deepEqual(await f.call("receipt", [command.params.operationId, command.method, command.params.expectedRevision]), result);
  assert.equal((await f.call("recoveries", [])).entries.length, 0);
});

test("post-configuration-rename journal failure retains committed bytes; explicit reconcile settles original receipt", windows, async t => {
  const f = await fixture(t), details = await f.theme(), command = f.command("themes.update", details, { patch: { name: "committed before journal failure" } }); await f.intent(command);
  const hook = await f.hook(`import fs from 'node:fs/promises'; import path from 'node:path';
const original=fs.rename.bind(fs), target=${JSON.stringify(path.join(f.state, "themes", details.ref.id, "theme.json"))}, journal=${JSON.stringify(f.journals.file(command.params.operationId))}; let committed=false;
fs.rename=async function(from,to){ if(committed && path.resolve(String(to))===journal) throw new Error('injected post-commit journal failure'); const result=await original(from,to); if(path.resolve(String(to))===target) committed=true; return result; };`);
  const result = await f.call("edit", [command], hook);
  assert.ok(result.error); assert.notEqual(result.libraryChanged, false);
  assert.equal((await f.details(details.ref)).name, "committed before journal failure");
  assert.equal((await f.journals.read(command.params.operationId)).phase, "committing");
  const entry = (await f.call("recoveries", [])).entries.find(item => item.transactionId === command.params.operationId); assert.deepEqual(entry.actions, ["reconcile"]);
  const recovery = { method: "library.recover", params: { operationId: identity(), transactionId: command.params.operationId, expectedRevision: entry.revision, action: "reconcile" } };
  const challenge = await f.call("propose", [recovery]); await f.intent(recovery);
  assert.equal((await f.call("executeConfirmed", [recovery, challenge.fingerprint])).recoveryCompleted, true);
  const receipt = await f.call("receipt", [command.params.operationId, command.method, command.params.expectedRevision]); assert.equal(receipt.error, null); assert.equal(receipt.libraryChanged, true);
  assert.equal((await f.call("recoveries", [])).entries.length, 0);
});

test("partial saved cleanup retains provenance; unknown injected files block explicit recovery", windows, async t => {
  const f = await fixture(t), details = await f.theme(), command = f.command("themes.delete", details), challenge = await f.call("propose", [command]); await f.intent(command);
  const stage = path.join(f.state, ".manager-library-delete-" + command.params.operationId.split(":")[1]);
  const hook = await f.hook(`import fs from 'node:fs/promises'; import path from 'node:path'; const original=fs.unlink.bind(fs), target=${JSON.stringify(path.join(stage, "background.png"))};
fs.unlink=async function(file){if(path.resolve(String(file))===target) throw new Error('injected partial cleanup'); return original(file);};`);
  const result = await f.call("executeConfirmed", [command, challenge.fingerprint], hook);
  assert.equal(result.error, null); assert.equal(result.deleted, true); assert.equal(result.cleanupPending, true);
  assert.equal(await present(path.join(stage, "LICENSE.txt")), false); assert.equal(await present(path.join(stage, "background.png")), true);
  const unknown = path.join(stage, "unknown.txt"); await writeFile(unknown, "retain unexpected bytes");
  const page = await f.call("recoveries", []); assert.equal(page.entries.length, 0); assert.equal(page.warnings[0].code, "RECOVERY_CHANGED");
  assert.equal(await readFile(unknown, "utf8"), "retain unexpected bytes");
  // This fixture removes only its own injected neighbor; production performs no sweep.
  await rm(unknown);
  const entry = (await f.call("recoveries", [])).entries[0]; assert.deepEqual(entry.actions, ["cleanupDeleted"]);
  const recovery = { method: "library.recover", params: { operationId: identity(), transactionId: command.params.operationId, expectedRevision: entry.revision, action: "cleanupDeleted" } };
  const confirmed = await f.call("propose", [recovery]); await f.intent(recovery);
  const recovered = await f.call("executeConfirmed", [recovery, confirmed.fingerprint]); assert.equal(recovered.error, null); assert.equal(recovered.recoveryCompleted, true);
  assert.equal(await present(stage), false); assert.equal((await f.journals.read(command.params.operationId)).phase, "final");
});

test("Windows catalog metadata failure retains isolated media; drift is refused and explicit recovery preserves other entries", windows, async t => {
  const f = await fixture(t), details = await f.details({ source: "preset", id: "preset-removable" }), command = f.command("themes.delete", details);
  const catalogFile = path.join(f.presets, "catalog.json"), original = await readFile(catalogFile), keep = await readFile(path.join(f.presets, "keep.png"));
  const removedMedia = await readFile(path.join(f.presets, "removable.png"));
  const challenge = await f.call("propose", [command]); await f.intent(command);
  const hook = await f.hook(`import fs from 'node:fs/promises'; import path from 'node:path'; const original=fs.rename.bind(fs), target=${JSON.stringify(catalogFile)};
fs.rename=async function(from,to){ if(path.resolve(String(to))===target) throw new Error('injected catalog metadata failure'); return original(from,to); };`);
  const result = await f.call("executeConfirmed", [command, challenge.fingerprint], hook);
  assert.ok(result.error); assert.equal(result.deleted, true); assert.equal(result.cleanupPending, true);
  const value = await f.journals.read(command.params.operationId), stage = f.journals.stage(value);
  assert.equal(value.phase, "removed"); assert.equal(await present(path.join(f.presets, "removable.png")), false); assert.equal(await present(path.join(stage, "removable.png")), true);
  assert.deepEqual(await readFile(catalogFile), original);
  await writeFile(catalogFile, JSON.stringify({ ...JSON.parse(original), extra: "unrelated drift" }));
  const drift = await f.call("recoveries", []); assert.equal(drift.entries.length, 0); assert.equal(drift.warnings[0].code, "RECOVERY_CHANGED");
  assert.equal(await present(stage), true);
  await writeFile(catalogFile, original);
  const entry = (await f.call("recoveries", [])).entries[0]; assert.deepEqual(entry.actions, ["cleanupDeleted"]);
  const recovery = { method: "library.recover", params: { operationId: identity(), transactionId: command.params.operationId, expectedRevision: entry.revision, action: "cleanupDeleted" } };
  const confirmed = await f.call("propose", [recovery]); await f.intent(recovery);
  // Intercept only the fixed recycle child-process boundary. Never call the real recycle helper.
  const fakeTrash = path.join(f.root, "fake-trash"), trashScript = path.join(f.app, "windows/scripts/manager-trash.ps1");
  const recycleHook = await f.hook(String.raw`import cp from 'node:child_process'; import fs from 'node:fs'; import {EventEmitter} from 'node:events'; import {syncBuiltinESMExports} from 'node:module';
const original = cp.spawn;
cp.spawn = function(exe, args, options) {
  const index = args?.indexOf('-EncodedCommand') ?? -1;
  if (index >= 0) {
    // Decode the PowerShell command, then its JSON payload; other scripts run normally.
    const command = Buffer.from(args[index + 1], 'base64').toString('utf16le');
    const payload = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(command)?.[1];
    if (payload && JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).script === ${JSON.stringify(trashScript)}) {
      fs.renameSync(${JSON.stringify(stage)}, ${JSON.stringify(fakeTrash)});
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"recycled":true}')); child.emit('close', 0); });
      return child;
    }
  }
  return original(exe, args, options);
};
syncBuiltinESMExports();`);
  // The fixed helper must exist for the production safePath check, but is never executed.
  await writeFile(trashScript, "throw 'Real recycle forbidden in fixture'\n");
  const recovered = await f.call("executeConfirmed", [recovery, confirmed.fingerprint], recycleHook);
  assert.equal(recovered.error, null); assert.equal(recovered.recoveryCompleted, true);
  assert.deepEqual(await readFile(path.join(fakeTrash, "removable.png")), removedMedia);
  assert.equal(await present(stage), false);
  assert.deepEqual(await readFile(path.join(f.presets, "keep.png")), keep);
  assert.deepEqual(JSON.parse(await readFile(catalogFile, "utf8")).themes.map(entry => entry.id), ["paper-light", "keep"]);
  assert.equal((await f.journals.read(command.params.operationId)).phase, "final");
});
