import path from "node:path";
import { ContractError } from "../contracts/manager.mjs";
import { ManagerService } from "./manager-service.mjs";
import { serve } from "./ndjson.mjs";
import { MediaResources } from "./media-resources.mjs";
import { dataRoot, readAdapter, initialize } from "../platforms/factory.mjs";
import { PlatformApply } from "../platforms/apply.mjs";
import { mediaInspector, mediaMetadataInspector } from "../platforms/media-metadata.mjs";
import { PlatformLibrary } from "../platforms/library.mjs";
import { SourceSnapshots } from "./source-snapshots.mjs";
import { NativeFiles } from "./native-files.mjs";
import { sourceConverter } from "../platforms/source-conversion.mjs";
import { PackageSources } from "./package-sources.mjs";
import { packageValidation } from "../platforms/package-validation.mjs";
import { PlatformRuntime } from "../platforms/runtime.mjs";
import { FixedCommunityHTTP } from "../platforms/community-http.mjs";
import { CommunityApply } from "../platforms/community-apply.mjs";
import { PlatformUpdates } from "../platforms/updates.mjs";
import { PlatformMaintenance } from "../platforms/maintenance.mjs";
import { WindowsClaudeRuntime } from "../platforms/windows/claude-runtime.mjs";
import { defaultRuntimeTheme } from "./runtime-targets.mjs";

try {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key || !["--application-root", "--resource-directory", "--media-origin", "--mode"].includes(key) || !value || options.has(key)) {
      throw new ContractError("INVALID_REQUEST", "Invalid manager startup arguments.");
    }
    options.set(key, value);
  }
  if (options.has("--resource-directory") !== options.has("--media-origin")) throw new ContractError("INVALID_REQUEST", "Native media options must be paired.");
  if (options.has("--mode") && !["read", "manager"].includes(options.get("--mode")!)) throw new ContractError("INVALID_REQUEST", "Invalid manager mode.");
  const root = path.resolve(options.get("--application-root") ?? process.cwd());
  const platform = readAdapter(root), state = dataRoot();
  const directory = options.get("--resource-directory"), origin = options.get("--media-origin");
  const resources = directory && origin ? new MediaResources(directory, origin, async message => {
    await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(message) + "\n", "utf8", error => error ? reject(error) : resolve()));
  }, mediaInspector(root, platform.name), platform.name === "windows" ? path.join(root, "windows", "assets", "video-posters") : undefined) : undefined;
  const manager = options.get("--mode") === "manager" && process.env.DREAMSKIN_PREVIEW !== "1";
  if (manager) await initialize(root);
  const packages = packageValidation(root, platform.name, () => platform.applicationVersion());
  const service = new ManagerService(platform, resources, manager ? new PlatformApply(root, state) : undefined, state,
    manager ? new PlatformLibrary(root, state) : undefined,
    manager && directory ? new SourceSnapshots(state, platform.name, mediaInspector(root, platform.name), sourceConverter(platform.name)) : undefined,
    manager && directory ? new NativeFiles(directory) : undefined,
    manager && directory ? new PackageSources(state, packages) : undefined, manager && directory ? packages : undefined, manager ? new PlatformRuntime(root, state) : undefined,
    manager && directory ? new FixedCommunityHTTP() : undefined, manager && directory ? new CommunityApply(root, state) : undefined,
    manager && directory ? new PlatformUpdates(root, state) : undefined,
    manager && directory && platform.name === "macos" ? new PlatformMaintenance(root, state) : undefined,
    manager && platform.name === "windows" ? new WindowsClaudeRuntime(root) : undefined,
    () => defaultRuntimeTheme(root), mediaMetadataInspector(root, platform.name));
  // Stop input first; serve finishes its current request before close drains jobs.
  const shutdown = () => { service.stopAccepting(); process.stdin.destroy(); };
  process.stdout.on("error", shutdown);
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try { await serve(process.stdin, process.stdout, service); }
  finally { await service.close(); await resources?.close(); process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
} catch (error) {
  process.stderr.write(error instanceof ContractError ? `${error.code}: ${error.message}\n` : "BACKEND_UNAVAILABLE: The manager connection closed unexpectedly.\n");
  process.exitCode = 1;
}
