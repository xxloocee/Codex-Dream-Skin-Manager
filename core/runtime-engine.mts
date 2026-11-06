import path from "node:path";
import { fileBytes, fileStamp, optionalBytes, jsonObject, sha256 } from "./local-files.mjs";

// A revision describes the fixed package engine, never a caller supplied path.
const revisions = new Map<string, { stamp: string; revision: string }>();
export async function engineRevision(root: string, platform: "windows" | "macos", observe = false): Promise<string> {
  const files = ["scripts/injector.mjs", "scripts/cdp-transport.mjs", "scripts/injection-engine.mjs", "scripts/watcher-engine.mjs", "scripts/power-state.mjs", "scripts/media-cache.mjs", "scripts/theme-payload.mjs", "scripts/renderer-session.mjs", "scripts/renderer-verification.mjs",
    "scripts/image-metadata.mjs", "scripts/video-decode-probe.mjs", "scripts/validate-video-file.mjs",
    "assets/renderer-inject.js", "assets/dream-skin.css", "assets/selectors.json", "assets/safe-css-validator.mjs",
    "assets/safe-css-policy.json", "assets/theme-package-validator.mjs"];
  const key = path.join(root, platform);
  const stamp = async () => JSON.stringify(await Promise.all(files.map(name => fileStamp(path.join(root, platform, name), root))));
  const before = observe ? await stamp() : null, cached = revisions.get(key);
  if (before !== null && cached?.stamp === before) return cached.revision;
  const parts: Uint8Array[] = [Buffer.from(platform)];
  for (const name of files) parts.push(Buffer.from(name), await fileBytes(path.join(root, platform, name), root, 4 * 1024 * 1024));
  const revision = sha256(parts);
  if (before !== null && await stamp() === before) {
    if (revisions.size >= 4) revisions.delete(revisions.keys().next().value!);
    revisions.set(key, { stamp: before, revision });
  }
  return revision;
}
export async function runtimeEngine(root: string, state: string, platform: "windows" | "macos", stateBytes: Uint8Array | null, watcherVerified: boolean, observe = false) {
  let expected: string | null = null;
  try { expected = await engineRevision(root, platform, observe); } catch { /* incomplete package cannot upgrade */ }
  let running: string | null = null;
  if (stateBytes && watcherVerified) {
    const current = jsonObject(stateBytes);
    const bytes = await optionalBytes(path.join(state, "manager-operations", "engine-session.json"), state, 65536);
    if (bytes) {
      const session = jsonObject(bytes);
      if (session.schemaVersion === 1 && session.pid === current.injectorPid && session.startedAt === current.injectorStartedAt &&
          session.injectorPath === current.injectorPath && session.nodePath === current.nodePath &&
          typeof session.engineRevision === "string" && /^[a-f0-9]{64}$/.test(session.engineRevision)) running = session.engineRevision;
    }
  }
  // Missing session evidence means unknown, not an outdated running engine.
  return { engineRevision: expected, runningEngineRevision: running, upgradeRequired: expected !== null && running !== null && expected !== running };
}
