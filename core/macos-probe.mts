import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { record } from "../contracts/manager.mjs";

// Observation and the native transaction script must describe the same identity.
export function macosProbe(port: number, executable: string, processes: string, browserText: string, paused: boolean, watcherVerified: boolean) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !executable) throw new Error("Invalid macOS runtime identity.");
  let browser: string | null = null;
  if (browserText) {
    const value: unknown = JSON.parse(browserText);
    if (!record(value) || typeof value.webSocketDebuggerUrl !== "string") throw new Error();
    const url = new URL(value.webSocketDebuggerUrl);
    if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || Number(url.port) !== port ||
        url.username || url.password || url.search || url.hash || !/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error();
    browser = url.pathname;
  }
  const runtime = { executable, processes, browser, port };
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  // Keep the string in the fingerprint for compatibility with native probes.
  return { fingerprint: digest({ runtime, paused: String(paused) }), runtimeSessionId: browser ? digest(runtime) : null,
    startRequired: !browser, recoveryRequired: false, watcherVerified, processRunning: processes.trim().length > 0, paused, port };
}

// Arguments are produced only by the fixed native platform script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [portText, executable, processes, browserText, paused, watcherVerified] = process.argv.slice(2);
    if (!executable || processes === undefined || browserText === undefined || !["true", "false"].includes(paused ?? "")) throw new Error();
    process.stdout.write(JSON.stringify(macosProbe(Number(portText), executable, processes, browserText, paused === "true", watcherVerified === "true")) + "\n");
  } catch { process.stderr.write("BACKEND_UNAVAILABLE: The macOS runtime identity could not be inspected.\n"); process.exitCode = 1; }
}
