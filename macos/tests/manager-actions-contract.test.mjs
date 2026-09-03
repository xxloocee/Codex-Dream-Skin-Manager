import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managerSource = await fs.readFile(path.join(root, "scripts", "manager-actions-macos.sh"), "utf8");
const buildSource = await fs.readFile(path.join(root, "scripts", "build-menubar-app.sh"), "utf8");

function assertIncludes(value, fragment, message) {
  assert.ok(value.includes(fragment), message || `Missing contract fragment: ${fragment}`);
}

// The shell adapter must keep the WPF action vocabulary and forward every
// image-theme field to the shared loader.
for (const fragment of [
  "--category \"$CATEGORY\"",
  "--tags-json \"$TAGS_JSON\"",
  "[ -n \"$FOCUS_X\" ] && LOAD_IMAGE_ARGS+=(--focus-x \"$FOCUS_X\")",
  "[ -n \"$FOCUS_Y\" ] && LOAD_IMAGE_ARGS+=(--focus-y \"$FOCUS_Y\")",
  "[ -n \"$ACCENT\" ] && LOAD_IMAGE_ARGS+=(--accent \"$ACCENT\")",
  "--position-x \"$POSITION_X\" --position-y \"$POSITION_Y\" --zoom \"$ZOOM\" --position-mode \"$POSITION_MODE\" --framing true",
]) assertIncludes(managerSource, fragment);
assertIncludes(managerSource, 'IMAGE_THEME_ID="img-$(/bin/date');
assertIncludes(managerSource, '"$SCRIPT_DIR/load-image-theme-macos.sh" "${LOAD_IMAGE_ARGS[@]}"');
assertIncludes(managerSource, '"$STATE_ROOT/themes/$IMAGE_THEME_ID"');
for (const helper of ["validate-image-macos.mjs", "list-manager-themes-macos.mjs", "delete-theme-macos.mjs", "import-batch-macos.mjs"]) {
  assertIncludes(buildSource, `  ${helper}`);
  assertIncludes(buildSource, `[ -f "$ROOT/scripts/$name" ]`);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-manager-contract-"));
const home = path.join(tempRoot, "home");
const stateRoot = path.join(home, "Library", "Application Support", "CodexDreamSkinStudio");
const themesRoot = path.join(stateRoot, "themes");
const requestsRoot = path.join(stateRoot, "requests");
const imagesRoot = path.join(tempRoot, "images");
await fs.mkdir(imagesRoot, { recursive: true });
const imagePath = path.join(imagesRoot, "fixture.jpg");
await fs.writeFile(imagePath, Buffer.from("fixture-image-bytes"));

// A fake loader records argv and emits a valid theme pack. This isolates the
// batch manager contract from macOS sips and from a live ChatGPT process.
const loaderModulePath = path.join(tempRoot, "fake-loader.mjs");
await fs.writeFile(loaderModulePath, `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const get = (name) => args[args.indexOf(name) + 1];
const home = process.env.HOME;
const id = get("--theme-id");
const root = path.join(home, "Library", "Application Support", "CodexDreamSkinStudio", "themes", id);
await fs.mkdir(root, { recursive: true });
await fs.writeFile(path.join(root, "background.jpg"), Buffer.from("prepared-image"));
const tags = JSON.parse(get("--tags-json"));
const theme = { schemaVersion: 1, id, name: get("--name"), image: "background.jpg", category: get("--category"), tags, appearance: get("--appearance"), colors: { accent: get("--accent") }, art: { safeArea: get("--safe-area"), taskMode: get("--task-mode"), focusX: Number(get("--focus-x")), focusY: Number(get("--focus-y")), positionX: Number(get("--position-x")), positionY: Number(get("--position-y")), zoom: Number(get("--zoom")), positionMode: get("--position-mode"), framingEnabled: args.includes("--framing") } };
await fs.writeFile(path.join(root, "theme.json"), JSON.stringify(theme));
await fs.appendFile(process.env.LOADER_LOG, JSON.stringify(args) + "\\n");
`);
const loaderPath = process.platform === "win32"
  ? path.join(tempRoot, "fake-loader.cmd")
  : path.join(tempRoot, "fake-loader.sh");
if (process.platform === "win32") {
  await fs.writeFile(loaderPath, `@"${process.execPath}" "%~dp0fake-loader.mjs" %*\r\n`);
} else {
  await fs.writeFile(loaderPath, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-loader.mjs" "$@"\n`, { mode: 0o700 });
}

const requestPath = path.join(requestsRoot, "batch.json");
await fs.mkdir(requestsRoot, { recursive: true });
const item = {
  imagePath,
  name: "Contract theme",
  appearance: "dark",
  category: "illustration",
  tags: ["one", "two"],
  safeArea: "right",
  taskMode: "banner",
  focusX: 0.2,
  focusY: 0.8,
  framingEnabled: true,
  positionX: -0.25,
  positionY: 0.4,
  zoom: 1.4,
  positionMode: "free",
  accent: "#12AbEf",
};
await fs.writeFile(requestPath, JSON.stringify({ schemaVersion: 1, items: [item, item] }));
const logPath = path.join(tempRoot, "loader.log");

function runNode(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const env = { ...process.env, HOME: home, LOADER_LOG: logPath };
const batch = await runNode(path.join(root, "scripts", "import-batch-macos.mjs"), [requestPath, loaderPath], env);
assert.equal(batch.code, 0, batch.stderr);
const batchResult = JSON.parse(batch.stdout);
assert.deepEqual(
  { imported: batchResult.imported, skipped: batchResult.skipped, failed: batchResult.failed },
  { imported: 1, skipped: 1, failed: 0 },
  JSON.stringify(batchResult.results),
);
assert.match(batchResult.results[0].themeDirectory, /[\\/]themes[\\/]img-[0-9]+-[0-9a-f]{8}$/);
assert.equal(batchResult.results[1].status, "skipped");
const loggedArgs = JSON.parse((await fs.readFile(logPath, "utf8")).trim());
for (const pair of [["--category", "illustration"], ["--safe-area", "right"], ["--task-mode", "banner"], ["--focus-x", "0.2"], ["--focus-y", "0.8"], ["--position-x", "-0.25"], ["--position-y", "0.4"], ["--zoom", "1.4"], ["--position-mode", "free"], ["--accent", "#12AbEf"]]) {
  const index = loggedArgs.indexOf(pair[0]);
  assert.equal(loggedArgs[index + 1], pair[1], `${pair[0]} was not forwarded`);
}
assert.deepEqual(JSON.parse(loggedArgs[loggedArgs.indexOf("--tags-json") + 1]), ["one", "two"]);
const importedThemeId = loggedArgs[loggedArgs.indexOf("--theme-id") + 1];
assert.match(importedThemeId, /^img-[0-9]+-[0-9a-f]{8}$/);
const importedTheme = JSON.parse(await fs.readFile(path.join(themesRoot, importedThemeId, "theme.json"), "utf8"));
assert.equal(importedTheme.id, path.basename(batchResult.results[0].themeDirectory));
assert.equal(importedTheme.managerFingerprintVersion, 2);
assert.equal(typeof importedTheme.managerFingerprint, "string");

// Deletion must reject a nested symbolic link before moving the directory to
// quarantine. This protects the manager's archive boundary on macOS.
const deleteId = "custom-delete-fixture";
const deleteDir = path.join(themesRoot, deleteId);
await fs.mkdir(deleteDir, { recursive: true });
await fs.writeFile(path.join(deleteDir, "theme.json"), JSON.stringify({ id: deleteId, name: "Delete fixture", image: "background.jpg" }));
await fs.writeFile(path.join(deleteDir, "background.jpg"), Buffer.from("image"));
let symlinkAvailable = true;
try {
  await fs.symlink(imagePath, path.join(deleteDir, "unsafe-link"));
} catch (error) {
  if (process.platform === "win32" && error?.code === "EPERM") symlinkAvailable = false;
  else throw error;
}
if (symlinkAvailable) {
  const deleted = await runNode(path.join(root, "scripts", "delete-theme-macos.mjs"), [stateRoot, deleteDir], env);
  assert.notEqual(deleted.code, 0);
  assert.match(deleted.stderr, /符号链接|symbolic/i);
  assert.equal((await fs.lstat(deleteDir)).isDirectory(), true);
}

await fs.rm(tempRoot, { recursive: true, force: true });
console.log("manager actions contract passed");
