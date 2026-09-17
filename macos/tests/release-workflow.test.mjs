import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, "../../.github/workflows/release.yml");
const crossPlatformWorkflowPath = path.resolve(here, "../../.github/workflows/cross-platform-runtime.yml");
const packageReleasePath = path.resolve(here, "../../tools/package-release.ps1");
const packageInstallerPath = path.resolve(here, "../../tools/package-installer.ps1");
const installerDefinitionPath = path.resolve(here, "../../packaging/CodexDreamSkinManager.iss");
const readmePath = path.resolve(here, "../../README.md");
const windowsReadmePath = path.resolve(here, "../../windows/README.md");
const windowsEnglishReadmePath = path.resolve(here, "../../windows/README.en.md");
const macosReadmePath = path.resolve(here, "../README.md");
const workflow = await fs.readFile(workflowPath, "utf8");
const crossPlatformWorkflow = await fs.readFile(crossPlatformWorkflowPath, "utf8");
const packageRelease = await fs.readFile(packageReleasePath, "utf8");
const packageInstaller = await fs.readFile(packageInstallerPath, "utf8");
const installerDefinition = await fs.readFile(installerDefinitionPath, "utf8");
const readme = await fs.readFile(readmePath, "utf8");
const windowsReadme = await fs.readFile(windowsReadmePath, "utf8");
const windowsEnglishReadme = await fs.readFile(windowsEnglishReadmePath, "utf8");
const macosReadme = await fs.readFile(macosReadmePath, "utf8");
const crossPlatformLines = crossPlatformWorkflow.split(/\r?\n/);
const macosJobStart = crossPlatformLines.indexOf("  macos-runtime:");
const nextJobStart = crossPlatformLines.findIndex(
  (line, index) => index > macosJobStart && /^  [A-Za-z0-9_-]+:$/.test(line),
);
assert.notEqual(macosJobStart, -1, "The cross-platform workflow must define a macos-runtime job.");
const macosJobEnd = nextJobStart === -1 ? crossPlatformLines.length : nextJobStart;
const macosRuntimeJob = crossPlatformLines.slice(macosJobStart, macosJobEnd).join("\n");

assert.match(
  workflow,
  /^\s+ref: \$\{\{ github\.sha \}\}\s*$/m,
  "The release guard must check out the immutable event commit.",
);
assert.doesNotMatch(
  workflow,
  /^\s+ref: main\s*$/m,
  "The release guard must not check out moving main.",
);
// The Windows manager release job packages directly from the immutable
// checkout and validates the same event SHA before publishing.  The upstream
// macOS workflow exposes those values as shell variables; this workflow uses
// GitHub's PowerShell environment instead.
assert.match(
  workflow,
  /ref: \$\{\{ github\.sha \}\}/,
  "The release candidate must be checked out at the event commit.",
);
assert.match(
  workflow,
  /\$env:GITHUB_SHA/,
  "The release guard must validate the checked-out event commit.",
);
assert.doesNotMatch(
  workflow,
  /main_sha="\$\(git rev-parse origin\/main\)"/,
  "The release candidate must not be rebound to a later origin/main tip.",
);
assert.match(
  macosRuntimeJob,
  /^\s+CODEX_DREAM_SKIN_SKIP_SIGNED_RUNTIME_TESTS: "1"$/m,
  "Headless macOS CI must skip signed-runtime integration tests.",
);
assert.match(
  macosRuntimeJob,
  /^\s+CODEX_DREAM_SKIN_SKIP_DOCTOR: "1"$/m,
  "Headless macOS CI must skip Doctor because no ChatGPT app is installed.",
);
assert.match(macosRuntimeJob, /^\s+run: NODE="\$\(command -v node\)" npm test$/m);

assert.match(workflow, /^  macos:$/m, "The release workflow must build a macOS package.");
assert.match(workflow, /^    runs-on: macos-14$/m, "The macOS release must use a native runner.");
assert.match(workflow, /NODE="\$\(command -v node\)" bash macos\/scripts\/build-dmg\.sh/);
assert.match(workflow, /CodexDreamSkinManager-v\$\{RELEASE_VERSION\}-macos-universal\.dmg/);
assert.match(workflow, /^    needs: \[validate, windows, macos\]$/m);
assert.match(workflow, /SHA256SUMS\.txt/);
assert.match(workflow, /--notes-file "\$notes"/);
assert.match(packageRelease, /CodexDreamSkinManager-v\$Version-windows-x64-portable/);
assert.match(packageInstaller, /CodexDreamSkinManager-v\$Version-windows-x64-setup/);
assert.match(
  installerDefinition,
  /OutputBaseFilename=CodexDreamSkinManager-v\{#AppVersion\}-windows-x64-setup/,
);

for (const asset of [
  "CodexDreamSkinManager-v1.6.1-windows-x64-setup.exe",
  "CodexDreamSkinManager-v1.6.1-windows-x64-portable.zip",
  "CodexDreamSkinManager-v1.6.1-macos-universal.dmg",
  "SHA256SUMS.txt",
]) {
  assert.ok(readme.includes(asset), `README must name release asset: ${asset}`);
}
for (const platformReadme of [windowsReadme, windowsEnglishReadme]) {
  assert.ok(
    platformReadme.includes("CodexDreamSkinManager-vX.Y.Z-windows-x64-setup.exe"),
    "Windows README must name the published installer pattern.",
  );
}
assert.ok(
  macosReadme.includes("CodexDreamSkinManager-vX.Y.Z-macos-universal.dmg"),
  "macOS README must name the published DMG pattern.",
);

console.log("PASS: Release workflow binds the event commit and publishes verified Windows and macOS assets.");
