import path from "node:path";
import { randomBytes } from "node:crypto";
import { pruneHistory } from "./history-retention.mjs";
import { ContractError, failure, record, validOperationId } from "../contracts/manager.mjs";
import type { MethodMap, UpdateCheck, UpdateOperation } from "../contracts/manager.mjs";
import type { UpdateCandidate, UpdatePort } from "./ports/updates.mjs";
import { UpdateNotStartedError } from "./ports/updates.mjs";
import { jsonObject, optionalBytes, sha256 } from "./local-files.mjs";
import { durableJson, privateDirectory } from "./write-files.mjs";

export function stableVersion(value: string): string {
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  if (normalized.length > 64 || /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(normalized)?.[0] !== normalized) throw new ContractError("THEME_INVALID", "更新版本必须为规范的稳定三段版本。");
  return normalized;
}
export function newerVersion(latest: string, current: string): boolean {
  const a = stableVersion(latest).split(".").map(BigInt), b = stableVersion(current).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}
interface Proposal { result: UpdateCheck; candidate: UpdateCandidate }
interface Entry { schemaVersion: 1; digest: string; operation: UpdateOperation }
const writerStates = ["queued", "running"];
export class Updates {
  private readonly directory: string;
  private readonly proposals = new Map<string, Proposal>();
  private readonly live = new Map<string, Entry>();
  private readonly jobs = new Set<Promise<void>>();
  private active: string | null = null;
  private checking = false;
  private closed = false;
  constructor(private readonly session: string, state: string, private readonly port: UpdatePort, private readonly businessBusy: () => boolean) {
    this.directory = path.join(state, "manager-operations", "update-ledger");
  }
  get busy(): boolean { return this.active !== null; }
  get activeIds(): string[] { return this.active ? [this.active] : []; }
  private file(id: string): string {
    if (!validOperationId(id)) throw new ContractError("INVALID_REQUEST", "Invalid update operation.");
    return path.join(this.directory, sha256([Buffer.from(id)]) + ".json");
  }
  private async read(id: string): Promise<Entry | null> {
    const bytes = await optionalBytes(this.file(id), this.directory, 16384); if (!bytes) return null;
    const value = jsonObject(bytes), op = value.operation;
    if (value.schemaVersion !== 1 || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || !record(op) || op.id !== id ||
        !["queued", "running", "handoff", "installed", "failed", "indeterminate"].includes(String(op.state)) || !["windows-release", "macos-release", "macos-gui"].includes(String(op.channel)) ||
        typeof op.latestVersion !== "string" || typeof op.stage !== "string" || typeof op.managerMustQuit !== "boolean" || !Number.isFinite(Date.parse(String(op.startedAt))) || !Number.isFinite(Date.parse(String(op.updatedAt)))) throw new ContractError("IO_ERROR", "更新记录无法安全读取。");
    stableVersion(op.latestVersion); return value as unknown as Entry;
  }
  async check(): Promise<UpdateCheck> {
    if (this.closed || this.busy || this.businessBusy() || this.checking) throw new ContractError("BUSY", "请等待当前任务结束后检查更新。");
    this.checking = true;
    try {
      const candidate = await this.port.check();
      stableVersion(candidate.currentVersion); stableVersion(candidate.latestVersion);
      if (this.closed) throw new ContractError("BACKEND_UNAVAILABLE", "更新会话已关闭。");
      for (const [id, value] of this.proposals) if (Date.parse(value.result.expiresAt) <= Date.now()) this.proposals.delete(id);
      if (this.proposals.size >= 8) this.proposals.delete(this.proposals.keys().next().value!);
      const { binding: _binding, ...publicCandidate } = candidate;
      const result: UpdateCheck = { ...publicCandidate, handle: randomBytes(24).toString("hex"), expiresAt: new Date(Date.now() + 300000).toISOString(),
        updateAvailable: newerVersion(candidate.latestVersion, candidate.currentVersion) };
      this.proposals.set(result.handle, { result, candidate }); return structuredClone(result);
    } finally { this.checking = false; }
  }
  async install(params: MethodMap["updates.install"]["params"]): Promise<UpdateOperation> {
    const digest = sha256([Buffer.from(JSON.stringify([params.handle, params.accepted]))]);
    const known = this.live.get(params.operationId) ?? await this.read(params.operationId);
    if (known) {
      if (known.digest !== digest) throw new ContractError("OPERATION_CONFLICT", "此更新标识已用于其他请求。");
      return this.get(params.operationId);
    }
    if (this.closed || !params.operationId.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", "新更新操作需要当前连接。");
    if (this.busy || this.businessBusy()) throw new ContractError("BUSY", "有其他操作进行中，未开始更新。");
    const proposal = this.proposals.get(params.handle);
    if (!proposal || Date.parse(proposal.result.expiresAt) <= Date.now()) throw new ContractError("RESOURCE_EXPIRED", "更新批准已过期，请重新检查。");
    if (!proposal.result.updateAvailable || proposal.candidate.installMode === "manual") throw new ContractError("METHOD_UNSUPPORTED", "此通道请前往发布页手动下载安装。");
    await privateDirectory(this.directory);
    await pruneHistory(this.directory, ["installed", "failed"]);
    const now = new Date().toISOString();
    const value: Entry = { schemaVersion: 1, digest, operation: { id: params.operationId, channel: proposal.result.channel, latestVersion: proposal.result.latestVersion,
      state: "queued", stage: "approved", startedAt: now, updatedAt: now, managerMustQuit: false, error: null } };
    await durableJson(this.file(params.operationId), this.directory, value, true);
    this.live.set(params.operationId, value); this.active = params.operationId; this.proposals.delete(params.handle);
    const job = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      let executing = false;
      try {
        const current = await this.port.check();
        if (JSON.stringify(current) !== JSON.stringify(proposal.candidate)) throw new ContractError("RUNTIME_CHANGED", "版本、更新源、包摘要或安装身份已改变，请重新检查和批准。");
        await this.update(value, { state: "running", stage: "downloadingAndVerifying" }); executing = true;
        const outcome = await this.port.install(current, params.operationId);
        await this.update(value, { state: "handoff", stage: outcome.managerMustQuit ? "waitingForManagerExit" : "installerStarted", managerMustQuit: outcome.managerMustQuit });
      } catch (error) {
        const response = failure(null, error);
        const uncertain = executing && !(error instanceof UpdateNotStartedError);
        try { await this.update(value, { state: uncertain ? "indeterminate" : "failed", stage: uncertain ? "reconciliationRequired" : executing ? "downloadOrVerificationFailed" : "preconditionChanged", error: response.ok ? null : response.error }); }
        catch { value.operation.state = "indeterminate"; value.operation.stage = "journalUnavailable"; }
      } finally { this.active = value.operation.state === "handoff" && value.operation.managerMustQuit ? value.operation.id : null; }
    });
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job)); return structuredClone(value.operation);
  }
  private async update(value: Entry, patch: Partial<UpdateOperation>): Promise<void> {
    value.operation = { ...value.operation, ...patch, updatedAt: new Date().toISOString() };
    await durableJson(this.file(value.operation.id), this.directory, value);
    if (["installed", "failed"].includes(value.operation.state)) this.live.delete(value.operation.id);
  }
  async get(id: string): Promise<UpdateOperation> {
    const value = this.live.get(id) ?? await this.read(id);
    if (!value) throw new ContractError("OPERATION_UNKNOWN", "更新记录不在保留范围内，请核对已安装版本。");
    let operation = structuredClone(value.operation);
    if (!this.live.has(id) && writerStates.includes(operation.state)) operation = { ...operation, state: "indeterminate", stage: "previousSessionInterrupted" };
    if (!this.live.has(id) && operation.state === "handoff" && operation.managerMustQuit) operation = { ...operation, state: "indeterminate", stage: "previousSessionHandoff", managerMustQuit: false };
    if (["handoff", "indeterminate"].includes(operation.state)) {
      const receipt = await this.port.receipt(id).catch(() => null);
      if (receipt) {
        operation = { ...operation, state: receipt, stage: receipt === "installed" ? "bundleReplacedAndOpenAccepted" : "installerFailed", managerMustQuit: false };
        await this.update(value, operation);
        if (this.active === id) this.active = null;
      }
    }
    return operation;
  }
  open(handle: string): { url: string } {
    const proposal = this.proposals.get(handle);
    if (!proposal || Date.parse(proposal.result.expiresAt) <= Date.now()) throw new ContractError("RESOURCE_EXPIRED", "请重新检查后打开对应发布页。");
    return { url: proposal.result.releaseUrl };
  }
  notification(handle: string): { channel: string; version: string } {
    this.open(handle);
    const proposal = this.proposals.get(handle)!;
    if (!proposal.result.updateAvailable) throw new ContractError("INVALID_REQUEST", "No new version is available.");
    return { channel: proposal.result.channel, version: proposal.result.latestVersion };
  }
  async quit(id: string): Promise<{ quit: true }> {
    const operation = await this.get(id);
    if (!this.live.has(id) || operation.state !== "handoff" || !operation.managerMustQuit || this.businessBusy() || (this.active !== null && this.active !== id)) throw new ContractError("BUSY", "尚未确认安全的安装退出条件。");
    return { quit: true };
  }
  async close(): Promise<void> { this.closed = true; await Promise.allSettled([...this.jobs]); this.proposals.clear(); }
}
