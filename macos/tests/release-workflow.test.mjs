import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, "../../.github/workflows/release.yml");
const crossPlatformWorkflowPath = path.resolve(here, "../../.github/workflows/cross-platform-runtime.yml");
const workflow = await fs.readFile(workflowPath, "utf8");
const crossPlatformWorkflow = await fs.readFile(crossPlatformWorkflowPath, "utf8");
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

console.log("PASS: Release workflow binds the event commit and headless macOS CI skips installed-app checks.");
