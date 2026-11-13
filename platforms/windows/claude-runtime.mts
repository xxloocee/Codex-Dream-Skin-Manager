import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dshProcess } from "./dsh-process.mjs";
import { ContractError } from "../../contracts/manager.mjs";
import type { ClaudeRuntimeObservation, ClaudeRuntimePort } from "../../core/ports/claude.mjs";

type Endpoint = { address: string; port: number };
type Application = { pid: number; executable: string; startTime?: string; listeners: Endpoint[] };
type Payload = Parameters<ClaudeRuntimePort["apply"]>[0];
type StartupPayload = Parameters<ClaudeRuntimePort["configureStartup"]>[0];
type Target = "claude" | "dsh" | "dsh-next";
type RendererModule = {
  buildClaudeMainSource(action: string, payload?: Payload | null, startupSource?: string | null, target?: Target, playStartup?: boolean): string;
  buildClaudeStartupSource(source: string, target?: Target): string;
  buildClaudeStartupVideoSource(video: NonNullable<StartupPayload["video"]>, target?: Target): string;
};
const samePath = (a: string, b: string) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
const unavailable = (code: string, message: string, awaiting = false): ClaudeRuntimeObservation => ({
  connection: awaiting ? "awaiting-debugger" : "unavailable", renderer: "unavailable", revision: null, diagnostics: [{ code, message }],
});

// This command only inventories the registered MSIX and listeners owned by its main process.
const CLAUDE_INVENTORY = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$rows = @()
foreach ($package in @(Get-AppxPackage -Name 'Claude' | Where-Object { $_.Name -eq 'Claude' })) {
  $expected = Join-Path $package.InstallLocation 'app\Claude.exe'
  foreach ($entry in @(Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'")) {
    if ($entry.ExecutablePath -and $entry.ExecutablePath -ieq $expected -and $entry.CommandLine -notmatch '--type=') {
      $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $entry.ProcessId -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{ address = $_.LocalAddress; port = $_.LocalPort }
      })
      $rows += [pscustomobject]@{ pid = $entry.ProcessId; executable = $expected; listeners = $listeners }
    }
  }
}
ConvertTo-Json -InputObject @($rows) -Depth 5 -Compress
`;

const targets = {
  claude: { label: "Claude", prefix: "CLAUDE", inventory: CLAUDE_INVENTORY,
    notRunning: "Start the registered Claude Desktop application and open its Code page.",
    debuggerRequired: "In Claude, enable Developer → Enable Main Process Debugger manually, then retry.",
    pageRequired: "Open the Code page in Claude Desktop with its main area and sidebar visible, without embedded frames." },
  dsh: { label: "DSH rc", prefix: "DSH", inventory: "",
    notRunning: "Apply a skin to start DSH rc with its main process debugger.",
    debuggerRequired: "Apply a skin to restart DSH rc with its main process debugger.",
    pageRequired: "Open the main DSH rc application page (dsh-app://app/)." },
  "dsh-next": { label: "DSH Next", prefix: "DSH_NEXT", inventory: "",
    notRunning: "Apply a skin to start DSH Next with its main process debugger.",
    debuggerRequired: "Apply a skin to restart DSH Next with its main process debugger.",
    pageRequired: "Open the main DSH Next application page (dsh-app://app/)." },
};
type TargetConfig = typeof targets[Target];

async function inventory(target: TargetConfig, root: string): Promise<Application | null> {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new ContractError("RUNTIME_UNAVAILABLE", "Windows system directory is unavailable.");
  const output = target.prefix !== "CLAUDE" ? JSON.stringify((await dshProcess(root, "inventory", undefined, 15000, target.prefix === "DSH_NEXT" ? "dsh-next" : "dsh")).applications) : await new Promise<string>((resolve, reject) => {
    execFile(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(target.inventory, "utf16le").toString("base64")],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 262144 }, (error, stdout) => {
        if (error) reject(new ContractError(error.killed ? "TIMEOUT" : "RUNTIME_UNAVAILABLE", `${target.label} process discovery did not complete.`, true));
        else resolve(stdout);
      });
  });
  let rows: Application[];
  try { rows = JSON.parse(output.trim()) as Application[]; }
  catch { throw new ContractError("RUNTIME_UNAVAILABLE", `${target.label} process inventory is invalid.`); }
  if (!Array.isArray(rows) || rows.length > 1) throw new ContractError("RUNTIME_UNAVAILABLE", `Expected one registered ${target.label} desktop main process.`);
  const app = rows[0];
  if (!app) return null;
  if (!Number.isSafeInteger(app.pid) || app.pid < 1 || typeof app.executable !== "string" || !path.win32.isAbsolute(app.executable) || !Array.isArray(app.listeners)) {
    throw new ContractError("RUNTIME_UNAVAILABLE", `${target.label} process inventory is invalid.`);
  }
  return app;
}

async function verifyOwner(app: Application, endpoint: Endpoint, target: TargetConfig, root: string): Promise<void> {
  const fresh = await inventory(target, root);
  if (!fresh || fresh.pid !== app.pid || !samePath(fresh.executable, app.executable) || fresh.startTime !== app.startTime ||
      !fresh.listeners.some(item => item.address === endpoint.address && item.port === endpoint.port)) {
    throw new ContractError("RUNTIME_CHANGED", `${target.label} process or its debugger listener changed; reconnect is required.`, true);
  }
}

async function targetUrl(endpoint: Endpoint, target: TargetConfig): Promise<string> {
  const targets = await new Promise<unknown>((resolve, reject) => {
    const request = http.get({ hostname: endpoint.address, port: endpoint.port, path: "/json/list", timeout: 2500 }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(new ContractError("RUNTIME_UNAVAILABLE", `${target.label} listener is not an Inspector.`)); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) request.destroy(new Error("Invalid Inspector response.")); else chunks.push(chunk);
      });
      response.on("error", () => reject(new ContractError("RUNTIME_UNAVAILABLE", `${target.label} Inspector discovery failed.`, true)));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new ContractError("RUNTIME_UNAVAILABLE", `${target.label} Inspector discovery response is invalid.`)); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new ContractError("TIMEOUT", `${target.label} Inspector discovery timed out.`, true)), 3000);
    request.on("close", () => clearTimeout(deadline));
    request.on("timeout", () => request.destroy(new ContractError("TIMEOUT", `${target.label} Inspector discovery timed out.`, true)));
    request.on("error", error => reject(error instanceof ContractError ? error : new ContractError("RUNTIME_UNAVAILABLE", `${target.label} Inspector discovery failed.`, true)));
  });
  if (!Array.isArray(targets)) throw new ContractError("RUNTIME_UNAVAILABLE", `${target.label} Inspector target list is invalid.`);
  const nodes = targets.filter((target: { type?: string }) => target?.type === "node") as { webSocketDebuggerUrl?: string }[];
  if (nodes.length !== 1 || typeof nodes[0]?.webSocketDebuggerUrl !== "string") throw new ContractError("RUNTIME_UNAVAILABLE", `Expected one ${target.label} Node Inspector target.`);
  let url: URL;
  try { url = new URL(nodes[0].webSocketDebuggerUrl); }
  catch { throw new ContractError("RUNTIME_UNAVAILABLE", `${target.label} Inspector endpoint is invalid.`); }
  if (url.protocol !== "ws:" || url.hostname !== (endpoint.address === "::1" ? "[::1]" : endpoint.address) || Number(url.port) !== endpoint.port ||
    url.username || url.password || url.search || url.hash || !/^\/[a-f0-9-]{36}$/i.test(url.pathname)) {
    throw new ContractError(target.prefix !== "CLAUDE" ? "RUNTIME_CHANGED" : "RUNTIME_UNAVAILABLE", `Rejected ${target.label} Inspector endpoint.`);
  }
  return url.href;
}

class InspectorSession {
  readonly socket: WebSocket;
  private counter = 0;
  private ended: ContractError | null = null;
  private defaultContext: { id: number; uniqueId?: string } | null = null;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(url: string, private readonly label: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", event => {
      if (typeof event.data !== "string" || event.data.length > 262144) { this.abort(); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { this.abort(); return; }
      if (message?.method === "Runtime.executionContextCreated") {
        const context = message.params?.context;
        if (!this.ended && context?.auxData?.isDefault === true) this.defaultContext = { id: context.id, uniqueId: context.uniqueId };
        return;
      }
      if (message?.method === "Runtime.executionContextDestroyed") {
        const context = this.defaultContext, destroyed = message.params;
        if (context && (destroyed?.executionContextUniqueId !== undefined
          ? destroyed.executionContextUniqueId === context.uniqueId : destroyed?.executionContextId === context.id)) this.invalidate();
        return;
      }
      if (message?.method === "Runtime.executionContextsCleared" ||
          (message?.error?.code === -32000 && message.error.message === "Cannot find context with specified id")) {
        this.invalidate(); return;
      }
      const pending = this.pending.get(message?.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error || message.result?.exceptionDetails) pending.reject(new ContractError("RENDERER_UNVERIFIED", `${this.label} runtime evaluation failed; appearance may have changed.`, true));
      else pending.resolve(message.result?.result?.value);
    });
    this.socket.addEventListener("error", () => this.abort());
    this.socket.addEventListener("close", () => this.abort());
  }
  get connected(): boolean { return !this.ended && this.socket.readyState === WebSocket.OPEN; }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.socket.removeEventListener("open", opened);
        this.socket.removeEventListener("error", failed);
        this.socket.removeEventListener("close", failed);
        if (error) reject(error); else resolve();
      };
      const opened = () => finish();
      const failed = () => finish(new ContractError("RUNTIME_UNAVAILABLE", `${this.label} Inspector connection failed.`, true));
      const timer = setTimeout(() => { finish(new ContractError("TIMEOUT", `${this.label} Inspector connection timed out.`, true)); this.abort(); }, 3500);
      this.socket.addEventListener("open", opened);
      this.socket.addEventListener("error", failed);
      this.socket.addEventListener("close", failed);
    });
    await this.request("Runtime.enable");
  }
  evaluate(expression: string): Promise<unknown> {
    return this.request("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, silent: true });
  }
  private request(method: "Runtime.enable" | "Runtime.evaluate", params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) throw this.ended ?? new ContractError("RUNTIME_UNAVAILABLE", `${this.label} Inspector connection is closed.`, true);
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ContractError("TIMEOUT", `${this.label} runtime timed out; the requested appearance change may still have taken effect.`, true));
        this.abort();
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { this.abort(); }
    });
  }
  private invalidate(): void {
    this.abort(new ContractError("RUNTIME_CHANGED", `${this.label} main process execution context ended; appearance is unconfirmed. Apply the skin again.`, true));
  }
  private abort(error = new ContractError("RUNTIME_UNAVAILABLE", `${this.label} Inspector connection closed; appearance state is unknown.`, true)): void {
    this.ended ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.ended);
    }
    this.pending.clear();
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve, reject) => {
      const closed = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.socket.removeEventListener("close", closed);
        reject(new ContractError("TIMEOUT", `${this.label} Inspector disconnect was not confirmed.`, true));
      }, 3500);
      this.socket.addEventListener("close", closed, { once: true });
      this.abort();
    });
  }
}

const IDENTITY = "({pid:process.pid,executable:process.execPath,electron:process.versions.electron??null})";

// Neither endpoint, expression, nor renderer IDs come from manager requests.
export class WindowsElectronRuntime implements ClaudeRuntimePort {
  private session: InspectorSession | null = null;
  private rendererModule: Promise<RendererModule> | null = null;
  private startupSource: string | null | undefined;
  private startupSession: InspectorSession | null = null;
  private readonly config: TargetConfig;
  protected application: Application | null = null;
  private connecting: Promise<ClaudeRuntimeObservation | null> | null = null;
  constructor(protected readonly root: string, private readonly target: Target) { this.config = targets[target]; }

  protected connect(): Promise<ClaudeRuntimeObservation | null> {
    if (this.connecting) return this.connecting;
    const job = this.openConnection();
    this.connecting = job;
    void job.finally(() => { if (this.connecting === job) this.connecting = null; }).catch(() => {});
    return job;
  }

  private async openConnection(): Promise<ClaudeRuntimeObservation | null> {
    if (this.session?.connected) return null;
    if (this.session) { await this.session.close(); this.session = null; }
    const app = await inventory(this.config, this.root);
    this.application = app;
    if (!app) return unavailable(`${this.config.prefix}_NOT_RUNNING`, this.config.notRunning);
    const endpoints = app.listeners.filter(item => ["127.0.0.1", "::1"].includes(item.address) && Number.isInteger(item.port) && item.port > 0 && item.port <= 65535);
    if (!endpoints.length) return unavailable(`${this.config.prefix}_DEBUGGER_REQUIRED`, this.config.debuggerRequired, this.target === "claude");
    let timeout: ContractError | null = null;
    for (const endpoint of endpoints) {
      let candidate: InspectorSession | null = null;
      try {
        await verifyOwner(app, endpoint, this.config, this.root);
        const url = await targetUrl(endpoint, this.config);
        await verifyOwner(app, endpoint, this.config, this.root);
        candidate = new InspectorSession(url, this.config.label);
        await candidate.open();
        const identity = await candidate.evaluate(IDENTITY) as { pid?: number; executable?: string; electron?: string } | null;
        if (!identity || identity.pid !== app.pid || typeof identity.executable !== "string" || !samePath(identity.executable, app.executable) || typeof identity.electron !== "string") {
          throw new ContractError(this.target !== "claude" ? "RUNTIME_CHANGED" : "RUNTIME_UNAVAILABLE", `Inspector identity does not match registered ${this.config.label}.`);
        }
        await verifyOwner(app, endpoint, this.config, this.root);
        this.session = candidate;
        return null;
      } catch (error) {
        if (candidate) await candidate.close();
        if (error instanceof ContractError && error.code === "RUNTIME_CHANGED") throw error;
        // Finding a Node Inspector and then failing its connection/evaluation
        // does not prove that restarting the application is necessary.
        if (this.target !== "claude" && candidate) throw error;
        if (error instanceof ContractError && error.code === "TIMEOUT") timeout = error;
      }
    }
    if (timeout) throw timeout;
    return unavailable(`${this.config.prefix}_DEBUGGER_UNVERIFIED`, `No verified ${this.config.label} Main Process Debugger is available. ${this.config.debuggerRequired}`, this.target === "claude");
  }

  private async operation(action: "inspect" | "apply" | "remove" | "configureStartup", payload?: Payload, startupSource: string | null = null, playStartup = false): Promise<ClaudeRuntimeObservation> {
    const connection = await this.connect();
    if (connection) return connection;
    const startupDiagnostics: ClaudeRuntimeObservation["diagnostics"] = [];
    if (action === "apply" && this.startupSource !== undefined && this.startupSession !== this.session) {
      try { await this.operation("configureStartup", undefined, this.startupSource); }
      catch (error) {
        if (error instanceof ContractError && error.code === "RUNTIME_CHANGED") throw error;
        startupDiagnostics.push({ code: `${this.config.prefix}_STARTUP_FAILED`,
          message: error instanceof Error ? error.message : `${this.config.label} startup animation could not be configured.` });
      }
    }
    const session = this.session!;
    this.rendererModule ??= import(pathToFileURL(path.join(this.root, "windows", "scripts", "claude-renderer.mjs")).href) as Promise<RendererModule>;
    const expression = (await this.rendererModule).buildClaudeMainSource(action, payload ?? null, startupSource, this.target, this.target !== "claude" && playStartup);
    let result: { supported?: boolean; cancelled?: boolean; results?: { renderer?: string; revision?: string; failed?: boolean; error?: string | null; startupError?: string | null }[] };
    try { result = await session.evaluate(expression) as typeof result; }
    catch (error) { if (error instanceof ContractError) throw error; throw new ContractError("RUNTIME_UNAVAILABLE", `${this.config.label} runtime could not complete the request.`, true); }
    if (result?.cancelled) throw new ContractError("RUNTIME_CHANGED", `A newer ${this.config.label} appearance command superseded this request.`, true);
    const results = result?.results;
    if (action === "configureStartup") {
      if (!result?.supported || results?.some(row => row.failed || row.renderer !== "removed")) {
        throw new ContractError("RENDERER_UNVERIFIED", `${this.config.label} startup animation configuration could not be confirmed in every window.`, true);
      }
      this.startupSource = startupSource;
      this.startupSession = session;
      return { connection: "connected", renderer: "unknown", revision: null, diagnostics: [] };
    }
    // remove also succeeds when the target currently has no same-origin window:
    // unregistering the process controller is the meaningful operation.
    if (action === "remove" && result?.supported && results?.length === 0) {
      this.startupSession = null;
      return { connection: "connected", renderer: "removed", revision: null, diagnostics: [] };
    }
    if (!result?.supported || !results?.length) {
      if (action !== "inspect") throw new ContractError("RENDERER_UNVERIFIED", `No supported ${this.config.label} page was found.`, true);
      return { connection: "connected", renderer: "unavailable", revision: null, diagnostics: [{ code: this.target === "claude" ? "CLAUDE_CODE_REQUIRED" : `${this.config.prefix}_PAGE_REQUIRED`, message: this.config.pageRequired }] };
    }
    // A DSH window can reach its URL before React mounts. Keep real window
    // failures and inconsistent ready windows distinct from that loading state.
    if (action === "inspect" && this.target !== "claude" && results.some(row => row.renderer === "unavailable")) {
      const ready = results.filter(row => row.renderer !== "unavailable");
      if (results.every(row => !row.failed && !row.error) && (ready.every(row => row.renderer === "removed") ||
          ready.every(row => row.renderer === "applied" && typeof row.revision === "string" && !!row.revision && row.revision === ready[0]?.revision))) {
        return { connection: "connected", renderer: "unavailable", revision: null, diagnostics: [{ code: `${this.config.prefix}_PAGE_REQUIRED`, message: this.config.pageRequired }] };
      }
    }
    const expected = action === "apply" ? "applied" : "removed";
    if (action !== "inspect" && results.some(row => row.failed || row.renderer !== expected || action === "apply" && row.revision !== payload!.revision)) {
      const error = results.find(row => row.error)?.error;
      throw new ContractError("RENDERER_UNVERIFIED", error || `${this.config.label} appearance could not be confirmed in every window; some windows may have changed.`, true);
    }
    const revision = results[0]?.revision;
    if (action === "remove") this.startupSession = null;
    const renderer = results.every(row => row.renderer === "applied" && typeof row.revision === "string" && row.revision === revision) ? "applied"
      : results.every(row => row.renderer === "removed") ? "removed" : "unknown";
    const errors = [...new Set(results.flatMap(row => row.error ? [row.error] : []))];
    const startupErrors = [...new Set(results.flatMap(row => row.startupError ? [row.startupError] : []))];
    return { connection: "connected", renderer, revision: renderer === "applied" ? revision! : null,
      diagnostics: [...startupDiagnostics, ...startupErrors.map(message => ({ code: `${this.config.prefix}_STARTUP_FAILED`, message })), ...(errors.length ? errors.map(message => ({ code: `${this.config.prefix}_LIFECYCLE_FAILED`, message }))
        : renderer === "unknown" ? [{ code: `${this.config.prefix}_WINDOWS_DIFFER`, message: `${this.config.label} windows do not have a consistent verified appearance.` }] : [])] };
  }
  async inspect(): Promise<ClaudeRuntimeObservation> {
    try { return await this.operation("inspect"); }
    catch (error) {
      if (error instanceof ContractError && (error.code === "TIMEOUT" || error.code === "RUNTIME_CHANGED")) throw error;
      return unavailable(`${this.config.prefix}_RUNTIME_UNAVAILABLE`, `${this.config.label} runtime could not be inspected. Its existing appearance has not been confirmed.`);
    }
  }
  async apply(payload: Payload, options?: Parameters<ClaudeRuntimePort["apply"]>[1]): Promise<ClaudeRuntimeObservation> {
    try { return await this.operation("apply", payload, null, options?.playStartup); }
    catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("RUNTIME_UNAVAILABLE", `${this.config.label} background could not be applied; appearance state is unconfirmed.`, true);
    }
  }
  async configureStartup(payload: StartupPayload): Promise<void> {
    let source: string | null = null;
    if (payload.enabled) {
      const animationRoot = path.join(this.root, "windows", "assets", "startup-animation");
      this.rendererModule ??= import(pathToFileURL(path.join(this.root, "windows", "scripts", "claude-renderer.mjs")).href) as Promise<RendererModule>;
      if (payload.video) {
        source = (await this.rendererModule).buildClaudeStartupVideoSource(payload.video, this.target);
      } else {
        const builder = await import(pathToFileURL(path.join(animationRoot, "extension", "payload.mjs")).href) as { buildInjection(root: string, options: { wallpaperEnabled: boolean; customizationEnabled: boolean }): Promise<string> };
        const injection = await builder.buildInjection(animationRoot, { wallpaperEnabled: false, customizationEnabled: false });
        source = (await this.rendererModule).buildClaudeStartupSource(injection, this.target);
      }
    }
    const observation = await this.operation("configureStartup", undefined, source);
    if (observation.connection !== "connected") {
      const diagnostic = observation.diagnostics[0];
      throw new ContractError("RUNTIME_UNAVAILABLE", diagnostic?.message ?? `${this.config.label} startup animation could not be configured.`, true);
    }
  }
  async remove(): Promise<ClaudeRuntimeObservation> {
    try { return await this.operation("remove"); }
    catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("RUNTIME_UNAVAILABLE", `${this.config.label} background could not be removed; appearance state is unconfirmed.`, true);
    }
  }
  async close(): Promise<void> {
    const session = this.session; this.session = null;
    // Closing the transport deliberately leaves the user's applied background.
    await session?.close();
  }
}

export class WindowsClaudeRuntime extends WindowsElectronRuntime {
  constructor(root: string) { super(root, "claude"); }
}
