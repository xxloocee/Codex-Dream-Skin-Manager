import { execFile } from "node:child_process";
import path from "node:path";
import { ContractError } from "../../contracts/manager.mjs";
import { powerShellArgs } from "./powershell.mjs";

export type DshApplication = { pid: number; executable: string; startTime: string; listeners: { address: string; port: number }[] };
export type DshInventory = { installations: string[]; applications: DshApplication[] };

export async function dshProcess(root: string, action: "inventory" | "prepare", expected?: { executable: string; pid: number; startTime: string }, timeoutMs = 15000): Promise<DshInventory> {
  const deadline = Date.now() + timeoutMs;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new ContractError("RUNTIME_UNAVAILABLE", "Windows system directory is unavailable.");
  const args = ["-Action", action];
  if (expected) args.push("-ExpectedExecutable", expected.executable, "-ExpectedProcessId", String(expected.pid), "-ExpectedStartTime", expected.startTime);
  const command = await powerShellArgs(root, path.join(root, "windows", "scripts", "dsh-runtime.ps1"), args);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ContractError("TIMEOUT", "DSH preparation timed out; no further launch was attempted.", true);
  const output = await new Promise<string>((resolve, reject) => {
    execFile(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), command,
      { encoding: "utf8", windowsHide: true, timeout: remaining, maxBuffer: 262144 }, (error, stdout, stderr) => {
        if (error) reject(new ContractError(error.killed ? "TIMEOUT" : "RUNTIME_UNAVAILABLE", stderr.trim() || "DSH process preparation did not complete.", true));
        else resolve(stdout);
      });
  });
  let result: DshInventory;
  try { result = JSON.parse(output.trim()) as DshInventory; }
  catch { throw new ContractError("RUNTIME_UNAVAILABLE", "DSH process inventory is invalid."); }
  if (!result || !Array.isArray(result.installations) || !Array.isArray(result.applications) ||
      result.installations.some(value => typeof value !== "string" || !path.win32.isAbsolute(value)) ||
      result.applications.some(value => !value || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.executable !== "string" ||
        !path.win32.isAbsolute(value.executable) || typeof value.startTime !== "string" || !/^\d+$/.test(value.startTime) || !Array.isArray(value.listeners))) {
    throw new ContractError("RUNTIME_UNAVAILABLE", "DSH process inventory is invalid.");
  }
  return result;
}
