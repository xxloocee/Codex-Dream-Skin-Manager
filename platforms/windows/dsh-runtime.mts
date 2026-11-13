import { WindowsElectronRuntime } from "./claude-runtime.mjs";
import { ContractError } from "../../contracts/manager.mjs";
import type { ClaudeRuntimeObservation, ClaudeRuntimePort } from "../../core/ports/claude.mjs";
import { dshProcess, type DshTarget } from "./dsh-process.mjs";

export class WindowsDshRuntime extends WindowsElectronRuntime {
  private preparing: Promise<boolean> | null = null;
  private readinessDeadline = 0;
  constructor(root: string, private readonly dshTarget: DshTarget = "dsh") { super(root, dshTarget); }
  private get dshLabel(): string { return this.dshTarget === "dsh-next" ? "DSH Next" : "DSH rc"; }
  private get dshPrefix(): string { return this.dshTarget === "dsh-next" ? "DSH_NEXT" : "DSH"; }

  protected override async connect(): Promise<ClaudeRuntimeObservation | null> {
    // A status probe must join preparation rather than connect to the process
    // that is being replaced and publish that stale session afterwards.
    if (this.preparing) await this.preparing;
    return super.connect();
  }

  prepareApply(): Promise<boolean> {
    if (this.preparing) return this.preparing;
    const job = this.prepare();
    this.preparing = job;
    void job.finally(() => { if (this.preparing === job) this.preparing = null; }).catch(() => {});
    return job;
  }

  private async prepare(): Promise<boolean> {
    // Leave room for the existing startup configuration and apply evaluations
    // within the manager client's one-minute request deadline.
    this.readinessDeadline = Date.now() + 35000;
    const connection = await this.beforeDeadline(super.connect());
    if (!connection) return false;
    if (!connection.diagnostics.some(item => [`${this.dshPrefix}_NOT_RUNNING`, `${this.dshPrefix}_DEBUGGER_REQUIRED`, `${this.dshPrefix}_DEBUGGER_UNVERIFIED`].includes(item.code))) {
      throw new ContractError("RUNTIME_UNAVAILABLE", connection.diagnostics[0]?.message ?? `${this.dshLabel} main process debugger is unavailable.`, true);
    }
    const app = this.application;
    let executable = app?.executable;
    if (!app) {
      const fresh = await dshProcess(this.root, "inventory", undefined, this.readinessDeadline - Date.now(), this.dshTarget);
      if (fresh.applications.length) throw new ContractError("RUNTIME_CHANGED", `${this.dshLabel} process changed before preparation; retry applying the skin.`, true);
      if (fresh.installations.length !== 1) throw new ContractError("RUNTIME_UNAVAILABLE", `Expected one registered ${this.dshLabel} installation before starting it.`);
      executable = fresh.installations[0]!;
    }
    await dshProcess(this.root, "prepare", { executable: executable!, pid: app?.pid ?? 0, startTime: app?.startTime ?? "0" }, this.readinessDeadline - Date.now(), this.dshTarget);
    while (Date.now() < this.readinessDeadline) {
      const pending = await this.beforeDeadline(super.connect());
      if (!pending) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new ContractError("TIMEOUT", `${this.dshLabel} started, but its main process debugger did not become ready.`, true);
  }

  private beforeDeadline<T>(job: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ContractError("TIMEOUT", `${this.dshLabel} preparation timed out; retry applying the skin.`, true)), Math.max(0, this.readinessDeadline - Date.now()));
      job.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  override async apply(payload: Parameters<ClaudeRuntimePort["apply"]>[0], options?: Parameters<ClaudeRuntimePort["apply"]>[1]): Promise<ClaudeRuntimeObservation> {
    if (this.preparing) await this.preparing;
    if (options?.playStartup) {
      while (true) {
        const observed = await this.beforeDeadline(super.inspect());
        if (!observed.diagnostics.some(item => item.code === `${this.dshPrefix}_PAGE_REQUIRED`)) {
          if (observed.connection !== "connected") throw new ContractError("RUNTIME_UNAVAILABLE", observed.diagnostics[0]?.message ?? `${this.dshLabel} main process debugger is unavailable.`, true);
          break;
        }
        if (Date.now() >= this.readinessDeadline) throw new ContractError("TIMEOUT", `${this.dshLabel} started, but its main application page did not become ready.`, true);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    return super.apply(payload, options);
  }
}
