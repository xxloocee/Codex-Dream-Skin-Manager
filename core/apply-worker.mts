// Fixed native-script helper. This is not a public bridge command or shell API.
import path from "node:path";
import { finishPublication } from "../platforms/publication-history.mjs";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { ContractError, parseApplyRefresh, parseThemeRef, record } from "../contracts/manager.mjs";
import { fileBytes, jsonObject, optionalBytes, safePath } from "./local-files.mjs";
import { privateDirectory } from "./write-files.mjs";
import { readThemeContent, themeDetails } from "./theme-model.mjs";
import { dataRoot, readAdapter } from "../platforms/factory.mjs";
import { activeTheme } from "./active-theme.mjs";
import { defaultRuntimeTheme } from "./runtime-targets.mjs";
import { runtimeEngine } from "./runtime-engine.mjs";

try {
  const [action, applicationRoot, requestFile, verifyFile] = process.argv.slice(2);
  if (action === "inspect") {
    if (!applicationRoot || !path.isAbsolute(applicationRoot) || !requestFile || verifyFile) throw new ContractError("INVALID_REQUEST", "Invalid active inspection.");
    const result = jsonObject(Buffer.from(requestFile.startsWith("base64:") ? requestFile.slice(7) : requestFile, requestFile.startsWith("base64:") ? "base64" : "utf8"));
    const platform = process.platform === "win32" ? "windows" : "macos", state = dataRoot();
    const local = await activeTheme(state, platform);
    if (!local) throw new ContractError("THEME_NOT_FOUND", "No active payload is available.");
    const details = await themeDetails(local);
    const injectorFile = path.join(applicationRoot, platform, "scripts", "injector.mjs");
    await safePath(injectorFile, applicationRoot);
    const injector = await import(pathToFileURL(injectorFile).href);
    const actual = platform === "windows" ? await injector.loadPayload(local.mediaRoot, null) : await injector.loadPayload(local.mediaRoot);
    const latest = await activeTheme(state, platform);
    if (typeof actual.revision !== "string" || actual.theme.id !== local.ref.id || !Array.isArray(result.targets) || !result.targets.length ||
        result.targets.some(target => !record(target) || !record(target.result) || target.result.pass !== true ||
          target.result.themeId !== local.ref.id || target.result.expectedRevision !== actual.revision || target.result.revision !== actual.revision) ||
        !latest || (await themeDetails(latest)).revision !== details.revision) {
      throw new ContractError("RENDERER_UNVERIFIED", "The renderer did not verify the current active payload.");
    }
    process.stdout.write(JSON.stringify({ committedRevision: details.revision, verifiedRendererRevision: actual.revision }) + "\n");
  } else {
  if (!["prepare", "verify", "settle", "check-refresh"].includes(action ?? "") || !applicationRoot || !requestFile ||
      !path.isAbsolute(applicationRoot) || !path.isAbsolute(requestFile) ||
      (action === "prepare" ? verifyFile !== undefined : !verifyFile)) throw new ContractError("INVALID_REQUEST", "Invalid worker arguments.");
  const operationsRoot = path.join(dataRoot(), "manager-operations");
  const requestsRoot = path.join(operationsRoot, "requests"), id = path.basename(requestFile, ".json");
  if (!/^[a-f0-9-]{36}$/.test(id) || path.resolve(requestFile) !== path.join(requestsRoot, id + ".json")) throw new ContractError("INVALID_REQUEST", "Invalid internal request.");
  const request = jsonObject(await fileBytes(requestFile, requestsRoot, 16 * 1024));
  const ref = parseThemeRef(request.theme), revision = request.expectedRevision;
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new ContractError("INVALID_REQUEST", "Invalid requested revision.");
  const refresh = request.refresh === undefined ? null : parseApplyRefresh(request.refresh);
  const directory = path.join(operationsRoot, "snapshots", id);
  if (action === "check-refresh") {
    if (refresh) {
      const probe = jsonObject(Buffer.from(verifyFile!.startsWith("base64:") ? verifyFile!.slice(7) : verifyFile!, verifyFile!.startsWith("base64:") ? "base64" : "utf8"));
      const current = await activeTheme(dataRoot(), process.platform === "win32" ? "windows" : "macos");
      if (request.runtimeCommand || probe.startRequired !== false || probe.recoveryRequired !== false || probe.paused !== false || probe.runtimeSessionId !== refresh.runtimeSessionId ||
          !current || current.ref.id !== ref.id || current.ref.source !== ref.source || (await themeDetails(current)).revision !== refresh.activeRevision) {
        throw new ContractError("RUNTIME_CHANGED", "The active skin changed; hot refresh cannot start or restart Codex.");
      }
      if (refresh.opacityOnly) {
        const platform = process.platform === "win32" ? "windows" : "macos", state = dataRoot();
        const engine = await runtimeEngine(applicationRoot, state, platform, await optionalBytes(path.join(state, "state.json"), state), probe.watcherVerified === true);
        if (!engine.engineRevision || engine.runningEngineRevision !== engine.engineRevision) throw new ContractError("RUNTIME_UNAVAILABLE", "The current watcher cannot guarantee an in-place video update.");
      }
    }
    process.stdout.write("{}\n");
  } else if (action === "settle") {
    await finishPublication(dataRoot(), requestFile, jsonObject(Buffer.from(verifyFile!.startsWith("base64:") ? verifyFile!.slice(7) : verifyFile!, verifyFile!.startsWith("base64:") ? "base64" : "utf8")));
    process.stdout.write("{}\n");
  } else if (action === "prepare") {
    const local = request.source === "default" && record(request.runtimeCommand) && request.runtimeCommand.method === "skin.reset" ? await defaultRuntimeTheme(applicationRoot) :
      request.source === "active" && record(request.runtimeCommand) && ["skin.resume", "runtime.repair", "runtime.upgrade"].includes(String(request.runtimeCommand.method)) ? await activeTheme(dataRoot(), process.platform === "win32" ? "windows" : "macos") :
      (await readAdapter(applicationRoot).inventory()).themes.find(value => value.ref.id === ref.id && value.ref.source === ref.source);
    if (local && (local.ref.id !== ref.id || local.ref.source !== ref.source)) throw new ContractError("THEME_CHANGED", "The active theme identity changed before resuming.");
    if (!local) throw new ContractError("THEME_NOT_FOUND", "The selected theme is no longer available.");
    const { details, media, css } = await readThemeContent(local);
    if (details.revision !== revision) throw new ContractError("THEME_CHANGED", "The selected theme changed before publication.");
    await privateDirectory(path.dirname(directory));
    // A request has exactly one prepare attempt; never overwrite another snapshot.
    await mkdir(directory, { mode: 0o700 });
    await safePath(directory, operationsRoot);
    const name = "background" + path.extname(local.mediaPath).toLowerCase();
    await writeFile(path.join(directory, name), media, { flag: "wx", mode: 0o600 });
    if (css) await writeFile(path.join(directory, "theme.css"), css, { flag: "wx", mode: 0o600 });
    const config: Record<string, unknown> = { ...local.config, image: name };
    await writeFile(path.join(directory, "theme.json"), JSON.stringify(config) + "\n", { flag: "wx", mode: 0o600 });
    if (refresh?.opacityOnly) {
      const active = await activeTheme(dataRoot(), process.platform === "win32" ? "windows" : "macos");
      if (!active || active.ref.id !== ref.id || active.ref.source !== ref.source || (await themeDetails(active)).revision !== refresh.activeRevision) throw new ContractError("RUNTIME_CHANGED", "The active video changed before its opacity update.");
      const platform = process.platform === "win32" ? "windows" : "macos";
      const injector = await import(pathToFileURL(path.join(applicationRoot, platform, "scripts", "injector.mjs")).href);
      // Same-media validation must not race chmod/rename in the shared cache.
      const cache = path.join(directory, ".payload-cache");
      const load = (source: string) => platform === "windows" ? injector.loadPayload(source, null, cache) : injector.loadPayload(source, cache);
      const candidate = await load(directory);
      const current = await load(active.mediaRoot);
      if (!candidate.theme.artMetadata?.video || !current.theme.artMetadata?.video || !candidate.theme.opacityUpdateKey || candidate.theme.opacityUpdateKey !== current.theme.opacityUpdateKey) throw new ContractError("THEME_CHANGED", "Opacity-only refresh cannot replace the video or other theme settings.");
    }
    process.stdout.write(JSON.stringify({ directory, expectedRevision: revision, appearance: config.appearance ?? "auto", video: name.endsWith(".mp4") }) + "\n");
  } else {
    if (path.dirname(path.resolve(verifyFile!)) !== requestsRoot || !path.basename(verifyFile!).startsWith(id + ".") ||
        !/^[a-f0-9-]{36}(?:\.json)?\.verify\.[A-Za-z0-9-]{6,36}$/.test(path.basename(verifyFile!))) {
      throw new ContractError("INVALID_REQUEST", "Invalid verification result location.");
    }
    const result = jsonObject(await fileBytes(verifyFile!, requestsRoot));
    const skill = process.platform === "win32" ? "windows" : "macos";
    const injectorFile = path.join(applicationRoot, skill, "scripts", "injector.mjs");
    await safePath(injectorFile, applicationRoot);
    // Reuse the existing authoritative renderer payload loader. No new package validator.
    const injector = await import(pathToFileURL(injectorFile).href);
    const cache = path.join(directory, ".payload-cache");
    const load = (source: string) => process.platform === "win32" ? injector.loadPayload(source, null, cache) : injector.loadPayload(source, cache);
    await safePath(directory, operationsRoot);
    const expected = await load(directory);
    const activeDirectory = path.join(dataRoot(), process.platform === "win32" ? "active-theme" : "theme");
    await safePath(activeDirectory, dataRoot());
    const actual = await load(activeDirectory);
    const expectedCss = await optionalBytes(path.join(directory, "theme.css"), directory, 256 * 1024);
    const actualCss = await optionalBytes(path.join(activeDirectory, "theme.css"), activeDirectory, 256 * 1024);
    const sameCss = (expectedCss === null) === (actualCss === null) &&
      (expectedCss === null || (actualCss !== null && Buffer.from(expectedCss).equals(actualCss)));
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : record(value) ?
      Object.fromEntries(Object.keys(value).filter(key => key !== "image").sort().map(key => [key, canonical(value[key])])) : value;
    const targets = result.targets;
    if (!sameCss || JSON.stringify(canonical(expected.theme)) !== JSON.stringify(canonical(actual.theme)) ||
        expected.theme.id !== ref.id || actual.theme.id !== ref.id || typeof actual.revision !== "string" ||
        !Array.isArray(targets) || targets.length === 0 || targets.some(target => !record(target) || !record(target.result) ||
          target.result.pass !== true || target.result.themeId !== ref.id || target.result.expectedRevision !== actual.revision || target.result.revision !== actual.revision)) {
      throw new ContractError("RENDERER_UNVERIFIED", "The renderer did not verify the exact selected publication snapshot.");
    }
    process.stdout.write(JSON.stringify({ committedRevision: revision, verifiedRendererRevision: actual.revision }) + "\n");
  }
  }
} catch (error) {
  const code = error instanceof ContractError ? error.code : "IO_ERROR";
  process.stderr.write(`${code}: The manager transaction helper could not complete.\n`); process.exitCode = 1;
}
