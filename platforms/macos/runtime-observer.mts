import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ContractError, record } from "../../contracts/manager.mjs";
import { fileStamp, jsonObject, optionalBytes } from "../../core/local-files.mjs";
import { macosProbe } from "../../core/macos-probe.mjs";

const run = promisify(execFile);
const environment = () => ({ ...process.env, LC_ALL: "C", TZ: "UTC" });
const options = () => ({ encoding: "utf8" as const, timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: environment() });
interface ProcessIdentity { pid: number; parent: number; startedAt: string; executable: string }

async function processes(): Promise<Map<number, ProcessIdentity>> {
  const { stdout } = await run("/bin/ps", ["-ww", "-axo", "pid=,ppid=,lstart=,comm="], options());
  const result = new Map<number, ProcessIdentity>();
  for (const line of stdout.split("\n").filter(value => value.trim())) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/.exec(line);
    if (!match) throw new Error("Invalid macOS process observation.");
    const pid = Number(match[1]);
    result.set(pid, { pid, parent: Number(match[2]), startedAt: "UTC:" + match.slice(3, 8).join(" "), executable: match[8]!.trim() });
  }
  return result;
}

async function listeners(port: number): Promise<number[]> {
  let output: string;
  try { output = (await run("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], options())).stdout; }
  catch (error) {
    if (record(error) && error.code === 1 && error.stdout === "" && error.stderr === "") return [];
    throw error;
  }
  const values = output.trim() ? output.trim().split(/\s+/) : [];
  if (values.some(value => !/^[1-9][0-9]*$/.test(value))) throw new Error("Invalid macOS listener observation.");
  return [...new Set(values.map(Number))].sort((a, b) => a - b);
}

function mainProcesses(snapshot: Map<number, ProcessIdentity>, executable: string): string {
  return [...snapshot.values()].filter(value => value.executable === executable).sort((a, b) => a.pid - b.pid)
    .map(value => `${value.pid}:${value.startedAt}\n`).join("");
}

function ownedListener(pid: number, snapshot: Map<number, ProcessIdentity>, executable: string): boolean {
  let current = pid;
  for (let depth = 0; current > 1 && depth < 32; depth++) {
    const value = snapshot.get(current);
    if (!value) return false;
    if (value.executable === executable) return true;
    if (value.parent === current) return false;
    current = value.parent;
  }
  return false;
}

async function watcherMatches(state: Record<string, unknown>, port: number, snapshot: Map<number, ProcessIdentity>): Promise<boolean> {
  const { injectorPid: pid, injectorStartedAt: started, nodePath: node, injectorPath: injector } = state;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0 || typeof started !== "string" || !started ||
      typeof node !== "string" || !path.isAbsolute(node) || typeof injector !== "string" || !path.isAbsolute(injector)) return false;
  const current = snapshot.get(Number(pid));
  if (!current || current.executable !== node) return false;
  if (started.startsWith("UTC:")) {
    if (current.startedAt !== started) return false;
  } else {
    // Legacy identities have no timezone; retain the native exact local match.
    const { stdout } = await run("/bin/ps", ["-p", String(pid), "-o", "lstart="], { ...options(), env: process.env });
    if (stdout.trim().replace(/\s+/g, " ") !== started) return false;
  }
  const { stdout } = await run("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], options());
  const command = stdout.trim().toLowerCase();
  return command.startsWith(node.toLowerCase() + " ") &&
    command.includes(`${injector.toLowerCase()} --watch --port ${port} --theme-dir `);
}

// Advisory reads only. Transactions still use the signed native probe, freshly,
// before controlling Codex; observation never bootstraps another Node runtime.
export class MacOSRuntimeObserver {
  private application: { bundle: string; stamp: string; executable: string } | null = null;
  constructor(private readonly stateRoot: string) {}

  private async applicationExecutable(): Promise<string> {
    const candidates = [process.env.CODEX_APP_BUNDLE, "/Applications/ChatGPT.app", path.join(os.homedir(), "Applications/ChatGPT.app"),
      "/Applications/Codex.app", path.join(os.homedir(), "Applications/Codex.app")];
    const resolve = async (bundle: string): Promise<string | null> => {
      if (!path.isAbsolute(bundle)) throw new Error("Invalid Codex application path.");
      const info = path.join(bundle, "Contents/Info.plist");
      let stamp: string;
      try { stamp = JSON.stringify(await fileStamp(info, bundle)); }
      catch (error) { if (record(error) && error.code === "ENOENT") return null; throw error; }
      if (this.application?.bundle === bundle && this.application.stamp === stamp) return this.application.executable;
      const { stdout } = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", info], options());
      const value = jsonObject(Buffer.from(stdout));
      if (value.CFBundleIdentifier !== "com.openai.codex") return null;
      const name = value.CFBundleExecutable;
      if (typeof name !== "string" || !name || /[/\\\x00-\x1f\x7f]/.test(name) || name === "." || name === "..") throw new Error("Invalid Codex executable.");
      const executable = path.join(bundle, "Contents/MacOS", name);
      await fileStamp(executable, bundle);
      if (JSON.stringify(await fileStamp(info, bundle)) !== stamp) throw new Error("Codex application changed during observation.");
      this.application = { bundle, stamp, executable };
      return executable;
    };
    for (const bundle of candidates) {
      if (!bundle) continue;
      const executable = await resolve(bundle);
      if (executable) return executable;
    }
    const { stdout } = await run("/usr/bin/mdfind", ["kMDItemCFBundleIdentifier == \"com.openai.codex\""], options());
    const bundle = stdout.split("\n")[0];
    const executable = bundle ? await resolve(bundle) : null;
    if (!executable) throw new Error("Codex application is unavailable.");
    return executable;
  }

  async inspect(): Promise<Record<string, unknown>> {
    try {
      const file = path.join(this.stateRoot, "state.json"), before = await optionalBytes(file, this.stateRoot);
      const state = before ? jsonObject(before) : {};
      if (before && typeof state.port !== "number" && (typeof state.port !== "string" || !/^[0-9]+$/.test(state.port))) throw new Error("Invalid state port.");
      const port = before ? Number(state.port) : 9341;
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid state port.");
      const executable = await this.applicationExecutable();
      const initial = await processes(), owners = await listeners(port);
      let browser = "";
      if (owners.length && owners.every(pid => ownedListener(pid, initial, executable))) {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { redirect: "error", signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw new Error("CDP observation failed.");
        browser = await response.text();
      } else if (owners.length) throw new Error("CDP listener does not belong to Codex.");
      const watcherVerified = await watcherMatches(state, port, initial);
      const final = await processes(), finalOwners = await listeners(port);
      if (mainProcesses(initial, executable) !== mainProcesses(final, executable) ||
          JSON.stringify(owners) !== JSON.stringify(finalOwners) ||
          owners.some(pid => initial.get(pid)?.startedAt !== final.get(pid)?.startedAt || !ownedListener(pid, final, executable)) ||
          watcherVerified && (initial.get(Number(state.injectorPid))?.startedAt !== final.get(Number(state.injectorPid))?.startedAt ||
            initial.get(Number(state.injectorPid))?.executable !== final.get(Number(state.injectorPid))?.executable)) {
        throw new Error("Runtime changed during observation.");
      }
      const after = await optionalBytes(file, this.stateRoot);
      if (before === null ? after !== null : after === null || !Buffer.from(before).equals(after)) throw new Error("State changed during observation.");
      return macosProbe(port, executable, mainProcesses(final, executable), browser, state.session === "paused", watcherVerified);
    } catch {
      throw new ContractError("RUNTIME_UNAVAILABLE", "The macOS runtime could not be observed.", true);
    }
  }
}
