import { spawn } from "node:child_process";
import { ContractError } from "../contracts/manager.mjs";
import { jsonObject } from "../core/local-files.mjs";

export function transactionProcess(executable: string, args: readonly string[], timeout: number, mutating: boolean, environment?: Record<string, string>, onProgress?: (value: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...environment } });
    const chunks: Buffer[] = []; let size = 0, settled = false, invalid = false;
    const fail = (error: ContractError) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => {
      // A timed-out mutation may still be committing. Keep draining and let the
      // platform transaction finish; never kill it or retry it transparently.
      if (!mutating) child.kill();
      fail(new ContractError("TIMEOUT", "The platform transaction did not report a final result; inspect state before retrying."));
    }, timeout);
    child.stdout.on("data", (bytes: Buffer) => {
      size += bytes.length;
      if (size > 1024 * 1024) { invalid = true; chunks.length = 0; if (!mutating) child.kill(); }
      else if (!invalid && !settled) chunks.push(bytes);
    });
    let progressBuffer = "";
    child.stderr.on("data", (bytes: Buffer) => {
      if (!onProgress || settled) return; // Drain without relaying arbitrary paths/diagnostics.
      progressBuffer += bytes.toString("utf8");
      let newline: number;
      while ((newline = progressBuffer.indexOf("\n")) >= 0) {
        const line = progressBuffer.slice(0, newline); progressBuffer = progressBuffer.slice(newline + 1);
        if (line.length > 8192) continue;
        try { onProgress(jsonObject(Buffer.from(line))); } catch { /* Non-protocol stderr is private. */ }
      }
      if (progressBuffer.length > 8192) progressBuffer = "";
    });
    child.on("error", () => fail(new ContractError("BACKEND_UNAVAILABLE", "The platform transaction could not start.")));
    child.on("close", code => {
      if (settled) return;
      if (invalid || code !== 0) { fail(new ContractError("RUNTIME_UNAVAILABLE", "The platform transaction did not complete; inspect current state.")); return; }
      clearTimeout(timer); settled = true;
      try { resolve(jsonObject(Buffer.concat(chunks))); }
      catch { reject(new ContractError("BACKEND_UNAVAILABLE", "The platform transaction returned an invalid result.")); }
    });
  });
}
