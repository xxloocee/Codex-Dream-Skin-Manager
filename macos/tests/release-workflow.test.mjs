import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, "../../.github/workflows/release.yml");
const workflow = await fs.readFile(workflowPath, "utf8");

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

console.log("PASS: Release workflow binds assets and tag to the exact event commit.");
