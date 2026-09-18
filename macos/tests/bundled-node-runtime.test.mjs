import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Run the production shell functions, replacing only macOS platform commands.
// This checks control flow on non-Mac hosts; it does not validate real Mach-O signatures.
const commonPath = fileURLToPath(new URL('../scripts/common-macos.sh', import.meta.url));
const source = readFileSync(commonPath, 'utf8').replaceAll('\r\n', '\n');
const functions = ['codesign_team_id', 'remember_validated_runtime_identity',
  'require_signed_node_runtime', 'verify_macos_app_signature'].map(name => {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `production function ${name} must exist`);
  return match[0];
}).join('\n').replaceAll('/usr/bin/codesign', 'mock_codesign')
  .replaceAll('/usr/bin/uname', 'mock_uname').replaceAll('/usr/bin/file', 'mock_file');

function findBash() {
  if (process.env.BASH) return process.env.BASH;
  if (process.platform !== 'win32') return '/bin/bash';
  const git = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0];
  const candidates = [git && path.resolve(path.dirname(git), '../bin/bash.exe'),
    'C:/Program Files/Git/bin/bash.exe'];
  const found = candidates.find(candidate => candidate && existsSync(candidate));
  assert.ok(found, 'Git Bash is required on Windows (or set BASH)');
  return found;
}
const bash = findBash();
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function runRuntime(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'skin bundled node '));
  try {
    const project = path.join(root, 'engine with spaces');
    const bin = path.join(project, 'runtime/node/bin');
    mkdirSync(bin, { recursive: true });
    if (!options.missingLicense) writeFileSync(path.join(project, 'runtime/node/LICENSE'), 'Node test license');
    const events = path.join(root, 'events');
    writeFileSync(events, '');
    const nodeScript = `#!/bin/bash
printf 'node:%s\\n' "$1" >> "$EVENTS"
case "$1" in
  --version) printf '%s\\n' "$MOCK_VERSION" ;;
  -e) exec "$REAL_NODE" -e "globalThis.WebSocket = function() {}; globalThis.fetch = function() {}; $MISSING_GLOBAL $2" ;;
  *) exit 93 ;;
esac
`;
    if (!options.missingNode) writeFileSync(path.join(bin, 'node'), nodeScript, { mode: 0o755 });
    const externalBin = path.join(root, 'external node bin');
    const codexBin = path.join(root, 'Official Codex.app/Contents/Resources/cua_node/bin');
    mkdirSync(externalBin, { recursive: true });
    mkdirSync(codexBin, { recursive: true });
    const external = path.join(externalBin, 'node');
    const fallbackScript = '#!/bin/bash\nprintf "EXTERNAL NODE EXECUTED\\n" >> "$EVENTS"\nexit 92\n';
    writeFileSync(external, fallbackScript, { mode: 0o755 });
    writeFileSync(path.join(codexBin, 'node'), fallbackScript, { mode: 0o755 });
    const harness = `set -euo pipefail
fail() { printf '%s\\n' "$*" >&2; exit 1; }
mock_uname() { case "$1" in -s) printf 'Darwin\\n';; -m) printf 'arm64\\n';; *) return 94;; esac; }
mock_codesign() {
  printf 'codesign:%s\\n' "$*" >> "$EVENTS"
  local target="\u0024{!#}"
  if [ "$1" = '-dv' ]; then
    if [ "$target" = "$CODEX_BUNDLE" ]; then printf 'TeamIdentifier=%s\\n' "$MOCK_TEAM"; else printf 'TeamIdentifier=NODEJS_OTHER_TEAM\\n'; fi
    return 0
  fi
  if [ "$target" = "$CODEX_BUNDLE" ]; then return "$APP_SIGNATURE_STATUS"; fi
  return "$NODE_SIGNATURE_STATUS"
}
mock_file() {
  printf 'file:%s\\n' "$*" >> "$EVENTS"
  if [ "$ARCH_STATUS" = 0 ]; then printf 'Mach-O 64-bit executable arm64\\n'; else printf 'Mach-O 64-bit executable x86_64\\n'; fi
}
PROJECT_ROOT=${quote(shellPath(project))}
CODEX_BUNDLE=${quote(shellPath(path.join(root, 'Official Codex.app')))}
CODEX_EXE="$CODEX_BUNDLE/Contents/MacOS/Codex"
EXPECTED_CODEX_TEAM_ID='2DC432GLL2'
EXPECTED_CODEX_REQUIREMENT='official-app-test-requirement'
NODE=${quote(shellPath(external))}
PATH=${quote(shellPath(externalBin))}:"$PATH"
${functions}
require_signed_node_runtime
printf 'SELECTED=%s\\nVERSION=%s\\nREMEMBERED=%s\\n' "$NODE" "$NODE_VERSION" "$DREAM_SKIN_VALIDATED_RUNTIME_NODE"
`;
    const script = path.join(root, 'check.sh');
    writeFileSync(script, harness);
    const result = spawnSync(bash, [shellPath(script)], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, EVENTS: shellPath(events), REAL_NODE: shellPath(process.execPath),
        MOCK_VERSION: options.version ?? 'v22.22.1', MOCK_TEAM: options.team ?? '2DC432GLL2',
        MISSING_GLOBAL: options.missingGlobal ? `delete globalThis.${options.missingGlobal};` : '',
        APP_SIGNATURE_STATUS: options.appSignature ? '1' : '0',
        NODE_SIGNATURE_STATUS: options.nodeSignature ? '1' : '0', ARCH_STATUS: options.arch ? '1' : '0' },
    });
    assert.ifError(result.error);
    const trace = readFileSync(events, 'utf8');
    assert.doesNotMatch(trace, /EXTERNAL NODE EXECUTED/, 'must never execute NODE, PATH, or Codex fallback runtimes');
    return { ...result, trace, expectedNode: shellPath(path.join(bin, 'node')) };
  } finally {
    // Only remove the uniquely generated fixture, never application/user state.
    rmSync(root, { recursive: true, force: true });
  }
}

test('selects bundled Node in a path containing spaces, probes capabilities, and records its identity', () => {
  const result = runRuntime();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`SELECTED=${result.expectedNode}\n`));
  assert.ok(result.stdout.includes(`REMEMBERED=${result.expectedNode}\n`));
  assert.match(result.trace, /node:--version\nnode:-e\n/);
  assert.match(result.trace, /file:-b /);
  assert.doesNotMatch(functions, /^\s*\/usr\/bin\/lipo\b/m, 'runtime must not invoke the developer-tools shim');
  const nodeSignature = result.trace.split('\n').find(line => line.startsWith('codesign:') && line.endsWith(result.expectedNode));
  assert.ok(nodeSignature?.includes('--verify --strict'), 'must verify the bundled executable signature');
  assert.ok(!nodeSignature.includes('--test-requirement'), 'bundled Node must not require the OpenAI signing identity');
});

for (const [name, options, message, canExecuteNode] of [
  ['Node 20', { version: 'v20.19.0' }, /22|old/i, true],
  ['malformed version', { version: 'invalid' }, /version|parse/i, true],
  ['missing WebSocket', { missingGlobal: 'WebSocket' }, /WebSocket|capabilit|API|runtime/i, true],
  ['missing fetch', { missingGlobal: 'fetch' }, /fetch|capabilit|API|runtime/i, true],
  ['missing bundled Node', { missingNode: true }, /found|missing|runtime/i, false],
  ['missing license', { missingLicense: true }, /license/i, false],
  ['invalid Node signature', { nodeSignature: true }, /signature/i, false],
  ['unsupported architecture', { arch: true }, /architecture|arm64/i, false],
  ['invalid official app signature', { appSignature: true }, /signature/i, false],
  ['unexpected official app team', { team: 'UNTRUSTED' }, /team/i, false],
]) {
  test(`rejects ${name} without falling back to an external runtime`, () => {
    const result = runRuntime(options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    if (!canExecuteNode) assert.doesNotMatch(result.trace, /^node:/m, 'reject before executing Node');
  });
}

for (const action of ['commit', 'rollback']) {
  test(`installer ${action} preserves the correct bundled runtime using real rsync`, {
    skip: process.platform !== 'darwin' ? 'Requires macOS installer tools and real /usr/bin/rsync' : false,
  }, () => {
    const installer = readFileSync(new URL('../scripts/install-dream-skin-macos.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const deploymentFunctions = ['deploy_project', 'commit_deployed_project', 'rollback_deployed_project'].map(name => {
      const match = installer.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
      assert.ok(match, `installer function ${name} must exist`);
      return match[0];
    }).join('\n');
    const root = mkdtempSync(path.join(tmpdir(), 'skin runtime deployment '));
    try {
      const project = path.join(root, 'packaged engine');
      const installed = path.join(root, 'installed engine');
      for (const [directory, version] of [[project, 'new'], [installed, 'old']]) {
        mkdirSync(path.join(directory, 'runtime/node/bin'), { recursive: true });
        writeFileSync(path.join(directory, 'runtime/node/bin/node'), `#!/bin/bash\nprintf '${version} runtime\\n'\n`, { mode: 0o755 });
        writeFileSync(path.join(directory, 'runtime/node/LICENSE'), `${version} license\n`);
      }
      const script = path.join(root, 'install-fixture.sh');
      writeFileSync(script, `set -euo pipefail
fail() { printf '%s\\n' "$*" >&2; exit 1; }
PROJECT_ROOT=${quote(project)}
INSTALL_ROOT=${quote(installed)}
DEPLOY_PREVIOUS=''
${deploymentFunctions}
deploy_project
"$INSTALL_ROOT/runtime/node/bin/node"
/usr/bin/cmp "$PROJECT_ROOT/runtime/node/LICENSE" "$INSTALL_ROOT/runtime/node/LICENSE"
[ -x "$DEPLOY_PREVIOUS/runtime/node/bin/node" ]
${action === 'commit' ? 'commit_deployed_project' : 'if rollback_deployed_project 7; then exit 95; else [ "$?" -eq 7 ]; fi'}
[ -z "$DEPLOY_PREVIOUS" ]
`);
      const result = spawnSync('/bin/bash', [script], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'new runtime\n', 'deployed bundle must execute before commit/rollback');
      const retained = action === 'commit' ? 'new' : 'old';
      const nodePath = path.join(installed, 'runtime/node/bin/node');
      assert.match(readFileSync(nodePath, 'utf8'), new RegExp(`${retained} runtime`));
      assert.ok(statSync(nodePath).mode & 0o111, 'retained Node remains executable');
      assert.equal(readFileSync(path.join(installed, 'runtime/node/LICENSE'), 'utf8'), `${retained} license\n`);
      assert.ok(!readdirSync(root).some(name => /^installed engine\.(previous|broken|installing)\./.test(name)), 'transaction directories must be cleaned');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
