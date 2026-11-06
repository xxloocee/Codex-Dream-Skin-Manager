import path from "node:path";
import os from "node:os";
import { ContractError } from "../contracts/manager.mjs";
import { MAX_CONFIG_BYTES, optionalBytes, sha256 } from "./local-files.mjs";
import { readAdapter } from "../platforms/factory.mjs";
import { observedThemeDetails, themeDetails, themeListStamp } from "./theme-model.mjs";
import type { LocalTheme } from "./ports/platform.mjs";

const defaults = new Map<string, { local: LocalTheme; stamp: string }>();
export async function defaultRuntimeTheme(applicationRoot: string, observe = false) {
  // macOS resolves legacy aliases using the current active theme identity.
  const cacheSelection = observe && process.platform === "win32";
  const cached = cacheSelection ? defaults.get(applicationRoot) : null;
  if (cached && await themeListStamp(cached.local).catch(() => null) === cached.stamp) return cached.local;
  defaults.delete(applicationRoot);
  const adapter = readAdapter(applicationRoot);
  // macOS stores the default at two known legacy aliases. A status read must
  // not enumerate every user theme just to locate either of those files.
  if (adapter.defaultTheme) return adapter.defaultTheme();
  const id = process.platform === "win32" ? "preset-paper-light" : "preset-gothic-void-crusade";
  const themes = (await adapter.inventory()).themes;
  const local = themes.find(theme => theme.ref.source === "preset" && theme.ref.id === id) ??
    (process.platform === "darwin" ? themes.find(theme => theme.ref.id === "gothic-void-crusade") : null) ?? null;
  if (cacheSelection && local) {
    if (defaults.size >= 4) defaults.delete(defaults.keys().next().value!);
    defaults.set(applicationRoot, { local, stamp: await themeListStamp(local) });
  }
  return local;
}
export async function runtimeTargets(applicationRoot: string, state: string, observe = false) {
  // Missing or invalid defaults disable reset; they never select another preset.
  const local = await defaultRuntimeTheme(applicationRoot, observe).catch(() => null);
  const details = local ? await (observe ? observedThemeDetails(local) : themeDetails(local)).catch(() => { defaults.delete(applicationRoot); return null; }) : null;
  const appearance = await appearanceState(state).catch(error => {
    if (!observe) throw error;
    return { appearanceRevision: sha256([]), restoreAvailable: false };
  });
  return { defaultTheme: details?.ref ?? null, defaultRevision: details?.revision ?? null, ...appearance };
}
export async function appearanceState(state: string) {
  const codexHome = process.platform === "darwin" ? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex") : path.join(os.homedir(), ".codex");
  if (!path.isAbsolute(codexHome)) throw new ContractError("RUNTIME_UNAVAILABLE", "CODEX_HOME must be an absolute profile directory.");
  const config = path.join(codexHome, "config.toml");
  const backup = path.join(state, process.platform === "win32" ? "config.before-dream-skin.toml" : "theme-backup.json");
  const files = [config, backup, ...(process.platform === "win32" ? [backup + ".appearance.json", backup + ".startup-appearance.json"] : [])];
  const bytes = await Promise.all(files.map(file => optionalBytes(file, file === config ? path.dirname(config) : state, MAX_CONFIG_BYTES, 0)));
  return { appearanceRevision: sha256([Buffer.from(JSON.stringify(bytes.map(value => value !== null))), ...bytes.map(value => value ?? new Uint8Array())]),
    restoreAvailable: bytes[0] !== null && bytes[1] !== null };
}
