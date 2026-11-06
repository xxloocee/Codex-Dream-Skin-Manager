import path from "node:path";
import { ContractError } from "../../contracts/manager.mjs";
import type { ThemeRef } from "../../contracts/manager.mjs";
import { readLocalTheme, safePath } from "../../core/local-files.mjs";
import type { PlatformPort, PlatformStatus, ThemeInventory } from "../../core/ports/platform.mjs";
import { activeId, catalogEntries, existingTheme, readVersion, scanLibrary } from "../local-library.mjs";
import { readProcess } from "../read-process.mjs";

export class MacOSReadAdapter implements PlatformPort {
  readonly name = "macos";
  private readonly skillRoot: string;
  constructor(private readonly applicationRoot: string, private readonly stateRoot: string) {
    this.skillRoot = path.join(applicationRoot, "macos");
  }
  applicationVersion(): Promise<string | null> { return readVersion(path.join(this.skillRoot, "VERSION"), this.skillRoot); }
  async defaultTheme() {
    const preferred = "preset-gothic-void-crusade", legacy = "gothic-void-crusade";
    const current = await activeId(path.join(this.stateRoot, "theme", "theme.json"), this.stateRoot).catch(() => null);
    const ids = current?.toLowerCase() === legacy ? [legacy, preferred] : [preferred, legacy];
    for (const id of ids) {
      try { return await readLocalTheme(path.join(this.stateRoot, "themes", id), id.startsWith("preset-") ? "preset" : "saved", 0); }
      catch { /* Missing or invalid aliases never select an unrelated theme. */ }
    }
    return null;
  }
  async inventory(): Promise<ThemeInventory> {
    let catalog = await catalogEntries(path.join(this.applicationRoot, "manager-catalog.json"), this.applicationRoot);
    if (!catalog) catalog = await catalogEntries(path.join(this.applicationRoot, "windows", "presets", "catalog.json"), this.applicationRoot);
    const order = new Map(catalog?.entries.map((entry, index) => [`preset-${entry.id as string}`, index]) ?? []);
    const result = await scanLibrary(path.join(this.stateRoot, "themes"), id => id.startsWith("preset-") ? "preset" : "saved",
      id => order.get(id) ?? (id.startsWith("preset-") ? 1000 : 2000));
    if (!catalog) result.warnings.push({ code: "CATALOG_UNAVAILABLE", message: "Preset catalog order is unavailable." });
    // Match SavedThemeLibrary.swift without renaming either on-disk identity.
    const aliases = new Set(["gothic-void-crusade", "preset-gothic-void-crusade"]);
    const current = await activeId(path.join(this.stateRoot, "theme", "theme.json"), this.stateRoot).catch(() => {
      result.warnings.push({ code: "ACTIVE_THEME_UNRESOLVED", message: "The active theme identity is unreadable; preset aliases use their default preference." });
      return null;
    });
    const candidates = result.themes.filter(theme => aliases.has(theme.ref.id.toLowerCase()));
    const chosen = candidates.find(theme => theme.ref.id.toLowerCase() === current?.toLowerCase())
      ?? candidates.find(theme => theme.ref.id.toLowerCase() === "preset-gothic-void-crusade") ?? candidates[0];
    result.themes = result.themes.filter(theme => !aliases.has(theme.ref.id.toLowerCase()) || theme === chosen);
    return result;
  }
  async status(): Promise<PlatformStatus> {
    const script = path.join(this.skillRoot, "scripts", "status-dream-skin-macos.sh");
    await safePath(script, this.skillRoot);
    const env = { ...process.env };
    // The status script enumerates themes only when NODE is set. This is a state-only probe.
    delete env.NODE;
    const value = await readProcess("/bin/bash", [script, "--json"], env);
    if (typeof value.session !== "string" || typeof value.injectorAlive !== "boolean" || typeof value.isPaused !== "boolean") {
      throw new ContractError("BACKEND_UNAVAILABLE", "Invalid macOS status contract.");
    }
    const health: PlatformStatus["health"] = (value.session === "active" || value.session === "paused") && value.injectorAlive === true ? "healthy"
      : value.session === "paused" || value.session === "off" ? "stopped" : value.session === "stale" ? "stale"
      : value.session === "applying" ? "degraded" : "unknown";
    return { activeId: typeof value.activeThemeId === "string" && value.activeThemeId ? value.activeThemeId : null,
      paused: value.isPaused, health, appliedId: typeof value.appliedThemeId === "string" && value.appliedThemeId ? value.appliedThemeId : null,
      busy: value.session === "applying" || ["applying", "pausing"].includes(String(value.operation)), diagnostics: [
        { code: "RENDERER_UNVERIFIED", message: "Legacy macOS status does not verify current renderer content." },
        ...(health === "unknown" ? [{ code: "ENGINE_UNINSPECTED", message: "The legacy process status is inconclusive." }] : []),
      ] };
  }
  async resolveActive(id: string): Promise<ThemeRef | null> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) return null;
    const source = id.startsWith("preset-") ? "preset" : "saved";
    return await existingTheme(path.join(this.stateRoot, "themes"), id, source) ? { source, id } : null;
  }
}
