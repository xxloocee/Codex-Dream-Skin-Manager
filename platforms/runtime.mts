import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ContractError, record, RUNTIME_METHODS, validOperationId } from "../contracts/manager.mjs";
import { runtimePreflight } from "../core/runtime-preflight.mjs";
import type { RuntimeCommand } from "../contracts/manager.mjs";
import type { RuntimeOutcome, RuntimePort, RuntimePreflight, RuntimeState } from "../core/ports/runtime.mjs";
import { jsonObject, optionalBytes } from "../core/local-files.mjs";
import { durableJson, privateDirectory } from "../core/write-files.mjs";
import { runtimePlatformCall } from "./apply.mjs";
import { captureRuntime } from "../core/runtime-state.mjs";
import { MacOSRuntimeObserver } from "./macos/runtime-observer.mjs";

export class PlatformRuntime implements RuntimePort {
  private readonly observer: MacOSRuntimeObserver;
  constructor(private readonly root: string, private readonly state: string) { this.observer = new MacOSRuntimeObserver(state); }
  async inspect(): Promise<RuntimeState> {
    const windows = process.platform === "win32";
    const probe = windows ? await runtimePlatformCall(this.root, "Probe") : await this.observer.inspect();
    return captureRuntime(this.root, this.state, windows ? "windows" : "macos", probe, "observe");
  }
  async preflight(command: RuntimeCommand): Promise<RuntimePreflight> {
    // Observed status is never an authorization to mutate the application.
    const windows = process.platform === "win32";
    const runtime = await captureRuntime(this.root, this.state, windows ? "windows" : "macos", await runtimePlatformCall(this.root, "Probe"),
      command.method === "skin.pause" ? "pause" : windows ? "observe" : "control");
    return runtimePreflight(command, runtime);
  }
  private receiptFile(id: string) {
    if (!validOperationId(id)) throw new ContractError("INVALID_REQUEST", "Invalid runtime receipt identity.");
    return path.join(this.state, "manager-operations", "runtime-results", createHash("sha256").update(id).digest("hex") + ".json");
  }
  async receipt(id: string, method?: RuntimeCommand["method"], expectedRevision?: string): Promise<RuntimeOutcome | null> {
    const bytes = await optionalBytes(this.receiptFile(id), this.state, 65536); if (!bytes) return null;
    const value = jsonObject(bytes);
    if (value.schemaVersion !== 1 || value.operationId !== id || !(RUNTIME_METHODS as readonly string[]).includes(String(value.method)) || !record(value.outcome)) throw new ContractError("IO_ERROR", "Invalid runtime receipt.");
    if (!method || !expectedRevision || value.method !== method || value.expectedRuntimeRevision !== expectedRevision) return null;
    return this.outcome(value.outcome);
  }
  async execute(command: RuntimeCommand, preflight: RuntimePreflight, confirmed: boolean): Promise<RuntimeOutcome> {
    const runtime = preflight.runtime, directory = path.join(this.state, "manager-operations", "requests"); await privateDirectory(directory);
    const file = path.join(directory, randomUUID() + ".json");
    await durableJson(file, directory, { schemaVersion: 1, runtimeCommand: command, source: command.method === "skin.reset" ? "default" : "active", theme: preflight.targetTheme,
      expectedRevision: preflight.targetRevision, preflightFingerprint: runtime.fingerprint, appearanceRevision: runtime.appearanceRevision, expectedEngineRevision: runtime.engineRevision, previousWatcherIdentity: runtime.watcherIdentity, confirmed }, true);
    let result = this.outcome(await runtimePlatformCall(this.root, command.method === "skin.pause" ? "Pause" : command.method === "skin.restore" ? "Restore" : "Apply", file).catch(async error => {
      const saved = await this.receipt(command.params.operationId, command.method, command.params.expectedRuntimeRevision);
      if (saved) return saved as unknown as Record<string, unknown>;
      throw error;
    }));
    const saved = await this.receipt(command.params.operationId, command.method, command.params.expectedRuntimeRevision);
    if (saved?.effects.themeCommitted === true && saved.effects.rendererApplied === true &&
        (result.effects.themeCommitted !== true || result.effects.rendererApplied !== true)) result = saved;
    if (command.method === "runtime.upgrade" && result.effects.runtimeUpgraded === undefined) result.effects.runtimeUpgraded = null;
    await privateDirectory(path.dirname(this.receiptFile(command.params.operationId)));
    await durableJson(this.receiptFile(command.params.operationId), this.state, { schemaVersion: 1, operationId: command.params.operationId, method: command.method, expectedRuntimeRevision: command.params.expectedRuntimeRevision, outcome: result });

    return result;
  }
  private outcome(value: Record<string, unknown>): RuntimeOutcome {
    if (!record(value.effects)) throw new ContractError("BACKEND_UNAVAILABLE", "Missing runtime effects.");
    const effects = value.effects;
    for (const key of ["themeCommitted", "rendererApplied", "codexRestarted"]) if (![true, false, null].includes(effects[key] as boolean | null)) throw new ContractError("BACKEND_UNAVAILABLE", "Invalid runtime effects.");
    for (const key of ["pausedCommitted", "rendererRemoved"]) if (effects[key] !== undefined && ![true, false, null].includes(effects[key] as boolean | null)) throw new ContractError("BACKEND_UNAVAILABLE", "Invalid pause effects.");
    for (const key of ["appearanceRestored", "runtimeDetached", "backupArchived", "runtimeUpgraded"]) if (effects[key] !== undefined && ![true, false, null].includes(effects[key] as boolean | null)) throw new ContractError("BACKEND_UNAVAILABLE", "Invalid runtime phase effects.");
    const revision = (value: unknown, min = 64) => value === null || typeof value === "string" && new RegExp(`^[a-f0-9]{${min},64}$`).test(value);
    if (!revision(value.committedRevision) || !revision(value.verifiedRendererRevision, 20) || !revision(value.runtimeSessionId) || value.rendererUnavailable !== undefined && typeof value.rendererUnavailable !== "boolean") throw new ContractError("BACKEND_UNAVAILABLE", "Invalid runtime completion response.");
    return { effects: { themeCommitted: effects.themeCommitted as boolean | null, rendererApplied: effects.rendererApplied as boolean | null,
      codexRestarted: effects.codexRestarted as boolean | null, pausedCommitted: effects.pausedCommitted === undefined ? null : effects.pausedCommitted as boolean | null,
      rendererRemoved: effects.rendererRemoved === undefined ? null : effects.rendererRemoved as boolean | null,
      ...(effects.appearanceRestored !== undefined ? { appearanceRestored: effects.appearanceRestored as boolean | null } : {}),
      ...(effects.runtimeDetached !== undefined ? { runtimeDetached: effects.runtimeDetached as boolean | null } : {}),
      ...(effects.backupArchived !== undefined ? { backupArchived: effects.backupArchived as boolean | null } : {}),
      ...(effects.runtimeUpgraded !== undefined ? { runtimeUpgraded: effects.runtimeUpgraded as boolean | null } : {}) },
      committedRevision: value.committedRevision as string | null, verifiedRendererRevision: value.verifiedRendererRevision as string | null,
      runtimeSessionId: value.runtimeSessionId as string | null, rendererUnavailable: value.rendererUnavailable === true };
  }
}
