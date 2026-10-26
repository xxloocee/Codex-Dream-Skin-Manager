import { createHash, randomUUID } from "node:crypto";
import { ContractError, failure, RUNTIME_METHODS } from "../contracts/manager.mjs";
import type { ConfirmedLibraryCommand, ManagerSnapshot, MethodMap, OperationSnapshot, RuntimeCommand, ThemeCreateCommand, ThemeEditCommand, ThemePackageCommand, ThemeRef } from "../contracts/manager.mjs";
import type { SourceSnapshot, SnapshotFile } from "./source-snapshots.mjs";
import type { ApplyPort, ApplyPreflight } from "./ports/apply.mjs";
import { OperationStore } from "./operation-store.mjs";
import type { OperationRecord } from "./operation-store.mjs";
import type { LibraryOutcome, LibraryPort } from "./ports/library.mjs";
import { canonicalJson } from "./theme-edit.mjs";
import type { RuntimeOutcome, RuntimePort, RuntimePreflight } from "./ports/runtime.mjs";

const unfinished = (value: OperationSnapshot) => ["queued", "running", "awaitingConfirmation"].includes(value.state);
const runtimeMethod = (value: OperationSnapshot) => (RUNTIME_METHODS as readonly string[]).includes(value.method);
export class Operations {
  private readonly live = new Map<string, OperationRecord>();
  private readonly jobs = new Set<Promise<void>>();
  private readonly confirmedLibrary = new Map<string, { command: ConfirmedLibraryCommand; fingerprint: string }>();
  private readonly runtimeCommands = new Map<string, RuntimeCommand>();
  private readonly applyPorts = new Map<string, ApplyPort>();
  private activeId: string | null = null;
  onChanged: ((operation: OperationSnapshot) => void) | undefined;
  constructor(private readonly session: string, private readonly store: OperationStore, private readonly port: ApplyPort,
    private readonly snapshot: () => Promise<ManagerSnapshot>, private readonly validate: (theme: ThemeRef, revision: string) => Promise<void>,
    private readonly library?: LibraryPort, private readonly validateLibrary?: (command: ThemeEditCommand) => Promise<void>, private readonly runtimePort?: RuntimePort) {}
  get activeIds(): string[] { return this.activeId ? [this.activeId] : []; }
  private async record(id: string): Promise<OperationRecord> {
    const current = this.live.get(id) ?? await this.store.read(id);
    if (!current) throw new ContractError("OPERATION_UNKNOWN", "This operation is unknown; refresh before explicitly starting another.");
    if (!this.live.has(id) && unfinished(current.operation)) {
      // A different manager process may still own queued/confirmation work.
      // Only a persisted close cancellation proves it did not execute.
      return { ...current, preflight: null, operation: { ...current.operation, state: "indeterminate", stage: "reconciliationRequired", confirmation: null,
        error: { code: "OPERATION_UNKNOWN", message: "A previous connection owns this unfinished operation. Inspect current state; it will not be replayed.", retryable: false },
        effects: current.operation.method === "skin.apply"
          ? { themeCommitted: null, rendererApplied: null, codexRestarted: null }
          : runtimeMethod(current.operation) ? { themeCommitted: null, rendererApplied: null, codexRestarted: null, pausedCommitted: null, rendererRemoved: null, ...(current.operation.method === "runtime.upgrade" ? { runtimeUpgraded: null } : {}), ...(current.operation.method === "skin.restore" ? { appearanceRestored: null, runtimeDetached: null, backupArchived: null } : {}) }
          : { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: null } } };
    }
    return current;
  }
  async get(id: string): Promise<OperationSnapshot> {
    let record = await this.record(id);
    if (record.operation.state === "indeterminate" && record.operation.method === "skin.apply" && this.port.receipt) {
      const outcome = await this.port.receipt(id, record.operation.theme, record.operation.expectedRevision).catch(() => null);
      if (outcome?.effects.themeCommitted === true && outcome.effects.rendererApplied === true && outcome.committedRevision === record.operation.expectedRevision && outcome.verifiedRendererRevision && outcome.runtimeSessionId &&
          (!record.refresh || outcome.effects.codexRestarted === false && outcome.runtimeSessionId === record.refresh.runtimeSessionId)) {
        record = { ...record, operation: { ...record.operation, ...outcome, state: "succeeded", stage: "reconciledReceipt", confirmation: null, error: null } };
      } else if (outcome?.effects.rollbackVerified === true) {
        record = { ...record, operation: { ...record.operation, ...outcome, state: "failed", stage: "rolledBack", confirmation: null,
          error: { code: "RENDERER_UNVERIFIED", message: "社区应用失败，原主题完整快照已恢复并核验。", retryable: false } } };
      } else if (outcome?.recoveryTransaction) {
        record = { ...record, operation: { ...record.operation, ...outcome } };
      }
    }
    if (record.operation.state === "indeterminate" && runtimeMethod(record.operation) && this.runtimePort) {
      const outcome = await this.runtimePort.receipt(id, record.operation.method as RuntimeCommand["method"], record.operation.expectedRevision).catch(() => null);
      const recovered = outcome ? this.completedRuntime(record.operation, outcome) : null;
      if (recovered) record = { ...record, operation: { ...record.operation, ...recovered } };
    }
    if (record.operation.state === "indeterminate" && record.operation.method !== "skin.apply" && !runtimeMethod(record.operation) && this.library) {
      // A query can settle a durable completed receipt; it never repeats a writer.
      const outcome = await this.library.receipt(id, record.operation.method, record.operation.expectedRevision).catch(() => null);
      if (outcome && !outcome.error) {
        const recovered = this.completedLibrary(record.operation, outcome);
        if (recovered) record = { ...record, operation: { ...record.operation, ...recovered } };
      }
    }
    if (this.live.has(id) && record.operation.state === "awaitingConfirmation" && record.operation.confirmation && Date.parse(record.operation.confirmation.expiresAt) <= Date.now()) {
      await this.update(record, { state: "cancelled", stage: "confirmationExpired", confirmation: null,
        error: { code: "CONFIRMATION_EXPIRED", message: "The confirmation expired without executing the operation.", retryable: false } });
      if (this.activeId === id) this.activeId = null;
      this.confirmedLibrary.delete(id);
      this.runtimeCommands.delete(id);
    }
    return structuredClone(record.operation);
  }
  async controlRuntime(command: RuntimeCommand): Promise<OperationSnapshot> {
    if (!this.runtimePort) throw new ContractError("METHOD_UNSUPPORTED", "Runtime controls are unavailable.");
    const id = command.params.operationId, digest = createHash("sha256").update(canonicalJson(command)).digest("hex");
    const known = this.live.get(id) ?? await this.store.read(id);
    if (known) { if (known.requestDigest !== digest) throw new ContractError("OPERATION_CONFLICT", "This operation identity was already used."); return this.get(id); }
    if (!id.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", "A new runtime operation requires the current connection.");
    if (this.activeId) { await this.get(this.activeId); if (this.activeId) throw new ContractError("BUSY", "Another operation is running or awaiting confirmation.", true); }
    const preflight = await this.runtimePort.preflight(command), now = new Date().toISOString();
    const value: OperationRecord = { schemaVersion: 1, requestDigest: digest, preflight, operation: {
      id, method: command.method, state: preflight.requiresConfirmation ? "awaitingConfirmation" : "queued", stage: preflight.requiresConfirmation ? "runtimeConfirmationRequired" : "queued",
      theme: preflight.targetTheme ?? { source: "saved", id: "runtime-session" }, expectedRevision: command.params.expectedRuntimeRevision,
      requestedActiveRevision: preflight.targetRevision, committedRevision: null, verifiedRendererRevision: null, runtimeSessionId: null,
      startedAt: now, updatedAt: now, confirmation: preflight.requiresConfirmation ? { id: randomUUID(), reason: preflight.reason, impact: preflight.impact, ...(preflight.copy ? { copy: preflight.copy } : {}), expiresAt: new Date(Date.now() + 300000).toISOString() } : null,
      effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, pausedCommitted: false, rendererRemoved: false, ...(command.method === "runtime.upgrade" ? { runtimeUpgraded: false } : {}), ...(command.method === "skin.restore" ? { appearanceRestored: false, runtimeDetached: false, backupArchived: false } : {}) }, error: null, snapshot: null } };
    await this.store.create(value); this.live.set(id, value); this.activeId = id; this.runtimeCommands.set(id, command);
    if (!preflight.requiresConfirmation) this.startRuntime(value, false);
    return structuredClone(value.operation);
  }
  private completedRuntime(operation: OperationSnapshot, outcome: RuntimeOutcome): Partial<OperationSnapshot> | null {
    if (operation.method === "skin.restore") return outcome.effects.appearanceRestored === true && outcome.effects.runtimeDetached === true && outcome.effects.backupArchived === true && outcome.effects.codexRestarted !== null ?
      { ...outcome, state: "succeeded", stage: "appearanceRestored", confirmation: null, error: null } : null;
    const succeeded = (operation.method !== "runtime.upgrade" || outcome.effects.runtimeUpgraded === true) && outcome.effects.pausedCommitted === true && (operation.method === "skin.pause" ?
      outcome.effects.rendererRemoved === true && !!outcome.runtimeSessionId || outcome.rendererUnavailable :
      outcome.effects.themeCommitted === true && outcome.effects.rendererApplied === true && outcome.committedRevision === operation.requestedActiveRevision && !!outcome.verifiedRendererRevision && !!outcome.runtimeSessionId);
    return succeeded ? { ...outcome, state: "succeeded", stage: operation.method === "skin.pause" ? outcome.rendererUnavailable ? "pausedWithoutRenderer" : "rendererRemoved" : operation.method === "skin.reset" ? "defaultApplied" : operation.method === "runtime.repair" ? "connectionRepaired" : operation.method === "runtime.upgrade" ? "runtimeUpgraded" : "runtimeResumed", confirmation: null, error: null } : null;
  }
  private startRuntime(value: OperationRecord, confirmed: boolean): void {
    const job = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.runRuntime(value, confirmed));
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
  }
  private async runRuntime(value: OperationRecord, confirmed: boolean): Promise<void> {
    let executing = false, outcome: RuntimeOutcome | null = null;
    try {
      const command = this.runtimeCommands.get(value.operation.id);
      if (!command || !this.runtimePort) throw new ContractError("OPERATION_UNKNOWN", "This runtime command no longer belongs to the current connection.");
      // The platform checks the actual state under its write lock. Reuse the
      // accepted preflight instead of observing the whole runtime a second time.
      const preflight = value.preflight as RuntimePreflight | null;
      if (!preflight) throw new ContractError("OPERATION_UNKNOWN", "Missing runtime preflight.");
      if (preflight.requiresConfirmation && !confirmed) { await this.awaiting(value, preflight); return; }
      await this.update(value, { state: "running", stage: command.method === "runtime.upgrade" ? "upgradingRuntime" : command.method === "skin.pause" ? "pausingRuntime" : command.method === "skin.restore" ? "restoringAppearance" : command.method === "skin.reset" ? "resettingDefault" : command.method === "runtime.repair" ? "repairingConnection" : "resumingRuntime", confirmation: null }, preflight);
      executing = true; outcome = await this.runtimePort.execute(command, preflight, confirmed);
      const completed = this.completedRuntime(value.operation, outcome), untouched = Object.values(outcome.effects).every(effect => effect === false);
      await this.update(value, { ...(completed ?? { ...outcome, state: untouched ? "failed" as const : "indeterminate" as const, stage: untouched ? "runtimeRefused" : "reconciliationRequired", confirmation: null,
        error: { code: "RENDERER_UNVERIFIED" as const, message: "The desired state and actual renderer outcome could not both be confirmed. Inspect state; this command will not be replayed.", retryable: false } }) });
    } catch (error) {
      const failed = failure(null, error), changes: Partial<OperationSnapshot> = { state: executing ? "indeterminate" : "failed", stage: executing ? "reconciliationRequired" : "runtimePreflightFailed", confirmation: null,
        ...(outcome ?? {}), error: failed.ok ? null : failed.error,
        effects: outcome?.effects ?? { themeCommitted: executing ? null : false, rendererApplied: executing ? null : false, codexRestarted: executing ? null : false, pausedCommitted: executing ? null : false, rendererRemoved: executing ? null : false,
          ...(value.operation.method === "runtime.upgrade" ? { runtimeUpgraded: executing ? null : false } : {}), ...(value.operation.method === "skin.restore" ? { appearanceRestored: executing ? null : false, runtimeDetached: executing ? null : false, backupArchived: executing ? null : false } : {}) } };
      try { await this.update(value, changes); } catch { value.operation = { ...value.operation, ...changes, state: "indeterminate", stage: "journalUnavailable" }; }
    } finally { if (value.operation.state !== "awaitingConfirmation") { if (this.activeId === value.operation.id) this.activeId = null; this.runtimeCommands.delete(value.operation.id); } }
  }
  async apply(params: MethodMap["skin.apply"]["params"], override?: { context: string; port: ApplyPort }): Promise<OperationSnapshot> {
    const requestDigest = createHash("sha256").update(JSON.stringify([params.theme.source, params.theme.id, params.expectedRevision, ...(override ? [override.context] : []), ...(params.refresh ? [canonicalJson(params.refresh)] : [])])).digest("hex");
    const known = this.live.get(params.operationId) ?? await this.store.read(params.operationId);
    if (known) {
      if (known.requestDigest !== requestDigest) throw new ContractError("OPERATION_CONFLICT", "This operation identity was already used for another request.");
      return this.get(params.operationId);
    }
    if (!params.operationId.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", "A new operation must belong to the current backend session.");
    if (this.activeId) {
      await this.get(this.activeId); // Expire an unused confirmation before deciding contention.
      if (this.activeId) throw new ContractError("BUSY", "Another operation is running or awaiting confirmation.", true);
    }
    await this.validate(params.theme, params.expectedRevision);
    const now = new Date().toISOString();
    const value: OperationRecord = { schemaVersion: 1, requestDigest, preflight: null, ...(params.refresh ? { refresh: structuredClone(params.refresh) } : {}),
      operation: { id: params.operationId, method: "skin.apply", state: "queued", stage: "queued", theme: params.theme,
        expectedRevision: params.expectedRevision, committedRevision: null, verifiedRendererRevision: null, runtimeSessionId: null,
        startedAt: now, updatedAt: now, confirmation: null, effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false }, error: null, snapshot: null } };
    await this.store.create(value);
    this.live.set(params.operationId, value); this.activeId = params.operationId;
    if (override) this.applyPorts.set(params.operationId, override.port);
    this.start(value, false);
    return structuredClone(value.operation);
  }
  async edit(command: ThemeEditCommand): Promise<OperationSnapshot> {
    if (!this.library || !this.validateLibrary) throw new ContractError("METHOD_UNSUPPORTED", "Library editing is unavailable.");
    const requestDigest = createHash("sha256").update(canonicalJson(command)).digest("hex"), params = command.params;
    const known = this.live.get(params.operationId) ?? await this.store.read(params.operationId);
    if (known) {
      if (known.requestDigest !== requestDigest) throw new ContractError("OPERATION_CONFLICT", "This operation identity was used for a different request.");
      return this.get(params.operationId);
    }
    if (!params.operationId.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", "A new operation must belong to the current backend session.");
    if (this.activeId) {
      await this.get(this.activeId);
      if (this.activeId) throw new ContractError("BUSY", "Another operation is running or awaiting confirmation.", true);
    }
    await this.validateLibrary(command);
    const now = new Date().toISOString();
    const value: OperationRecord = { schemaVersion: 1, requestDigest, preflight: null,
      operation: { id: params.operationId, method: command.method, state: "queued", stage: "queued", theme: params.theme,
        expectedRevision: params.expectedRevision, committedRevision: null, verifiedRendererRevision: null, runtimeSessionId: null,
        resultTheme: null, resultRevision: null, startedAt: now, updatedAt: now, confirmation: null,
        effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: false }, error: null, snapshot: null } };
    await this.store.create(value); this.live.set(params.operationId, value); this.activeId = params.operationId;
    const job = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.runEdit(value, () => this.library!.edit(command)));
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
    return structuredClone(value.operation);
  }
  async create(params: MethodMap["themes.create"]["params"], prepare: () => Promise<{ source: SourceSnapshot; revision: string }>, retain?: () => void, discard?: () => Promise<void>): Promise<OperationSnapshot> {
    return this.importEntry({ method: "themes.create", params }, prepare, source => this.library!.create({ method: "themes.create", params }, source), retain, discard);
  }
  async importPackage(params: MethodMap["themes.importPackage"]["params"], prepare: () => Promise<{ source: SnapshotFile; revision: string }>, retain?: () => void, discard?: () => Promise<void>): Promise<OperationSnapshot> {
    return this.importEntry({ method: "themes.importPackage", params }, prepare, source => this.library!.importPackage({ method: "themes.importPackage", params }, source), retain, discard);
  }
  async proposeLibrary(command: ConfirmedLibraryCommand): Promise<OperationSnapshot> {
    if (!this.library) throw new ContractError("METHOD_UNSUPPORTED", "Library recovery is unavailable.");
    const id = command.params.operationId, digest = createHash("sha256").update(canonicalJson(command)).digest("hex");
    const known = this.live.get(id) ?? await this.store.read(id);
    if (known) { if (known.requestDigest !== digest) throw new ContractError("OPERATION_CONFLICT", "This identity was already used for another operation."); return this.get(id); }
    if (!id.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", "A new operation requires the current backend session.");
    if (this.activeId) { await this.get(this.activeId); if (this.activeId) throw new ContractError("BUSY", "Another operation is running or awaiting confirmation.", true); }
    const challenge = await this.library.propose(command), now = new Date().toISOString();
    const value: OperationRecord = { schemaVersion: 1, requestDigest: digest, preflight: null, operation: {
      id, method: command.method, state: "awaitingConfirmation", stage: "libraryConfirmationRequired", theme: challenge.theme, expectedRevision: challenge.revision,
      committedRevision: null, verifiedRendererRevision: null, runtimeSessionId: null, resultTheme: null, resultRevision: null,
      startedAt: now, updatedAt: now, confirmation: { id: randomUUID(), reason: challenge.reason, impact: challenge.impact, ...(challenge.copy ? { copy: challenge.copy } : {}), expiresAt: new Date(Date.now() + 300000).toISOString() },
      effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: false }, error: null, snapshot: null } };
    await this.store.create(value); this.live.set(id, value); this.activeId = id;
    this.confirmedLibrary.set(id, { command, fingerprint: challenge.fingerprint }); return structuredClone(value.operation);
  }
  private completedLibrary(operation: OperationSnapshot, outcome: LibraryOutcome): Partial<OperationSnapshot> | null {
    const duplicate = ["themes.create", "themes.importPackage"].includes(operation.method) && outcome.disposition === "duplicate" && outcome.libraryChanged === false;
    const succeeded = !outcome.error && (operation.method === "themes.delete" ? outcome.deleted === true : operation.method === "library.recover" ? outcome.recoveryCompleted === true :
      (outcome.libraryChanged === true || duplicate) && !!outcome.resultTheme && !!outcome.resultRevision);
    if (!succeeded) return null;
    return { state: "succeeded", stage: outcome.cleanupPending ? "cleanupPending" : duplicate ? "duplicateFound" : operation.method === "themes.delete" ? "themeDeleted" : operation.method === "library.recover" ? "recoveryCompleted" : "librarySaved",
      resultTheme: outcome.resultTheme, resultRevision: outcome.resultRevision,
      ...(outcome.disposition !== undefined ? { disposition: outcome.disposition } : {}),
      ...(outcome.deleted !== undefined ? { deleted: outcome.deleted } : {}), ...(outcome.cleanupPending !== undefined ? { cleanupPending: outcome.cleanupPending } : {}),
      ...(outcome.recoveryCompleted !== undefined ? { recoveryCompleted: outcome.recoveryCompleted } : {}),
      confirmation: null, effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: outcome.libraryChanged }, error: null };
  }
  private async importEntry<T>(command: ThemeCreateCommand | ThemePackageCommand, prepare: () => Promise<{ source: T; revision: string }>, execute: (source: T) => Promise<LibraryOutcome>, retain?: () => void, discard?: () => Promise<void>): Promise<OperationSnapshot> {
    if (!this.library) throw new ContractError("METHOD_UNSUPPORTED", "Source importing is unavailable.");
    const params = command.params;
    const requestDigest = createHash("sha256").update(canonicalJson(command)).digest("hex");
    const known = this.live.get(params.operationId) ?? await this.store.read(params.operationId);
    if (known) {
      if (known.requestDigest !== requestDigest) throw new ContractError("OPERATION_CONFLICT", "This operation identity was used for a different request.");
      return this.get(params.operationId);
    }
    if (!params.operationId.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", "A new operation requires the current backend session.");
    if (this.activeId) { await this.get(this.activeId); if (this.activeId) throw new ContractError("BUSY", "Another operation is running or awaiting confirmation.", true); }
    retain?.();
    try {
    const prepared = await prepare(), now = new Date().toISOString();
    const value: OperationRecord = { schemaVersion: 1, requestDigest, preflight: null,
      operation: { id: params.operationId, method: command.method, state: "queued", stage: "queued",
        theme: { source: "saved", id: "custom-" + params.operationId.split(":")[1] }, expectedRevision: prepared.revision,
        committedRevision: null, verifiedRendererRevision: null, runtimeSessionId: null, resultTheme: null, resultRevision: null, disposition: null,
        startedAt: now, updatedAt: now, confirmation: null, effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: false }, error: null, snapshot: null } };
    await this.store.create(value); this.live.set(params.operationId, value); this.activeId = params.operationId;
    const job = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.runEdit(value, () => execute(prepared.source)));
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
    return structuredClone(value.operation);
    } catch (error) { await discard?.(); throw error; }
  }
  private async runEdit(value: OperationRecord, execute: () => Promise<LibraryOutcome>): Promise<void> {
    let executing = false;
    let outcome: LibraryOutcome | null = null;
    try {
      await this.update(value, { state: "running", stage: value.operation.method === "themes.delete" ? "deletingTheme" : value.operation.method === "library.recover" ? "recoveringLibrary" : value.operation.method === "themes.importPackage" ? "importingPackage" : value.operation.method === "themes.create" ? "importingMedia" : value.operation.method === "themes.copy" ? "copyingTheme" : "savingTheme" });
      executing = true;
      outcome = await execute();
      const completed = this.completedLibrary(value.operation, outcome);
      await this.update(value, completed ?? { state: outcome.libraryChanged === false ? "failed" : "indeterminate",
        stage: outcome.libraryChanged === false ? "saveRefused" : "reconciliationRequired",
        resultTheme: outcome.resultTheme, resultRevision: outcome.resultRevision,
        ...(outcome.disposition !== undefined ? { disposition: outcome.disposition } : {}),
        ...(outcome.deleted !== undefined ? { deleted: outcome.deleted } : {}),
        ...(outcome.cleanupPending !== undefined ? { cleanupPending: outcome.cleanupPending } : {}),
        ...(outcome.recoveryCompleted !== undefined ? { recoveryCompleted: outcome.recoveryCompleted } : {}),
        effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: outcome.libraryChanged },
        error: outcome.error ?? { code: "IO_ERROR", message: "The library outcome could not be confirmed; inspect before saving again.", retryable: false } });
    } catch (error) {
      const failed = failure(null, error);
      const changes: Partial<OperationSnapshot> = { state: executing ? "indeterminate" : "failed", stage: executing ? "reconciliationRequired" : "journalUnavailable",
        effects: { themeCommitted: false, rendererApplied: false, codexRestarted: false, libraryChanged: outcome ? outcome.libraryChanged : executing ? null : false },
        ...(outcome ? { resultTheme: outcome.resultTheme, resultRevision: outcome.resultRevision,
          ...(outcome.disposition !== undefined ? { disposition: outcome.disposition } : {}),
          ...(outcome.deleted !== undefined ? { deleted: outcome.deleted } : {}),
          ...(outcome.cleanupPending !== undefined ? { cleanupPending: outcome.cleanupPending } : {}),
          ...(outcome.recoveryCompleted !== undefined ? { recoveryCompleted: outcome.recoveryCompleted } : {}) } : {}),
        error: failed.ok ? null : failed.error };
      try { await this.update(value, changes); }
      catch { value.operation = { ...value.operation, ...changes, state: "indeterminate", stage: "journalUnavailable" }; }
    } finally { if (this.activeId === value.operation.id) this.activeId = null; if (["succeeded", "failed", "cancelled"].includes(value.operation.state)) this.live.delete(value.operation.id); }
  }
  async confirm(params: MethodMap["operations.confirm"]["params"]): Promise<OperationSnapshot> {
    const value = await this.record(params.operationId), current = value.operation;
    if (!this.live.has(params.operationId) || current.state !== "awaitingConfirmation" || current.confirmation?.id !== params.confirmationId ||
        Date.parse(current.confirmation.expiresAt) <= Date.now()) throw new ContractError("CONFIRMATION_EXPIRED", "This confirmation is no longer valid.");
    if (!params.accepted) {
      await this.update(value, { state: "cancelled", stage: "cancelledBeforeExecution", confirmation: null }); if (this.activeId === params.operationId) this.activeId = null;
      this.confirmedLibrary.delete(params.operationId);
      this.runtimeCommands.delete(params.operationId);
    } else if (runtimeMethod(current)) {
      if (!this.runtimeCommands.has(params.operationId) || !this.runtimePort) throw new ContractError("CONFIRMATION_EXPIRED", "This runtime confirmation belongs to another connection.");
      await this.update(value, { state: "queued", stage: "runtimeConfirmed", confirmation: null }); this.startRuntime(value, true);
    } else if (current.method === "themes.delete" || current.method === "library.recover") {
      const accepted = this.confirmedLibrary.get(params.operationId);
      if (!accepted || !this.library) throw new ContractError("CONFIRMATION_EXPIRED", "This confirmation no longer belongs to the current connection.");
      await this.update(value, { state: "queued", stage: "libraryConfirmed", confirmation: null }); this.confirmedLibrary.delete(params.operationId);
      const job = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.runEdit(value, () => this.library!.executeConfirmed(accepted.command, accepted.fingerprint)));
      this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
    } else {
      await this.update(value, { state: "queued", stage: "recheckingConfirmation", confirmation: null }); this.start(value, true);
    }
    return structuredClone(value.operation);
  }
  private async update(value: OperationRecord, changes: Partial<OperationSnapshot>, preflight = value.preflight): Promise<void> {
    const next: OperationRecord = { ...value, preflight, operation: { ...value.operation, ...changes, updatedAt: new Date().toISOString() } };
    await this.store.write(next); value.operation = next.operation; value.preflight = next.preflight;
    if (!unfinished(value.operation) && this.activeId === value.operation.id) this.activeId = null;
    try { this.onChanged?.(structuredClone(value.operation)); } catch { /* notification cannot undo a journal commit */ }
  }
  private start(value: OperationRecord, confirmed: boolean): void {
    // Start after the accepting request has had a chance to return; no side effect precedes persistence.
    const job = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.run(value, confirmed));
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
  }
  private async awaiting(value: OperationRecord, preflight: ApplyPreflight): Promise<void> {
    await this.update(value, { state: "awaitingConfirmation", stage: "confirmationRequired", confirmation: {
      id: randomUUID(), reason: preflight.reason, impact: preflight.impact, ...(preflight.copy ? { copy: preflight.copy } : {}), expiresAt: new Date(Date.now() + 300000).toISOString() } }, preflight);
  }
  private async run(value: OperationRecord, confirmed: boolean): Promise<void> {
    let executing = false;
    try {
      const current = value.operation;
      const port = this.applyPorts.get(current.id) ?? this.port;
      const refresh = value.refresh;
      const preflight = await port.preflight(current.theme, current.expectedRevision, refresh);
      if (refresh && preflight.requiresConfirmation) throw new ContractError("RUNTIME_UNAVAILABLE", "Hot refresh cannot start or restart Codex.");
      if (preflight.requiresConfirmation && (!confirmed || !value.preflight || value.preflight.fingerprint !== preflight.fingerprint)) {
        await this.awaiting(value, preflight); return;
      }
      if (confirmed && value.preflight?.fingerprint !== preflight.fingerprint) { await this.awaiting(value, preflight); return; }
      await this.update(value, { state: "running", stage: "applying" }, preflight);
      executing = true;
      const outcome = await port.apply(current.theme, current.expectedRevision, preflight, confirmed, current.id, refresh);
      const succeeded = outcome.effects.themeCommitted === true && outcome.effects.rendererApplied === true &&
        outcome.committedRevision === current.expectedRevision && !!outcome.verifiedRendererRevision && !!outcome.runtimeSessionId &&
        (!refresh || outcome.effects.codexRestarted === false && outcome.runtimeSessionId === refresh.runtimeSessionId);
      const untouched = Object.values(outcome.effects).every(value => value === false);
      const rolledBack = outcome.effects.rollbackVerified === true;
      await this.update(value, { ...outcome, state: succeeded ? "succeeded" : rolledBack || untouched ? "failed" : "indeterminate", stage: succeeded ? "verified" : rolledBack ? "rolledBack" : untouched ? "preconditionChanged" : "reconciliationRequired",
        confirmation: null, error: succeeded ? null : { code: "RENDERER_UNVERIFIED", message: rolledBack ? "社区应用失败，原主题的完整快照已恢复并核验。" : "The exact renderer outcome could not be confirmed; inspect status before applying again.", retryable: false } });
    } catch (error) {
      const failed = failure(null, error);
      try { await this.update(value, { state: executing ? "indeterminate" : "failed", stage: executing ? "reconciliationRequired" : "preflightFailed", confirmation: null,
        error: failed.ok ? null : failed.error,
        ...(executing ? { effects: { themeCommitted: null, rendererApplied: null, codexRestarted: null } } : {}) }); }
      catch { value.operation = { ...value.operation, state: "indeterminate", stage: "journalUnavailable", confirmation: null,
        effects: executing ? { themeCommitted: null, rendererApplied: null, codexRestarted: null } : value.operation.effects,
        error: { code: "IO_ERROR", message: "The operation journal could not be updated. Inspect current state; no automatic replay will occur.", retryable: false } }; }
    } finally { if (value.operation.state !== "awaitingConfirmation") { if (this.activeId === value.operation.id) this.activeId = null; this.applyPorts.delete(value.operation.id); } }
  }
  async list(params: MethodMap["operations.list"]["params"]): Promise<MethodMap["operations.list"]["result"]> {
    const inventory = await this.store.records();
    const retained = new Set(inventory.records.map(value => value.operation.id));
    for (const [id, value] of this.live) if (!retained.has(id) && ["succeeded", "failed", "cancelled"].includes(value.operation.state)) this.live.delete(id);
    const revision = createHash("sha256").update(canonicalJson(inventory)).digest("hex");
    const records = inventory.records.sort((a, b) => b.operation.startedAt.localeCompare(a.operation.startedAt) || a.operation.id.localeCompare(b.operation.id));
    let offset = 0;
    if (params.cursor) {
      let cursor: unknown; try { cursor = JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8")); } catch {}
      if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== this.session || cursor[1] !== revision || !Number.isSafeInteger(cursor[2]) || cursor[2] < 0 || cursor[2] >= records.length) throw new ContractError("CATALOG_CHANGED", "The operation journal changed; refresh its list.");
      offset = cursor[2] as number;
    }
    const limit = params.limit ?? 50, operations: OperationSnapshot[] = [];
    for (const value of records.slice(offset, offset + limit)) {
      const current = await this.get(value.operation.id); operations.push({ ...current, snapshot: null });
    }
    return { revision, operations, warnings: inventory.invalid ? [{ code: "JOURNAL_UNREADABLE", message: `${inventory.invalid} journal entries could not be read safely.` }] : [],
      ...(offset + limit < records.length ? { nextCursor: Buffer.from(JSON.stringify([this.session, revision, offset + limit])).toString("base64url") } : {}) };
  }
  async close(): Promise<void> {
    const cancel = async () => {
      for (const value of this.live.values()) if (value.operation.state === "awaitingConfirmation") {
        try { await this.update(value, { state: "cancelled", stage: "sessionClosedBeforeConfirmation", confirmation: null }); }
        catch { value.operation = { ...value.operation, state: "cancelled", stage: "closeJournalUnavailable", confirmation: null }; }
        if (this.activeId === value.operation.id) this.activeId = null;
      }
    };
    await cancel();
    await this.drain();
    await cancel();
    this.confirmedLibrary.clear();
    this.runtimeCommands.clear();
    this.applyPorts.clear();
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.jobs]); }
}
