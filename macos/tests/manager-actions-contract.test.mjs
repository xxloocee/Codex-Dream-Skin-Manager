import assert from "node:assert/strict";
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

// Exercise the current library backend; only media decoding is isolated from
// the live renderer. Batch import must preserve source bytes and render options.
const scriptsRoot = path.join(tempRoot, "scripts");
await fs.mkdir(scriptsRoot);
await fs.mkdir(path.join(tempRoot, "assets"));
for (const name of ["gui-library.mjs", "gui-package.mjs"]) {
  await fs.copyFile(path.join(root, "scripts", name), path.join(scriptsRoot, name));
}
await fs.copyFile(path.join(root, "assets", "safe-css-validator.mjs"), path.join(tempRoot, "assets", "safe-css-validator.mjs"));
await fs.writeFile(path.join(scriptsRoot, "validate-image-macos.mjs"), "process.exit(0);\n");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
await fs.writeFile(path.join(scriptsRoot, "gui-library.sh"),
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(scriptsRoot, "gui-library.mjs"))} ${quote(stateRoot)} "$@"\n`, {mode: 0o700});
const loaderPath = path.join(scriptsRoot, "load-image-theme-macos.sh");

const requestPath = path.join(requestsRoot, "batch.json");
await fs.mkdir(requestsRoot, { recursive: true });
const item = {
  imagePath,
  name: "Contract theme",
  appearance: "dark",
  category: "custom",
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

const env = { ...process.env, HOME: home };
const batch = await runNode(path.join(root, "scripts", "import-batch-macos.mjs"), [requestPath, loaderPath], env);
assert.equal(batch.code, 0, batch.stderr);
const batchResult = JSON.parse(batch.stdout);
assert.deepEqual(
  { imported: batchResult.imported, skipped: batchResult.skipped, failed: batchResult.failed },
  { imported: 1, skipped: 1, failed: 0 },
  JSON.stringify(batchResult.results),
);
assert.match(path.basename(batchResult.results[0].themeDirectory), /^custom-[0-9a-f-]{36}$/);
assert.equal(batchResult.results[1].status, "skipped");
assert.equal(batchResult.results[1].themeDirectory, batchResult.results[0].themeDirectory);
const importedTheme = JSON.parse(await fs.readFile(path.join(batchResult.results[0].themeDirectory, "theme.json"), "utf8"));
assert.equal(importedTheme.id, path.basename(batchResult.results[0].themeDirectory));
assert.equal(importedTheme.name, item.name);
assert.equal(importedTheme.category, item.category);
assert.deepEqual(importedTheme.tags, item.tags);
assert.equal(importedTheme.appearance, item.appearance);
assert.equal(importedTheme.colors.accent, item.accent);
for (const key of ["safeArea", "taskMode", "focusX", "focusY", "framingEnabled", "positionX", "positionY", "zoom", "positionMode"]) {
  assert.equal(importedTheme.art[key], item[key], `${key} was not preserved`);
}
assert.deepEqual(await fs.readFile(path.join(batchResult.results[0].themeDirectory, importedTheme.image)), await fs.readFile(imagePath));
// A different crop must remain distinct, while an invalid item must not prevent
// other items from completing or leave temporary requests behind.
await fs.writeFile(requestPath, JSON.stringify({schemaVersion: 1, items: [{...item, zoom: 1.8}, {...item, imagePath: path.join(imagesRoot, "missing.jpg")}, item]}));
const secondBatch = await runNode(path.join(root, "scripts", "import-batch-macos.mjs"), [requestPath, loaderPath], env);
assert.equal(secondBatch.code, 0, secondBatch.stderr);
const secondResult = JSON.parse(secondBatch.stdout);
assert.deepEqual([secondResult.imported, secondResult.failed, secondResult.skipped], [1, 1, 1]);
assert.notEqual(secondResult.results[0].themeDirectory, batchResult.results[0].themeDirectory);
assert.deepEqual(await fs.readdir(requestsRoot), ["batch.json"]);

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
