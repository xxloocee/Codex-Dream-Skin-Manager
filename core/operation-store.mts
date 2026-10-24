import { pruneHistory } from "./history-retention.mjs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ContractError, confirmationCopy, ERROR_CODES, parseApplyRefresh, parseThemeRef, record, RUNTIME_METHODS, validOperationId } from "../contracts/manager.mjs";
import type { ApplyRefresh, OperationSnapshot } from "../contracts/manager.mjs";
import type { ApplyPreflight } from "./ports/apply.mjs";
import { jsonObject, optionalBytes, fileBytes, safePath } from "./local-files.mjs";
import { durableJson, privateDirectory } from "./write-files.mjs";

export interface OperationRecord { schemaVersion: 1; requestDigest: string; operation: OperationSnapshot; preflight: ApplyPreflight | null; refresh?: ApplyRefresh }
export class OperationStore {
  private readonly directory: string;
  constructor(root: string) { this.directory = path.join(root, "manager-operations", "ledger"); }
  private file(id: string): string {
    if (!validOperationId(id)) throw new ContractError("INVALID_REQUEST", "Invalid operation identity.");
    return path.join(this.directory, createHash("sha256").update(id).digest("hex") + ".json");
  }
  async read(id: string): Promise<OperationRecord | null> {
    const bytes = await optionalBytes(this.file(id), this.directory, 64 * 1024);
    if (!bytes) return null;
    const value = jsonObject(bytes);
    if (value.schemaVersion !== 1 || typeof value.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.requestDigest) ||
        !record(value.operation) || value.operation.id !== id || !["skin.apply", ...RUNTIME_METHODS, "themes.update", "themes.copy", "themes.create", "themes.importPackage", "themes.delete", "library.recover"].includes(String(value.operation.method)) ||
        !["queued", "running", "awaitingConfirmation", "succeeded", "failed", "cancelled", "indeterminate"].includes(String(value.operation.state)) ||
        !record(value.operation.effects) || !record(value.operation.theme) || typeof value.operation.expectedRevision !== "string" ||
        (value.preflight !== null && (!record(value.preflight) || typeof value.preflight.fingerprint !== "string"))) {
      throw new ContractError("IO_ERROR", "The operation journal cannot be read safely.");
    }
    const operation = value.operation, effects = operation.effects as Record<string, unknown>;
    if (value.refresh !== undefined) {
      try { if (operation.method !== "skin.apply") throw new Error(); value.refresh = parseApplyRefresh(value.refresh); }
      catch { throw new ContractError("IO_ERROR", "The hot refresh journal binding is invalid."); }
    }
    const revision = (value: unknown) => value === null || typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
    if (!/^[a-f0-9]{64}$/.test(operation.expectedRevision as string) || !revision(operation.committedRevision) ||
        !["themeCommitted", "rendererApplied", "codexRestarted"].every(key => [true, false, null].includes(effects[key] as boolean | null)) ||
        !date(operation.startedAt) || !date(operation.updatedAt) || typeof operation.stage !== "string" || operation.stage.length > 128 ||
        (!["skin.apply", ...RUNTIME_METHODS].includes(String(operation.method)) && (![true, false, null].includes(effects.libraryChanged as boolean | null) || !revision(operation.resultRevision))) ||
        ((RUNTIME_METHODS as readonly string[]).includes(String(operation.method)) && (!["pausedCommitted", "rendererRemoved"].every(key => [true, false, null].includes(effects[key] as boolean | null)) || !revision(operation.requestedActiveRevision))) ||
        (operation.method === "skin.restore" && !["appearanceRestored", "runtimeDetached", "backupArchived"].every(key => [true, false, null].includes(effects[key] as boolean | null))) ||
        (operation.method === "runtime.upgrade" && ![true, false, null].includes(effects.runtimeUpgraded as boolean | null)) ||
        (operation.rendererUnavailable !== undefined && typeof operation.rendererUnavailable !== "boolean") ||
        (effects.rollbackVerified !== undefined && ![true, false, null].includes(effects.rollbackVerified as boolean | null)) ||
        (operation.recoveryTransaction !== undefined && (typeof operation.recoveryTransaction !== "string" || !/^\.community-apply-[a-f0-9-]{36}$/.test(operation.recoveryTransaction))) ||
        (["themes.create", "themes.importPackage"].includes(String(operation.method)) && !["created", "duplicate", null].includes(operation.disposition as string | null)) ||
        (operation.deleted !== undefined && ![true, false, null].includes(operation.deleted as boolean | null)) ||
        (operation.cleanupPending !== undefined && ![true, false, null].includes(operation.cleanupPending as boolean | null)) ||
        (operation.recoveryCompleted !== undefined && typeof operation.recoveryCompleted !== "boolean") ||
        (operation.error !== null && (!record(operation.error) || !(ERROR_CODES as readonly unknown[]).includes(operation.error.code) ||
          typeof operation.error.message !== "string" || typeof operation.error.retryable !== "boolean")) ||
        (operation.confirmation !== null && (!record(operation.confirmation) || typeof operation.confirmation.id !== "string" ||
          !date(operation.confirmation.expiresAt) || typeof operation.confirmation.reason !== "string" || typeof operation.confirmation.impact !== "string"))) {
      throw new ContractError("IO_ERROR", "The operation journal fields are invalid.");
    }
    try { parseThemeRef(operation.theme); if (operation.resultTheme !== undefined && operation.resultTheme !== null) parseThemeRef(operation.resultTheme); }
    catch { throw new ContractError("IO_ERROR", "The journal contains an invalid theme identity."); }
    // Old journals remain readable. Invalid optional display metadata is
    // discarded; the original reason/impact and authorization stay intact.
    if (record(operation.confirmation) && operation.confirmation.copy !== undefined) {
      const copy = confirmationCopy(operation.confirmation.copy);
      if (copy) operation.confirmation.copy = copy; else delete operation.confirmation.copy;
    }
    return value as unknown as OperationRecord;
  }
  async create(value: OperationRecord): Promise<void> {
    await privateDirectory(this.directory);
    await pruneHistory(this.directory, ["succeeded", "failed", "cancelled"]);
    await durableJson(this.file(value.operation.id), this.directory, value, true);
  }
  async write(value: OperationRecord): Promise<void> { await durableJson(this.file(value.operation.id), this.directory, value); }
  async records(): Promise<{ records: OperationRecord[]; invalid: number }> {
    let names: string[];
    try { await safePath(this.directory, this.directory); names = await readdir(this.directory); }
    catch (error) { if (record(error) && error.code === "ENOENT") return { records: [], invalid: 0 }; throw error; }
    const records: OperationRecord[] = []; let invalid = 0;
    for (const name of names.sort()) {
      try {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) { invalid++; continue; }
        const value = jsonObject(await fileBytes(path.join(this.directory, name), this.directory, 65536));
        if (!record(value.operation) || !validOperationId(value.operation.id) || path.basename(this.file(value.operation.id)) !== name) { invalid++; continue; }
        const current = await this.read(value.operation.id);
        if (current) records.push(current);
      } catch { invalid++; }
    }
    return { records, invalid };
  }
}
