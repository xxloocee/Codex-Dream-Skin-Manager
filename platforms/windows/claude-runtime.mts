import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ContractError } from "../../contracts/manager.mjs";
import type { ClaudeRuntimeObservation, ClaudeRuntimePort } from "../../core/ports/claude.mjs";

type Endpoint = { address: string; port: number };
type Application = { pid: number; executable: string; listeners: Endpoint[] };
type Payload = Parameters<ClaudeRuntimePort["apply"]>[0];
type StartupPayload = Parameters<ClaudeRuntimePort["configureStartup"]>[0];
type RendererModule = {
  buildClaudeMainSource(action: string, payload?: Payload | null, startupSource?: string | null): string;
  buildClaudeStartupSource(source: string): string;
  buildClaudeStartupVideoSource(video: NonNullable<StartupPayload["video"]>): string;
};
const samePath = (a: string, b: string) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
const unavailable = (code: string, message: string, awaiting = false): ClaudeRuntimeObservation => ({
  connection: awaiting ? "awaiting-debugger" : "unavailable", renderer: "unavailable", revision: null, diagnostics: [{ code, message }],
});

// This command only inventories the registered MSIX and listeners owned by its main process.
const INVENTORY = String.raw`
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

async function inventory(): Promise<Application | null> {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new ContractError("RUNTIME_UNAVAILABLE", "Windows system directory is unavailable.");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(INVENTORY, "utf16le").toString("base64")],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 262144 }, (error, stdout) => {
        if (error) reject(new ContractError(error.killed ? "TIMEOUT" : "RUNTIME_UNAVAILABLE", "Claude process discovery did not complete.", true));
        else resolve(stdout);
      });
  });
  let rows: Application[];
  try { rows = JSON.parse(output.trim()) as Application[]; }
  catch { throw new ContractError("RUNTIME_UNAVAILABLE", "Claude process inventory is invalid."); }
  if (!Array.isArray(rows) || rows.length > 1) throw new ContractError("RUNTIME_UNAVAILABLE", "Expected one registered Claude desktop main process.");
  const app = rows[0];
  if (!app) return null;
  if (!Number.isSafeInteger(app.pid) || app.pid < 1 || typeof app.executable !== "string" || !path.win32.isAbsolute(app.executable) || !Array.isArray(app.listeners)) {
    throw new ContractError("RUNTIME_UNAVAILABLE", "Claude process inventory is invalid.");
  }
  return app;
}

async function verifyOwner(app: Application, endpoint: Endpoint): Promise<void> {
  const fresh = await inventory();
  if (!fresh || fresh.pid !== app.pid || !samePath(fresh.executable, app.executable) ||
      !fresh.listeners.some(item => item.address === endpoint.address && item.port === endpoint.port)) {
    throw new ContractError("RUNTIME_CHANGED", "Claude process or its debugger listener changed; reconnect is required.", true);
  }
}

async function targetUrl(endpoint: Endpoint): Promise<string> {
  const targets = await new Promise<unknown>((resolve, reject) => {
    const request = http.get({ hostname: endpoint.address, port: endpoint.port, path: "/json/list", timeout: 2500 }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(new ContractError("RUNTIME_UNAVAILABLE", "Claude listener is not an Inspector.")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) request.destroy(new Error("Invalid Inspector response.")); else chunks.push(chunk);
      });
      response.on("error", () => reject(new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector discovery failed.", true)));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector discovery response is invalid.")); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new ContractError("TIMEOUT", "Claude Inspector discovery timed out.", true)), 3000);
    request.on("close", () => clearTimeout(deadline));
    request.on("timeout", () => request.destroy(new ContractError("TIMEOUT", "Claude Inspector discovery timed out.", true)));
    request.on("error", error => reject(error instanceof ContractError ? error : new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector discovery failed.", true)));
  });
  if (!Array.isArray(targets)) throw new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector target list is invalid.");
  const nodes = targets.filter((target: { type?: string }) => target?.type === "node") as { webSocketDebuggerUrl?: string }[];
  if (nodes.length !== 1 || typeof nodes[0]?.webSocketDebuggerUrl !== "string") throw new ContractError("RUNTIME_UNAVAILABLE", "Expected one Claude Node Inspector target.");
  let url: URL;
  try { url = new URL(nodes[0].webSocketDebuggerUrl); }
  catch { throw new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector endpoint is invalid."); }
  if (url.protocol !== "ws:" || url.hostname !== (endpoint.address === "::1" ? "[::1]" : endpoint.address) || Number(url.port) !== endpoint.port ||
    url.username || url.password || url.search || url.hash || !/^\/[a-f0-9-]{36}$/i.test(url.pathname)) {
    throw new ContractError("RUNTIME_UNAVAILABLE", "Rejected Claude Inspector endpoint.");
  }
  return url.href;
}

class InspectorSession {
  readonly socket: WebSocket;
  private counter = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", event => {
      if (typeof event.data !== "string" || event.data.length > 262144) { this.abort(); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { this.abort(); return; }
      const pending = this.pending.get(message?.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error || message.result?.exceptionDetails) pending.reject(new ContractError("RENDERER_UNVERIFIED", "Claude runtime evaluation failed; appearance may have changed.", true));
      else pending.resolve(message.result?.result?.value);
    });
    this.socket.addEventListener("error", () => this.abort());
    this.socket.addEventListener("close", () => this.abort());
  }
  get connected(): boolean { return this.socket.readyState === WebSocket.OPEN; }
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
      const failed = () => finish(new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector connection failed.", true));
      const timer = setTimeout(() => { finish(new ContractError("TIMEOUT", "Claude Inspector connection timed out.", true)); this.abort(); }, 3500);
      this.socket.addEventListener("open", opened);
      this.socket.addEventListener("error", failed);
      this.socket.addEventListener("close", failed);
    });
  }
  evaluate(expression: string): Promise<unknown> {
    if (!this.connected) throw new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector connection is closed.", true);
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ContractError("TIMEOUT", "Claude runtime timed out; the requested appearance change may still have taken effect.", true));
        this.abort();
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true, silent: true } })); }
      catch { this.abort(); }
    });
  }
  private abort(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ContractError("RUNTIME_UNAVAILABLE", "Claude Inspector connection closed; appearance state is unknown.", true));
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
        reject(new ContractError("TIMEOUT", "Claude Inspector disconnect was not confirmed.", true));
      }, 3500);
      this.socket.addEventListener("close", closed, { once: true });
      this.abort();
    });
  }
}

const IDENTITY = "({pid:process.pid,executable:process.execPath,electron:process.versions.electron??null})";

// Neither endpoint, expression, nor renderer IDs come from manager requests.
export class WindowsClaudeRuntime implements ClaudeRuntimePort {
  private session: InspectorSession | null = null;
  private rendererModule: Promise<RendererModule> | null = null;
  private startupSource: string | null | undefined;
  private startupSession: InspectorSession | null = null;
  constructor(private readonly root: string) {}

  private async connect(): Promise<ClaudeRuntimeObservation | null> {
    if (this.session?.connected) return null;
    if (this.session) { await this.session.close(); this.session = null; }
    const app = await inventory();
    if (!app) return unavailable("CLAUDE_NOT_RUNNING", "Start the registered Claude Desktop application and open its Code page.");
    const endpoints = app.listeners.filter(item => ["127.0.0.1", "::1"].includes(item.address) && Number.isInteger(item.port) && item.port > 0 && item.port <= 65535);
    if (!endpoints.length) return unavailable("CLAUDE_DEBUGGER_REQUIRED", "In Claude, enable Developer → Enable Main Process Debugger manually, then retry.", true);
    let timeout: ContractError | null = null;
    for (const endpoint of endpoints) {
      let candidate: InspectorSession | null = null;
      try {
        await verifyOwner(app, endpoint);
        const url = await targetUrl(endpoint);
        await verifyOwner(app, endpoint);
        candidate = new InspectorSession(url);
        await candidate.open();
        const identity = await candidate.evaluate(IDENTITY) as { pid?: number; executable?: string; electron?: string } | null;
        if (!identity || identity.pid !== app.pid || typeof identity.executable !== "string" || !samePath(identity.executable, app.executable) || typeof identity.electron !== "string") {
          throw new ContractError("RUNTIME_UNAVAILABLE", "Inspector identity does not match registered Claude.");
        }
        await verifyOwner(app, endpoint);
        this.session = candidate;
        return null;
      } catch (error) {
        if (candidate) await candidate.close();
        if (error instanceof ContractError && error.code === "TIMEOUT") timeout = error;
      }
    }
    if (timeout) throw timeout;
    return unavailable("CLAUDE_DEBUGGER_UNVERIFIED", "No verified Claude Main Process Debugger is available. Enable it manually in Claude, then retry.", true);
  }

  private async operation(action: "inspect" | "apply" | "remove" | "configureStartup", payload?: Payload, startupSource: string | null = null): Promise<ClaudeRuntimeObservation> {
    const connection = await this.connect();
    if (connection) return connection;
    if (action === "apply" && this.startupSource !== undefined && this.startupSession !== this.session) {
      await this.operation("configureStartup", undefined, this.startupSource);
    }
    const session = this.session!;
    this.rendererModule ??= import(pathToFileURL(path.join(this.root, "windows", "scripts", "claude-renderer.mjs")).href) as Promise<RendererModule>;
    const expression = (await this.rendererModule).buildClaudeMainSource(action, payload ?? null, startupSource);
    let result: { supported?: boolean; cancelled?: boolean; results?: { renderer?: string; revision?: string; failed?: boolean; error?: string | null }[] };
    try { result = await session.evaluate(expression) as typeof result; }
    catch (error) { if (error instanceof ContractError) throw error; throw new ContractError("RUNTIME_UNAVAILABLE", "Claude runtime could not complete the request.", true); }
    if (result?.cancelled) throw new ContractError("RUNTIME_CHANGED", "A newer Claude appearance command superseded this request.", true);
    const results = result?.results;
    if (action === "configureStartup") {
      if (!result?.supported || results?.some(row => row.failed || row.renderer !== "removed")) {
        throw new ContractError("RENDERER_UNVERIFIED", "Claude startup animation configuration could not be confirmed in every window.", true);
      }
      this.startupSource = startupSource;
      this.startupSession = session;
      return { connection: "connected", renderer: "unknown", revision: null, diagnostics: [] };
    }
    // remove also succeeds when Claude currently has no same-origin window:
    // unregistering the process controller is the meaningful operation.
    if (action === "remove" && result?.supported && results?.length === 0) {
      this.startupSession = null;
      return { connection: "connected", renderer: "removed", revision: null, diagnostics: [] };
    }
    if (!result?.supported || !results?.length) {
      if (action !== "inspect") throw new ContractError("RENDERER_UNVERIFIED", "No supported Claude Desktop Code page was found.", true);
      return { connection: "connected", renderer: "unavailable", revision: null, diagnostics: [{ code: "CLAUDE_CODE_REQUIRED", message: "Open the Code page in Claude Desktop with its main area and sidebar visible, without embedded frames." }] };
    }
    const expected = action === "apply" ? "applied" : "removed";
    if (action !== "inspect" && results.some(row => row.failed || row.renderer !== expected || action === "apply" && row.revision !== payload!.revision)) {
      const error = results.find(row => row.error)?.error;
      throw new ContractError("RENDERER_UNVERIFIED", error || "Claude appearance could not be confirmed in every window; some windows may have changed.", true);
    }
    const revision = results[0]?.revision;
    if (action === "remove") this.startupSession = null;
    const renderer = results.every(row => row.renderer === "applied" && typeof row.revision === "string" && row.revision === revision) ? "applied"
      : results.every(row => row.renderer === "removed") ? "removed" : "unknown";
    const errors = [...new Set(results.flatMap(row => row.error ? [row.error] : []))];
    return { connection: "connected", renderer, revision: renderer === "applied" ? revision! : null,
      diagnostics: errors.length ? errors.map(message => ({ code: "CLAUDE_LIFECYCLE_FAILED", message }))
        : renderer === "unknown" ? [{ code: "CLAUDE_WINDOWS_DIFFER", message: "Claude windows do not have a consistent verified appearance." }] : [] };
  }
  async inspect(): Promise<ClaudeRuntimeObservation> {
    try { return await this.operation("inspect"); }
    catch (error) {
      if (error instanceof ContractError && error.code === "TIMEOUT") throw error;
      return unavailable("CLAUDE_RUNTIME_UNAVAILABLE", "Claude runtime could not be inspected. Its existing appearance has not been confirmed.");
    }
  }
  async apply(payload: Payload): Promise<ClaudeRuntimeObservation> {
    try { return await this.operation("apply", payload); }
    catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("RUNTIME_UNAVAILABLE", "Claude background could not be applied; appearance state is unconfirmed.", true);
    }
  }
  async configureStartup(payload: StartupPayload): Promise<void> {
    let source: string | null = null;
    if (payload.enabled) {
      const animationRoot = path.join(this.root, "windows", "assets", "startup-animation");
      this.rendererModule ??= import(pathToFileURL(path.join(this.root, "windows", "scripts", "claude-renderer.mjs")).href) as Promise<RendererModule>;
      if (payload.video) {
        source = (await this.rendererModule).buildClaudeStartupVideoSource(payload.video);
      } else {
        const builder = await import(pathToFileURL(path.join(animationRoot, "extension", "payload.mjs")).href) as { buildInjection(root: string, options: { wallpaperEnabled: boolean; customizationEnabled: boolean }): Promise<string> };
        const injection = await builder.buildInjection(animationRoot, { wallpaperEnabled: false, customizationEnabled: false });
        source = (await this.rendererModule).buildClaudeStartupSource(injection);
      }
    }
    const observation = await this.operation("configureStartup", undefined, source);
    if (observation.connection !== "connected") {
      const diagnostic = observation.diagnostics[0];
      throw new ContractError("RUNTIME_UNAVAILABLE", diagnostic?.message ?? "Claude startup animation could not be configured.", true);
    }
  }
  async remove(): Promise<ClaudeRuntimeObservation> {
    try { return await this.operation("remove"); }
    catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("RUNTIME_UNAVAILABLE", "Claude background could not be removed; appearance state is unconfirmed.", true);
    }
  }
  async close(): Promise<void> {
    const session = this.session; this.session = null;
    // Closing the transport deliberately leaves the user's applied background.
    await session?.close();
  }
}
