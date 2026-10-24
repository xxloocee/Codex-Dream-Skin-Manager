import { powerShellArgs } from "./windows/powershell.mjs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ContractError, record, validOperationId } from "../contracts/manager.mjs";
import type { ApplyRefresh, ThemeRef } from "../contracts/manager.mjs";
import type { ApplyOutcome, ApplyPort, ApplyPreflight } from "../core/ports/apply.mjs";
import { safePath } from "../core/local-files.mjs";
import { jsonObject, optionalBytes } from "../core/local-files.mjs";
import { durableJson, privateDirectory } from "../core/write-files.mjs";
import { transactionProcess } from "./transaction-process.mjs";
import { readdir } from "node:fs/promises";
import { activeTheme } from "../core/active-theme.mjs";
import { themeDetails } from "../core/theme-model.mjs";
import { runtimeEngine } from "../core/runtime-engine.mjs";

export class PlatformApply implements ApplyPort {
  constructor(protected readonly root: string, protected readonly state: string) {}
  private async call(action: "Probe" | "Apply" | "Inspect", request?: string): Promise<Record<string, unknown>> {
    return runtimePlatformCall(this.root, action, request);
  }
  async preflight(theme: ThemeRef, _revision: string, refresh?: ApplyRefresh): Promise<ApplyPreflight> {
    const value = await this.call("Probe");
    if (typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.startRequired !== "boolean" || typeof value.recoveryRequired !== "boolean") {
      throw new ContractError("RUNTIME_UNAVAILABLE", "The runtime probe did not return a valid application plan.");
    }
    if (refresh) {
      const platform = process.platform === "win32" ? "windows" : "macos";
      const active = await activeTheme(this.state, platform);
      if (value.startRequired || value.recoveryRequired || value.paused !== false || value.runtimeSessionId !== refresh.runtimeSessionId ||
          !active || active.ref.id !== theme.id || active.ref.source !== theme.source || (await themeDetails(active)).revision !== refresh.activeRevision) {
        throw new ContractError("RUNTIME_CHANGED", "The active skin connection changed; hot refresh will not restart Codex.");
      }
      if (refresh.opacityOnly) {
        const engine = await runtimeEngine(this.root, this.state, platform, await optionalBytes(path.join(this.state, "state.json"), this.state), value.watcherVerified === true);
        if (!engine.engineRevision || engine.runningEngineRevision !== engine.engineRevision) throw new ContractError("RUNTIME_UNAVAILABLE", "The running skin engine needs an explicit update before opacity-only refresh; the video was not reloaded.");
      }
    }
    return { fingerprint: value.fingerprint, requiresConfirmation: value.startRequired || value.recoveryRequired,
      copy: { kind: "applyRestart" }, reason: "需要启动或重启 Codex 以建立皮肤会话。", impact: "正在进行的 Codex 工作可能中断。继续后将重新检查当前会话，再应用所选主题。" };
  }
  private receiptFile(id: string): string {
    if (!validOperationId(id)) throw new ContractError("INVALID_REQUEST", "Invalid apply receipt identity.");
    return path.join(this.state, "manager-operations", "apply-results", createHash("sha256").update(id).digest("hex") + ".json");
  }
  async receipt(id: string, theme: ThemeRef, revision: string): Promise<ApplyOutcome | null> {
    const bytes = await optionalBytes(this.receiptFile(id), this.state, 65536);
    if (!bytes) return this.communityRecovery(id, theme, revision);
    const value = jsonObject(bytes);
    if (value.schemaVersion !== 1 || value.operationId !== id || value.method !== "skin.apply" || value.expectedRevision !== revision || !record(value.theme) || value.theme.id !== theme.id || value.theme.source !== theme.source || !record(value.outcome)) throw new ContractError("IO_ERROR", "Apply receipt does not match this operation.");
    return this.outcome(value.outcome);
  }
  private async communityRecovery(id: string, theme: ThemeRef, revision: string): Promise<ApplyOutcome | null> {
    const directory = path.join(this.state, "manager-operations", "requests");
    let names: string[];
    try { await safePath(directory, this.state); names = await readdir(directory); }
    catch (error) { if (record(error) && error.code === "ENOENT") return null; throw error; }
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const value = jsonObject((await optionalBytes(path.join(directory, name), directory, 16384)) ?? new Uint8Array());
      if (value.operationId !== id || value.community === undefined) continue;
      if (value.schemaVersion !== 1 || value.expectedRevision !== revision || !record(value.theme) || value.theme.id !== theme.id || value.theme.source !== theme.source || !record(value.community) || typeof value.community.recoveryTransaction !== "string" || !/^\.community-apply-[a-f0-9-]{36}$/.test(value.community.recoveryTransaction)) throw new ContractError("IO_ERROR", "Invalid community recovery binding.");
      // A request proves intent and identifies retained recovery material. It
      // never proves a commit or rollback, and querying never invokes a writer.
      return { effects: { themeCommitted: null, rendererApplied: null, codexRestarted: null, rollbackVerified: null }, committedRevision: null, verifiedRendererRevision: null, runtimeSessionId: null, recoveryTransaction: value.community.recoveryTransaction };
    }
    return null;
  }
  async apply(theme: ThemeRef, expectedRevision: string, preflight: ApplyPreflight, confirmed: boolean, operationId?: string, refresh?: ApplyRefresh): Promise<ApplyOutcome> {
    const directory = path.join(this.state, "manager-operations", "requests"); await privateDirectory(directory);
    const file = path.join(directory, randomUUID() + ".json");
    await durableJson(file, directory, { schemaVersion: 1, operationId, theme, expectedRevision, preflightFingerprint: preflight.fingerprint, confirmed, ...(refresh ? { refresh } : {}) }, true);
    const value = await this.call("Apply", file).catch(async error => {
      const saved = operationId ? await this.receipt(operationId, theme, expectedRevision) : null;
      if (saved) return saved as unknown as Record<string, unknown>;
      throw error;
    });
    const outcome = this.outcome(value);
    return this.saveOutcome(file, theme, expectedRevision, outcome, operationId);
  }
  protected async saveOutcome(file: string, theme: ThemeRef, expectedRevision: string, outcome: ApplyOutcome, operationId?: string): Promise<ApplyOutcome> {
    if (operationId) {
      const saved = await this.receipt(operationId, theme, expectedRevision);
      if (saved?.effects.themeCommitted === true && saved.effects.rendererApplied === true &&
          (outcome.effects.themeCommitted !== true || outcome.effects.rendererApplied !== true)) return saved;
      await privateDirectory(path.dirname(this.receiptFile(operationId)));
      await durableJson(this.receiptFile(operationId), this.state, { schemaVersion: 1, operationId, method: "skin.apply", theme, expectedRevision, outcome });
    }
    return outcome;
  }
  async inspect(theme: ThemeRef | null): Promise<ApplyOutcome | null> {
    if (!theme) return null;
    // Observe the active payload directly. Publication receipts describe past
    // commands and need not exist for a session started by an earlier manager.
    return this.outcome(await this.call("Inspect"));
  }
  protected outcome(value: Record<string, unknown>): ApplyOutcome {
    if (!record(value.effects) || ![true, false, null].includes(value.effects.themeCommitted as boolean | null) ||
        ![true, false, null].includes(value.effects.rendererApplied as boolean | null) || ![true, false, null].includes(value.effects.codexRestarted as boolean | null) ||
        (value.committedRevision !== null && (typeof value.committedRevision !== "string" || !/^[a-f0-9]{64}$/.test(value.committedRevision))) ||
        (value.verifiedRendererRevision !== null && (typeof value.verifiedRendererRevision !== "string" || !/^[a-f0-9]{20,64}$/.test(value.verifiedRendererRevision))) ||
        (value.runtimeSessionId !== null && (typeof value.runtimeSessionId !== "string" || !/^[a-f0-9]{64}$/.test(value.runtimeSessionId))) ||
        (value.effects.rollbackVerified !== undefined && ![true, false, null].includes(value.effects.rollbackVerified as boolean | null)) ||
        (value.recoveryTransaction !== undefined && (typeof value.recoveryTransaction !== "string" || !/^\.community-apply-[a-f0-9-]{36}$/.test(value.recoveryTransaction)))) {
      throw new ContractError("BACKEND_UNAVAILABLE", "Invalid platform operation result.");
    }
    return { effects: value.effects as unknown as ApplyOutcome["effects"], committedRevision: value.committedRevision as string | null,
      verifiedRendererRevision: value.verifiedRendererRevision as string | null, runtimeSessionId: value.runtimeSessionId as string | null,
      ...(typeof value.recoveryTransaction === "string" ? { recoveryTransaction: value.recoveryTransaction } : {}) };
  }
}

export async function runtimePlatformCall(root: string, action: "Probe" | "Apply" | "Inspect" | "RuntimeProbe" | "Pause" | "Restore", request?: string): Promise<Record<string, unknown>> {
  const windows = process.platform === "win32", mutating = ["Apply", "Pause", "Restore"].includes(action);
  const script = path.join(root, windows ? "windows" : "macos", "scripts", windows ? "manager-platform.ps1" : "manager-platform.sh");
  await safePath(script, root);
  const system = process.env.SystemRoot;
  if (windows && (!system || !path.isAbsolute(system))) throw new ContractError("BACKEND_UNAVAILABLE", "Windows system directory is unavailable.");
  const executable = windows ? path.join(system!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "/bin/bash";
  const args = windows ? await powerShellArgs(root, script, ["-Action", action, "-ApplicationRoot", root, ...(request ? ["-RequestPath", request] : [])]) : [script, action.toLowerCase(), root, ...(request ? [request] : [])];
  return transactionProcess(executable, args, action === "Apply" || action === "Restore" ? 360000 : action === "Pause" ? 180000 : 45000, mutating, { CODEX_MANAGER_RUNTIME_INTERNAL: "1" });
}
