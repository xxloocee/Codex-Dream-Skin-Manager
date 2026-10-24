export { assessRendererVerification } from "./renderer-verification.mjs";
import { createRendererVerifier, assessRendererVerification } from "./renderer-verification.mjs";
import { createThemePayload } from "./theme-payload.mjs";
import { operationUiExpression as sharedOperationUiExpression, bindMediaFileToSession, applyLoadedToSession, removeFromSession, verifyRemovedSession, cleanupExcludedSurface } from "./renderer-session.mjs";
export { bindMediaFileToSession, applyLoadedToSession, cleanupExcludedSurface };
import { MEDIA_CACHE_ROOT, materializeMediaSnapshot } from "./media-cache.mjs";
export { materializeMediaSnapshot };
import { createCdpTransport } from "./cdp-transport.mjs";
import { createInjectionEngine, discoverCodexTargets } from "./injection-engine.mjs";
import {
  WatcherLifecycle, DiscoveryRetry, DISCOVERY_BACKOFF, nextDiscoveryDelayMs, discoveryLogIntervalMs,
} from "./watcher-engine.mjs";
export { DISCOVERY_BACKOFF, nextDiscoveryDelayMs, discoveryLogIntervalMs };
import { probeVideoDecode } from "./video-decode-probe.mjs";
import fs from "node:fs/promises";
import { watch as watchFs } from "node:fs";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";


const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const root = path.resolve(here, "..");
const SELECTOR_CONTRACT = JSON.parse(await fs.readFile(
  path.join(root, "assets", "selectors.json"), "utf8",
));
if (SELECTOR_CONTRACT.schema !== "codex-dream-skin-selectors/1" ||
  !Array.isArray(SELECTOR_CONTRACT.selectors)) {
  throw new Error("assets/selectors.json has an unsupported schema");
}
const SELECTOR_MAP = new Map();
for (const entry of SELECTOR_CONTRACT.selectors) {
  if (!entry?.key || !entry.selector || SELECTOR_MAP.has(entry.key)) {
    throw new Error(`assets/selectors.json has an invalid selector key: ${entry?.key || "<missing>"}`);
  }
  SELECTOR_MAP.set(entry.key, entry.selector);
}
const selectorFor = (key) => {
  const selector = SELECTOR_MAP.get(key);
  if (!selector) throw new Error(`Selector contract is missing ${key}`);
  return selector;
};
const selectorLiteral = (key) => JSON.stringify(selectorFor(key));
const stableTestidLiteral = (testid) => {
  if (!SELECTOR_CONTRACT.stableTestids?.includes(testid)) {
    throw new Error(`Selector contract is missing stable testid ${testid}`);
  }
  return JSON.stringify(`[data-testid="${testid}"]`);
};
const operationUiExpression = (action, token, state, message) => sharedOperationUiExpression(action, token, state, message, selectorLiteral);
const SKIN_VERSION = "3.1.0";
// .github/workflows/ci.yml's version-consistency check greps this file for a
// literal `const SKIN_VERSION = "...";` line, so the export stays a separate
// statement rather than an inline `export const`.
export { SKIN_VERSION };
const OPERATION_KINDS = new Set(["apply", "pause", "switch"]);
const OPERATION_UI_STATES = new Set(["success", "error", "cancelled"]);
const MIN_RENDERER_WIDTH = 320;
const MIN_RENDERER_HEIGHT = 240;
const MAX_RENDERER_DIMENSION = 65536;

let operationSequence = 0;

function hasReasonableDimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= MIN_RENDERER_WIDTH && height >= MIN_RENDERER_HEIGHT
    && width <= MAX_RENDERER_DIMENSION && height <= MAX_RENDERER_DIMENSION;
}

export function classifyNativeWindowResponse(response) {
  const windowId = Number(response?.windowId);
  const bounds = response?.bounds && typeof response.bounds === "object"
    ? {
        width: Number(response.bounds.width),
        height: Number(response.bounds.height),
        windowState: typeof response.bounds.windowState === "string"
          ? response.bounds.windowState : null,
      }
    : null;
  const stateReady = bounds
    && ["normal", "maximized", "fullscreen"].includes(bounds.windowState);
  const ready = Number.isSafeInteger(windowId) && windowId > 0 && stateReady
    && hasReasonableDimensions(bounds.width, bounds.height);
  return {
    status: ready ? "ready" : "not-ready",
    windowId: Number.isSafeInteger(windowId) && windowId > 0 ? windowId : null,
    bounds,
    reason: ready ? null : "native-window-not-visible",
  };
}

export function classifyNativeWindowError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cdpCode = Number(error?.cdpCode);
  const withoutCode = message.replace(/\s*\(-?\d+\)\s*$/, "").trim();
  const domainUnsupported = cdpCode === -32601
    || /\(-32601\)\s*$/.test(message)
    || /^method(?: ['"]Browser\.getWindowForTarget['"])? not found$/i.test(withoutCode)
    || /^['"]?Browser\.getWindowForTarget['"]? (?:wasn't|was not) found$/i.test(withoutCode);
  // Codex 26.721.x (Chrome/150) returns "Browser window not found" (-32000)
  // for the app's real, focused, on-screen window -- verified live via CDP:
  // the error stays identical before and after actually activating the
  // window, while documentVisibility correctly flips hidden -> visible. The
  // domain is implemented but this build never resolves a window for our
  // target, so -32000 is exactly as uninformative here as -32601 elsewhere;
  // treat it the same way and lean on documentVisible (still required by
  // windowPass) as the real visibility signal. See #256.
  const windowNotFound = cdpCode === -32000
    || /\(-32000\)\s*$/.test(message)
    || /^browser window not found$/i.test(withoutCode);
  const unsupported = domainUnsupported || windowNotFound;
  return {
    status: unsupported ? "unsupported" : "not-ready",
    windowId: null,
    bounds: null,
    reason: domainUnsupported ? "browser-window-domain-unsupported"
      : windowNotFound ? "browser-window-not-found"
      : "native-window-unavailable",
  };
}


function parseArgs(argv) {
  const options = {
    port: 9341,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    opacityOnly: false,
    themeDir: null,
    operationState: null,
    operationAck: null,
    operationKind: null,
    operationUiState: null,
    operationMessage: null,
    operationToken: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--verify-removed") options.mode = "verify-removed";
    else if (arg === "--begin-operation") options.mode = "begin-operation";
    else if (arg === "--finish-operation") options.mode = "finish-operation";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--operation-state") options.operationState = path.resolve(argv[++i]);
    else if (arg === "--operation-ack") options.operationAck = path.resolve(argv[++i]);
    else if (arg === "--operation-kind") options.operationKind = argv[++i];
    else if (arg === "--operation-ui-state") options.operationUiState = argv[++i];
    else if (arg === "--operation-message") options.operationMessage = argv[++i];
    else if (arg === "--operation-token") options.operationToken = argv[++i];
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--opacity-only") options.opacityOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.operationToken !== null && !/^\d{1,12}:\d{13}:\d{1,8}$/.test(options.operationToken)) {
    throw new Error("Invalid operation token");
  }
  if (options.mode === "begin-operation" && !OPERATION_KINDS.has(options.operationKind)) {
    throw new Error("Begin operation requires --operation-kind apply, pause, or switch");
  }
  if (options.mode === "verify-removed" && (options.reload || options.screenshot)) throw new Error("Read-only removal inspection cannot reload or capture the renderer");
  if (options.opacityOnly && (options.mode !== "once" || options.reload)) {
    throw new Error("--opacity-only requires --once and cannot reload the renderer");
  }
  if (options.mode === "finish-operation") {
    if (!OPERATION_UI_STATES.has(options.operationUiState)) {
      throw new Error("Finish operation requires --operation-ui-state success, error, or cancelled");
    }
    if (!options.operationToken) throw new Error("Finish operation requires --operation-token");
    if (typeof options.operationMessage !== "string" || options.operationMessage.length > 240
      || /[\n]/.test(options.operationMessage)) {
      throw new Error("Finish operation requires a single-line --operation-message up to 240 characters");
    }
  }
  return options;
}

const { listAppTargets, connectTarget } = createCdpTransport({
  onListenerError: (error) => console.error('[dream-skin] CDP listener failed: ' + error.message),
});
const {
  probeSession, waitForCodexProbe, earlyPayloadFor: sharedEarlyPayloadFor,
} = createInjectionEngine({ selectorLiteral, stableTestidLiteral });

export async function connectCodexTargets(port, timeoutMs) {
  return discoverCodexTargets({
    port, timeoutMs, listTargets: () => listAppTargets(port),
    connectTarget, probeSession, cleanupExcludedSurface, productName: "ChatGPT",
  });
}
const sharedPayload = createThemePayload(root, SKIN_VERSION);
export const loadTheme = sharedPayload.loadTheme;
export const assertPayloadIntegrity = sharedPayload.assertPayloadIntegrity;
const invalidateStaticPayloadAssets = sharedPayload.invalidateStaticPayloadAssets;
export const loadPayload = (themeDir, mediaCacheRoot = MEDIA_CACHE_ROOT) => sharedPayload.loadPayload(themeDir, null, mediaCacheRoot);

export async function probeVideoInCodex(snapshotPath, state) {
  let targets;
  let anchor = null;
  try {
    await execFileAsync("/bin/bash", ["-c",
      '. "$1"; discover_codex_app; require_macos_runtime quick; verified_cdp_endpoint "$2"',
      "dream-skin-video-check", path.join(root, "scripts", "common-macos.sh"), String(state.port),
    ], { timeout: 15000, maxBuffer: 65536 });
    targets = await listAppTargets(state.port);
  } catch {
    anchor?.close();
    throw new Error("无法验证视频解码能力：请先启动 Codex 并连接皮肤运行时，再重试导入或应用。");
  }
  try {
    for (const target of targets) {
      let session;
      try {
        session = await connectTarget(target, state.port);
        const probe = await probeSession(session);
        if (!probe?.codex || probe.excludedPetSurface) continue;
        await execFileAsync("/bin/bash", ["-c",
          '. "$1"; discover_codex_app; verified_cdp_endpoint "$2"',
          "dream-skin-video-check", path.join(root, "scripts", "common-macos.sh"), String(state.port),
        ], { timeout: 5000, maxBuffer: 65536 });
        const result = await probeVideoDecode(session, snapshotPath);
        if (anchor?.closed) throw new Error("Codex 连接已变化，请重试视频校验。");
        return result;
      } finally { session?.close(); }
    }
    throw new Error("未找到可校验的 Codex 主窗口，请打开 Codex 主界面后重试。");
  } finally { anchor?.close(); }
}


function nextOperationToken() {
  operationSequence += 1;
  return `${process.pid}:${Date.now()}:${operationSequence}`;
}


async function updateOperationUi(session, action, token, state, message, timeoutMs = 10000) {
  if (session.closed) return false;
  const result = await session.evaluate(
    operationUiExpression(action, token, state, message),
    timeoutMs,
  );
  return Boolean(result?.visible || result?.cleared || result?.removed);
}

async function bestEffortOperationUi(session, action, token, state, message, timeoutMs = 10000) {
  try {
    return await updateOperationUi(session, action, token, state, message, timeoutMs);
  } catch (error) {
    console.error(`[dream-skin] client status unavailable: ${error.message}`);
    return false;
  }
}

async function presentOperationUi(session, token, state, message, timeoutMs = 10000) {
  const updated = await bestEffortOperationUi(
    session, "update", token, state, message, timeoutMs,
  );
  if (updated) return true;
  return bestEffortOperationUi(session, "show", token, state, message, timeoutMs);
}


export async function inspectNativeWindow(session) {
  try {
    const response = await session.send(
      "Browser.getWindowForTarget",
      { targetId: session.target.id },
      1500,
    );
    return classifyNativeWindowResponse(response);
  } catch (error) {
    return classifyNativeWindowError(error);
  }
}

const verifyRenderer = createRendererVerifier(selectorLiteral, stableTestidLiteral, SKIN_VERSION);
export async function verifySession(session, expectedThemeId = null, expectedRevision = null) {
  return verifyRenderer(session, await inspectNativeWindow(session), expectedThemeId, expectedRevision);
}

export async function waitForVerifiedSession(
  session,
  timeoutMs,
  expectedThemeId = null,
  expectedRevision = null,
  retryDelayMs = 500,
) {
  const deadline = Date.now() + timeoutMs;
  const retryDelay = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 500;
  let lastResult;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastResult = await verifySession(session, expectedThemeId, expectedRevision);
      lastError = null;
      if (lastResult.pass) return lastResult;
    } catch (error) {
      // Renderer navigations can invalidate Runtime.evaluate while Codex is
      // swapping documents. Treat that as a transient sample until the same
      // bounded verification deadline expires, matching the Windows injector.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  if (!lastResult && lastError) throw lastError;
  return lastResult;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

function operationKindMessage(kind) {
  if (kind === "pause") return "正在暂停皮肤…";
  if (kind === "switch") return "正在切换主题…";
  return "正在应用皮肤…";
}

async function runBeginOperation(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  const operationToken = options.operationToken ?? nextOperationToken();
  let shown = false;
  try {
    const results = await Promise.all(connected.map(({ session }) => presentOperationUi(
      session,
      operationToken,
      "loading",
      operationKindMessage(options.operationKind),
      Math.max(250, Math.floor(options.timeoutMs / 2)),
    )));
    shown = results.some(Boolean);
  } finally {
    for (const { session } of connected) session.close();
  }
  if (!shown) throw new Error("Could not show operation progress in the verified ChatGPT renderer");
  process.stdout.write(`${operationToken}\n`);
}

async function runFinishOperation(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  let shown = false;
  try {
    const results = await Promise.all(connected.map(({ session }) => presentOperationUi(
      session,
      options.operationToken,
      options.operationUiState,
      options.operationMessage,
      Math.max(250, Math.floor(options.timeoutMs / 2)),
    )));
    shown = results.some(Boolean);
  } finally {
    for (const { session } of connected) session.close();
  }
  if (!shown) throw new Error("Could not show the completed operation state in the verified ChatGPT renderer");
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  const operationToken = options.mode === "once" || options.mode === "remove"
    ? options.operationToken ?? nextOperationToken()
    : null;
  if (operationToken) {
    const message = options.mode === "remove" ? "正在暂停皮肤…" : "正在准备皮肤…";
    const action = options.operationToken ? presentOperationUi : (session, token, state, text) =>
      bestEffortOperationUi(session, "show", token, state, text);
    await Promise.all(connected.map(({ session }) => action(
      session, operationToken, "loading", message,
    )));
  }
  let loaded = null;
  try {
    loaded = (options.mode === "once" || options.mode === "verify" || options.reload)
      ? await loadPayload(options.themeDir)
      : null;
  } catch (error) {
    if (operationToken) {
      await Promise.all(connected.map(({ session }) => presentOperationUi(
        session, operationToken, "error", "皮肤准备失败",
      )));
    }
    for (const { session } of connected) session.close();
    throw error;
  }
  const results = [];
  let screenshotCaptured = false;

  for (const { target, session, probe } of connected) {
    let opacity = null;
    try {
      if (options.mode === "remove") await removeFromSession(session);
      else if (options.mode === "once") {
        await bestEffortOperationUi(
          session, "update", operationToken, "loading", `正在应用「${loaded.theme.name}」…`,
        );
        opacity = await applyLoadedToSession(session, loaded, { opacityOnly: options.opacityOnly });
      }

      if (options.reload) {
        await session.send("Page.reload", { ignoreCache: true });
        await new Promise((resolve) => setTimeout(resolve, 1600));
        if (options.mode !== "remove") {
          if (operationToken) {
            await presentOperationUi(
              session, operationToken, "loading", `正在应用「${loaded.theme.name}」…`,
            );
          }
          opacity = await applyLoadedToSession(session, loaded);
        }
      }

      if (operationToken) {
        await presentOperationUi(
          session,
          operationToken,
          "loading",
          options.mode === "remove" ? "正在确认皮肤已暂停…" : "正在检查显示效果…",
        );
      }
      const result = (options.mode === "remove" || options.mode === "verify-removed")
        ? await verifyRemovedSession(session)
        : await waitForVerifiedSession(
          session,
          options.timeoutMs,
          loaded?.theme.id ?? null,
          loaded?.revision ?? null,
        );
      results.push({ targetId: target.id, markers: probe?.markers, result, ...(opacity ? { opacity } : {}) });
      if (operationToken) {
        const passed = options.mode === "remove" ? result === true : result?.pass;
        await presentOperationUi(
          session,
          operationToken,
          passed ? "success" : "error",
          passed
            ? options.mode === "remove" ? "皮肤已暂停" : `已应用「${loaded.theme.name}」`
            : options.mode === "remove" ? "暂停校验失败" : "显示校验失败",
        );
      }

      if (options.screenshot && !screenshotCaptured) {
        if (operationToken) {
          await bestEffortOperationUi(session, "hide", operationToken, "loading", "");
        }
        await capture(session, options.screenshot);
        screenshotCaptured = true;
      }
    } catch (error) {
      if (operationToken) {
        await presentOperationUi(
          session,
          operationToken,
          "error",
          options.mode === "remove" ? "暂停失败，请重试" : "应用失败，请重试",
        );
      }
      results.push({
        targetId: target.id,
        markers: probe?.markers,
        ...(opacity ? { opacity } : {}),
        error: error.message,
        result: null,
      });
    } finally {
      session.close();
    }
  }

  console.log(JSON.stringify({ mode: options.mode, version: SKIN_VERSION, port: options.port, targets: results }, null, 2));
  const failed = results.length === 0 || results.some((item) =>
    item.error || (["remove", "verify-removed"].includes(options.mode) ? item.result !== true : !item.result?.pass));
  if (failed) process.exitCode = 2;
}

export function earlyPayloadFor(payload, revision) {
  return sharedEarlyPayloadFor(payload, revision);
}

function watchPayloadSources(themeDir, onDirty) {
  const assetsRoot = path.join(root, "assets");
  const themeRoot = themeDir ?? assetsRoot;
  const watchers = [];
  const add = (directory, kind) => {
    let watcher;
    try {
      watcher = watchFs(directory, { persistent: false }, (_event, filename) => {
        const name = filename ? String(filename) : "";
        const staticChanged = directory === assetsRoot &&
          (!name || name === "dream-skin.css" || name === "renderer-inject.js");
        if (kind === "static" && !staticChanged) return;
        onDirty({ staticChanged });
      });
      watcher.on("error", (error) => {
        console.error(`[dream-skin] file watch unavailable for ${directory}: ${error.message}`);
      });
      watchers.push(watcher);
    } catch (error) {
      console.error(`[dream-skin] file watch unavailable for ${directory}: ${error.message}`);
    }
  };
  add(themeRoot, "theme");
  if (themeRoot !== assetsRoot) add(assetsRoot, "static");
  return () => watchers.forEach((watcher) => watcher.close());
}

async function readOperationState(statePath) {
  const { stdout } = await execFileAsync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", statePath],
    { encoding: "utf8", maxBuffer: 16 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  return {
    token: String(parsed.operationToken || ""),
    status: String(parsed.status || ""),
    message: String(parsed.message || "").slice(0, 240),
    updatedAt: Number(parsed.updatedAt || 0),
  };
}

async function writeModeAck(ackPath, operationToken, mode) {
  if (!ackPath) return;
  if (mode !== "control" && mode !== "full") throw new Error("Invalid injector ACK mode");
  const temporary = `${ackPath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify({
    operationToken,
    mode,
    injectorPid: process.pid,
    acknowledgedAt: new Date().toISOString(),
  }, null, 2)}\n`;
  try {
    await fs.writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, ackPath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function isFreshBusyOperation(operation) {
  if (operation.status !== "applying" && operation.status !== "pausing") return false;
  const ageSeconds = Date.now() / 1000 - operation.updatedAt;
  const maxAgeSeconds = operation.status === "applying" ? 180 : 90;
  return ageSeconds >= -5 && ageSeconds <= maxAgeSeconds;
}

async function watchOperationState(statePath, onState) {
  if (!statePath) return () => {};
  const directory = path.dirname(statePath);
  const basename = path.basename(statePath);
  let watcher = null;
  let readTimer = null;
  let readChain = Promise.resolve();
  let closed = false;
  let lastSnapshotKey = "";

  const readLatest = async () => {
    try {
      const operation = await readOperationState(statePath);
      if (!/^\d{1,12}:\d{13}:\d{1,8}$/.test(operation.token)) return;
      const snapshotKey = `${operation.token}:${operation.status}:${operation.updatedAt}`;
      if (snapshotKey === lastSnapshotKey) return;
      lastSnapshotKey = snapshotKey;
      await onState(operation);
    } catch (error) {
      if (!closed && error?.code !== "ENOENT") {
        console.error(`[dream-skin] operation state unavailable: ${error.message}`);
      }
    }
  };

  const scheduleRead = () => {
    if (closed) return;
    if (readTimer) clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      readTimer = null;
      readChain = readChain.then(readLatest);
      await readChain;
    }, 10);
  };

  try {
    watcher = watchFs(directory, { persistent: false }, (_event, filename) => {
      if (!filename || String(filename) === basename) scheduleRead();
    });
    watcher.on("error", (error) => {
      console.error(`[dream-skin] operation watch unavailable: ${error.message}`);
    });
  } catch (error) {
    console.error(`[dream-skin] operation watch unavailable: ${error.message}`);
  }

  readChain = readChain.then(readLatest);
  await readChain;

  return () => {
    closed = true;
    if (readTimer) clearTimeout(readTimer);
    watcher?.close();
  };
}

async function runWatch(options) {
  let current = await loadPayload(options.themeDir);
  let desiredPayload = current;
  let desiredOpacityOnly = false;
  const lifecycle = new WatcherLifecycle({ sessionFor: (record) => record.session });
  const sessions = lifecycle.sessions;
  const discoveryRetry = new DiscoveryRetry();
  const rejected = new Set();
  let reloadTimer = null;
  let reloadChain = Promise.resolve();
  let operationSignalChain = Promise.resolve();
  let activeOperation = null;
  let pauseRecovery = null;
  let wakeControlWait = null;
  const wakeControlLoop = () => {
    const wake = wakeControlWait;
    wakeControlWait = null;
    wake?.();
  };
  const waitForControlOperation = () => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (wakeControlWait === finish) wakeControlWait = null;
      resolve();
    };
    const timer = setTimeout(finish, 60000);
    wakeControlWait = finish;
  });
  const stop = () => {
    lifecycle.transition("stopping");
    wakeControlLoop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const beginTargetSetup = () => lifecycle.beginTargetSetup();
  const finishTargetSetup = () => lifecycle.finishTargetSetup();
  const waitForTargetSetups = (timeoutMs = 2500) => lifecycle.waitForTargetSetups(timeoutMs);
  const registerEarly = async (session, payload, revision) => {
    const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: earlyPayloadFor(payload, revision),
    });
    return result.identifier ?? null;
  };

  const removeEarlyIdentifier = async (record, identifier, { strict = false } = {}) => {
    if (!identifier) return true;
    if (record.session.closed) {
      if (strict) throw new Error("Renderer session closed before early script removal");
      return false;
    }
    try {
      await record.session.send(
        "Page.removeScriptToEvaluateOnNewDocument",
        { identifier },
        strict ? 1500 : 10000,
      );
      record.earlyScriptIds.delete(identifier);
      if (record.earlyScriptId === identifier) record.earlyScriptId = null;
      return true;
    } catch (error) {
      if (strict) throw error;
      return false;
    }
  };

  const removeEarly = async (record, { strict = false } = {}) => {
    const identifiers = new Set(record.earlyScriptIds);
    if (record.earlyScriptId) identifiers.add(record.earlyScriptId);
    const results = await Promise.all([...identifiers].map((identifier) =>
      removeEarlyIdentifier(record, identifier, { strict })));
    return results.every(Boolean);
  };

  const registerEarlyForRecord = async (record, payload, revision) => {
    const identifier = await registerEarly(record.session, payload, revision);
    if (identifier) record.earlyScriptIds.add(identifier);
    return identifier;
  };

  const invalidateEarly = async (record, { strict = false } = {}) => {
    record.needsLoadFallback = false;
    if (record.session.closed) {
      if (strict) throw new Error("Renderer session closed before pause invalidation");
    } else {
      await record.session.evaluate(`(() => {
        window.__CODEX_DREAM_SKIN_EARLY_GENERATION__ = ${JSON.stringify(`disabled:${process.pid}`)};
        window.__CODEX_DREAM_SKIN_DISABLED__ = true;
        return true;
      })()`, strict ? 1500 : 10000).catch((error) => {
        if (strict) throw error;
      });
    }
    return removeEarly(record, { strict });
  };

  const releaseControlSessions = () => {
    for (const record of sessions.values()) record.session.close();
    sessions.clear();
  };

  const restoreAfterAbortedPause = async (operation) => {
    if (lifecycle.stopping) return;
    lifecycle.transition("full", { invalidate: true });
    pauseRecovery = {
      token: operation.token,
      message: operation.message || "暂停失败，原皮肤已恢复",
    };
    releaseControlSessions();
    wakeControlLoop();
  };

  const refreshPayload = async () => {
    if (lifecycle.stopping) return;
    const refreshEpoch = lifecycle.epoch;
    await waitForTargetSetups(options.timeoutMs);
    if (lifecycle.stopping || lifecycle.epoch !== refreshEpoch) return;
    let next;
    try {
      next = await loadPayload(options.themeDir);
    } catch (error) {
      await Promise.all([...sessions.entries()].filter(([id, record]) =>
        record.ready === true && !record.session.closed && lifecycle.owns(id, record.session)).map(async ([id, record]) => {
        if (record.session.closed || !lifecycle.owns(id, record.session)) return;
        const externalOperation = activeOperation;
        const operationToken = externalOperation?.token ?? nextOperationToken();
        record.operationToken = operationToken;
        record.operationExternal = Boolean(externalOperation);
        await presentOperationUi(
          record.session,
          operationToken,
          externalOperation ? "loading" : "error",
          externalOperation ? "正在准备主题…" : "主题读取失败，当前皮肤未改变",
        );
      }));
      throw error;
    }
    const desiredChanged = next.revision !== desiredPayload.revision;
    if (desiredChanged) {
      desiredOpacityOnly = desiredPayload.theme?.artMetadata?.video === true && next.theme?.artMetadata?.video === true &&
        desiredPayload.theme.id === next.theme.id && typeof desiredPayload.theme.opacityUpdateKey === "string" &&
        /^[a-f0-9]{64}$/.test(desiredPayload.theme.opacityUpdateKey) && desiredPayload.theme.opacityUpdateKey === next.theme.opacityUpdateKey;
    }
    desiredPayload = next;
    if (next.revision === current.revision && !desiredChanged) return;
    if (!lifecycle.canMutate(refreshEpoch)) {
      current = next;
      console.log(`[dream-skin] staged theme ${current.theme.id} while skin is paused`);
      return;
    }
    const opacityOnly = desiredOpacityOnly;
    let failures = 0;
    const acceptedSessions = [...sessions.entries()].filter(([id, record]) =>
      record.ready === true && !record.session.closed && lifecycle.owns(id, record.session));
    for (const [id, record] of acceptedSessions) {
      const { session } = record;
      const stillAccepted = () => record.ready === true && !session.closed && lifecycle.owns(id, session);
      if (!stillAccepted()) continue;
      const externalOperation = activeOperation;
      const operationToken = externalOperation?.token ?? nextOperationToken();
      record.operationToken = operationToken;
      record.operationExternal = Boolean(externalOperation);
      try {
        await presentOperationUi(
          session, operationToken, "loading", `正在应用「${next.theme.name}」…`,
        );
        if (!lifecycle.canMutate(refreshEpoch) || !stillAccepted()) continue;
        if (!opacityOnly) {
          const nextIdentifier = await registerEarlyForRecord(
            record, next.payload, next.revision,
          );
          if (!lifecycle.canMutate(refreshEpoch) || !stillAccepted()) {
            await removeEarlyIdentifier(record, nextIdentifier);
            continue;
          }
          if (record.earlyScriptId) {
            await removeEarlyIdentifier(record, record.earlyScriptId);
          }
          if (!lifecycle.canMutate(refreshEpoch) || !stillAccepted()) {
            await removeEarlyIdentifier(record, nextIdentifier);
            continue;
          }
          record.earlyScriptId = nextIdentifier;
          record.needsLoadFallback = !nextIdentifier;
        }
        await applyLoadedToSession(session, next, { opacityOnly });
        if (!lifecycle.canMutate(refreshEpoch) || !stillAccepted()) continue;
        const verification = await waitForVerifiedSession(
          session,
          Math.min(options.timeoutMs, 8000),
          next.theme.id,
          next.revision,
        );
        if (!lifecycle.canMutate(refreshEpoch) || !stillAccepted()) continue;
        if (!verification?.pass) throw new Error("Theme refresh verification failed");
        if (!externalOperation) {
          await presentOperationUi(session, operationToken, "success", `已应用「${next.theme.name}」`);
        }
      } catch (error) {
        if (!stillAccepted()) continue;
        failures += 1;
        if (!opacityOnly) record.needsLoadFallback = true;
        if (!externalOperation) {
          await presentOperationUi(session, operationToken, "error", "主题切换失败，未确认应用");
        }
        console.error(`[dream-skin] theme refresh failed: ${error.message}`);
      }
    }
    if (failures) throw new Error(`Theme refresh failed for ${failures} renderer(s); the revision remains pending`);
    current = next;
    if (!lifecycle.canMutate(refreshEpoch)) return;
    console.log(`[dream-skin] refreshed theme ${current.theme.id} (${current.timings.buildMs}ms)`);
  };

  const queuePayloadRefresh = ({ staticChanged = false } = {}) => {
    if (lifecycle.stopping) return;
    if (staticChanged) invalidateStaticPayloadAssets();
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      reloadChain = reloadChain.then(refreshPayload).catch((error) => {
        console.error(`[dream-skin] theme reload failed: ${error.message}`);
      });
    }, 45);
  };
  const closePayloadWatchers = watchPayloadSources(options.themeDir, queuePayloadRefresh);
  const closeOperationWatcher = await watchOperationState(options.operationState, (operation) => {
    operationSignalChain = operationSignalChain.then(async () => {
      if (lifecycle.stopping) return;
      const previousOperation = activeOperation?.token === operation.token ? activeOperation : null;
      const busy = isFreshBusyOperation(operation);
      if (pauseRecovery && pauseRecovery.token !== operation.token) pauseRecovery = null;
      if (busy) {
        activeOperation = operation;
        wakeControlLoop();
      }
      else if (activeOperation?.token === operation.token) activeOperation = null;
      const abortedPause = !busy
        && (operation.status === "failed" || operation.status === "cancelled")
        && previousOperation?.status === "pausing";
      const pauseState = (busy && operation.status === "pausing") || operation.status === "paused";
      if (pauseState && !lifecycle.controlOnly) {
        lifecycle.transition("control");
      }
      await Promise.all([...sessions.values()].map(async (record) => {
        if (record.session.closed) return;
        if (busy) {
          const kind = operation.status === "pausing" ? "pause" : "apply";
          record.operationToken = operation.token;
          record.operationExternal = true;
          await presentOperationUi(
            record.session,
            operation.token,
            "loading",
            operationKindMessage(kind),
            1000,
          );
          return;
        }
        if (record.operationToken !== operation.token) return;
        const state = operation.status === "failed" ? "error"
          : operation.status === "cancelled" ? "cancelled"
            : operation.status === "success" || operation.status === "paused" ? "success" : null;
        if (!state) return;
        await presentOperationUi(
          record.session,
          operation.token,
          state,
          operation.message || (state === "error" ? "操作失败，请重试" : "操作已完成"),
        );
      }));
      if (busy && operation.status === "pausing") {
        await reloadChain.catch(() => {});
        await waitForTargetSetups();
        await Promise.all([...sessions.values()].map(async (record) => {
          await invalidateEarly(record, { strict: true });
        }));
        if (lifecycle.stopping) return;
        await writeModeAck(options.operationAck, operation.token, "control");
      } else if (abortedPause) await restoreAfterAbortedPause(operation);
      else if (operation.status === "paused") {
        await reloadChain.catch(() => {});
        await waitForTargetSetups().catch(() => {});
        await Promise.all([...sessions.values()].map((record) =>
          invalidateEarly(record, { strict: true }))).catch((error) => {
          console.error(`[dream-skin] final pause invalidation failed: ${error.message}`);
        });
        releaseControlSessions();
      }
    }).catch((error) => {
      console.error(`[dream-skin] operation progress failed: ${error.message}`);
    });
    return operationSignalChain;
  });

  try {
    while (!lifecycle.stopping) {
      if (activeOperation && !isFreshBusyOperation(activeOperation)) {
        const expiredOperation = activeOperation;
        activeOperation = null;
        await Promise.all([...sessions.values()].map(async (record) => {
          if (record.session.closed || record.operationToken !== expiredOperation.token) return;
          await presentOperationUi(
            record.session,
            expiredOperation.token,
            "error",
            "操作超时，请重试",
            1000,
          );
        }));
        if (expiredOperation.status === "pausing") {
          lifecycle.transition("control");
          releaseControlSessions();
        }
      }
      if (lifecycle.controlOnly && !activeOperation) {
        releaseControlSessions();
        await waitForControlOperation();
        continue;
      }
      let targets = [];
      try {
        targets = await listAppTargets(options.port);
        discoveryRetry.succeed();
      } catch (error) {
        const { retryMs, shouldLog } = discoveryRetry.fail();
        if (shouldLog) {
          console.error('[dream-skin] ' + new Date().toISOString() + ' ' + error.message);
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }
      if (lifecycle.controlOnly && !activeOperation) {
        releaseControlSessions();
        continue;
      }

      for (const [id, record] of lifecycle.staleSessions(targets)) {
        if (!record.session.closed && record.operationToken && !record.operationExternal) {
          await bestEffortOperationUi(
            record.session, "hide", record.operationToken, "loading", "",
          );
        }
        await removeEarly(record);
        record.session.close();
        sessions.delete(id);
      }
      const cycleRecovery = activeOperation ? null : pauseRecovery;
      let recoveredPauseThisCycle = false;
      let recoveryFailedThisCycle = false;
      for (const target of targets) {
        if (lifecycle.stopping) break;
        if (sessions.has(target.id)) continue;
        let session;
        let record;
        let connectionEpoch;
        let recoveryOperation = cycleRecovery;
        // Do not start a target while a queued refresh is waiting for setup to finish.
        while (!lifecycle.stopping) {
          const pendingRefresh = reloadChain;
          await pendingRefresh;
          if (pendingRefresh === reloadChain) break;
        }
        if (lifecycle.stopping) break;
        if (sessions.has(target.id)) continue;
        beginTargetSetup();
        try {
          session = await connectTarget(target, options.port);
          if (lifecycle.stopping) throw new Error("Watcher stopped during renderer setup");
          record = {
            session,
            ready: false,
            earlyScriptId: null,
            earlyScriptIds: new Set(),
            needsLoadFallback: false,
            operationToken: null,
            operationExternal: false,
          };
          connectionEpoch = lifecycle.epoch;
          sessions.set(target.id, record);
          session.on("Page.loadEventFired", () => {
            if (!lifecycle.canMutate() || !lifecycle.owns(target.id, session)) return;
            if (!record.needsLoadFallback && !desiredPayload.mediaFilePath) return;
            const fallbackEpoch = lifecycle.epoch;
            setTimeout(() => {
              if (!lifecycle.canMutate(fallbackEpoch) || !lifecycle.owns(target.id, session)
                || (!record.needsLoadFallback && !desiredPayload.mediaFilePath)) return;
              const payload = desiredPayload;
              const operation = (record.needsLoadFallback || payload.theme?.artMetadata?.video)
                ? applyLoadedToSession(session, payload)
                : bindMediaFileToSession(session, payload);
              operation.catch((error) => {
                console.error(`[dream-skin] fallback reinject failed: ${error.message}`);
              });
            }, 0);
          });
          const initialOperation = activeOperation;
          recoveryOperation = initialOperation ? null : cycleRecovery;
          const pausing = initialOperation?.status === "pausing";
          if (lifecycle.canMutate(connectionEpoch)) {
            const bootstrapPayload = desiredPayload;
            try {
              record.earlyScriptId = await registerEarlyForRecord(
                record, bootstrapPayload.payload, bootstrapPayload.revision,
              );
              if (lifecycle.canMutate(connectionEpoch)) {
                await session.evaluate(earlyPayloadFor(bootstrapPayload.payload, bootstrapPayload.revision));
              }
              if (!lifecycle.canMutate(connectionEpoch)) await invalidateEarly(record);
            } catch (error) {
              record.needsLoadFallback = true;
              console.error(`[dream-skin] early injection unavailable: ${error.message}`);
            }
          }
          const probe = await waitForCodexProbe(session);
          if (lifecycle.stopping) throw new Error("Watcher stopped during renderer setup");
          if (!probe?.codex) {
            await removeEarly(record);
            if (probe?.excludedPetSurface && !await cleanupExcludedSurface(session)) {
              throw new Error("Excluded Pet surface cleanup did not verify");
            }
            session.close();
            sessions.delete(target.id);
            if (!probe?.excludedPetSurface && !rejected.has(target.id)) {
              console.error(`[dream-skin] rejected non-ChatGPT app target ${target.id}`);
              rejected.add(target.id);
            }
            if (probe?.excludedPetSurface) rejected.delete(target.id);
            continue;
          }
          rejected.delete(target.id);
          if (!lifecycle.canMutate(connectionEpoch) || pausing) {
            await invalidateEarly(record);
          }
          if (lifecycle.controlOnly && !initialOperation) {
            console.log(`[dream-skin] connected control-only target ${target.id}`);
            continue;
          }
          record.operationToken = initialOperation?.token
            ?? recoveryOperation?.token
            ?? nextOperationToken();
          record.operationExternal = Boolean(initialOperation || recoveryOperation);
          await presentOperationUi(
            session,
            record.operationToken,
            "loading",
            initialOperation
              ? operationKindMessage(initialOperation.status === "pausing" ? "pause" : "apply")
              : recoveryOperation
                ? "暂停未完成，正在恢复原皮肤…"
              : `正在应用「${desiredPayload.theme.name}」…`,
          );
          if (!lifecycle.canMutate() || pausing) {
            continue;
          }
          const setupPayload = desiredPayload;
          const earlyApplied = await session.evaluate(
            `window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === ${JSON.stringify(setupPayload.revision)}`,
          );
          if (!earlyApplied || setupPayload.theme?.artMetadata?.video) {
            if (!lifecycle.canMutate(connectionEpoch)) {
              await invalidateEarly(record);
              continue;
            }
            await session.evaluate(
              `window.__CODEX_DREAM_SKIN_EARLY_GENERATION__ = ${JSON.stringify(`fallback:${setupPayload.revision}`)}`,
            );
            if (!lifecycle.canMutate(connectionEpoch)) {
              await invalidateEarly(record);
              continue;
            }
            await applyLoadedToSession(session, setupPayload);
          } else if (lifecycle.canMutate(connectionEpoch)) await bindMediaFileToSession(session, setupPayload);
          if (!lifecycle.canMutate(connectionEpoch)) {
            await invalidateEarly(record);
            continue;
          }
          const verification = await waitForVerifiedSession(
            session,
            Math.min(options.timeoutMs, 8000),
            setupPayload.theme.id,
            setupPayload.revision,
          );
          if (!verification?.pass) throw new Error("Initial theme verification failed");
          if (!lifecycle.canMutate(connectionEpoch) || !lifecycle.owns(target.id, session)) continue;
          record.ready = true;
          if (recoveryOperation && !activeOperation
            && pauseRecovery?.token === recoveryOperation.token) {
            await presentOperationUi(
              session,
              recoveryOperation.token,
              "error",
              "暂停失败，原皮肤已恢复",
              1000,
            );
            recoveredPauseThisCycle = true;
          } else if (!record.operationExternal) {
            await presentOperationUi(
              session, record.operationToken, "success", `已应用「${setupPayload.theme.name}」`,
            );
          }
          console.log(`[dream-skin] injected verified ChatGPT target ${target.id}`);
        } catch (error) {
          const recoveryStillCurrent = recoveryOperation && !activeOperation
            && pauseRecovery?.token === recoveryOperation.token;
          if (recoveryStillCurrent) recoveryFailedThisCycle = true;
          if (record?.operationToken && session && !session.closed) {
            if (recoveryStillCurrent) {
              await presentOperationUi(
                session,
                recoveryOperation.token,
                "error",
                "暂停失败，原皮肤恢复未确认",
                1000,
              );
            } else if (!record.operationExternal) {
              await presentOperationUi(
                session, record.operationToken, "error", "应用失败，未通过显示校验",
              );
            }
          }
          if (record) await removeEarly(record);
          session?.close();
          sessions.delete(target.id);
          console.error(`[dream-skin] inject failed for ${target.id}: ${error.message}`);
        } finally {
          finishTargetSetup();
        }
      }
      if (lifecycle.canMutate() && recoveredPauseThisCycle && !recoveryFailedThisCycle && !activeOperation
        && cycleRecovery?.token === pauseRecovery?.token) {
        await writeModeAck(options.operationAck, cycleRecovery.token, "full");
        pauseRecovery = null;
      }
      const pollDelay = sessions.size ? 800 : (targets.length ? 250 : 100);
      await new Promise((resolve) => setTimeout(resolve, pollDelay));
    }
  } finally {
    stop();
    if (reloadTimer) clearTimeout(reloadTimer);
    closePayloadWatchers();
    closeOperationWatcher();
    await reloadChain.catch(() => {});
    await operationSignalChain.catch(() => {});
    await Promise.all([...sessions.values()].map((record) =>
      record.operationToken && !record.operationExternal
        ? bestEffortOperationUi(record.session, "hide", record.operationToken, "loading", "")
        : Promise.resolve(false)));
    await Promise.all([...sessions.values()].map((record) => removeEarly(record)));
    for (const record of sessions.values()) record.session.close();
    sessions.clear();
  }
}

async function runOneShotAndExit(options) {
  await runOneShot(options);
  await new Promise((resolve) => process.stdout.write("", resolve));
  process.exit(process.exitCode ?? 0);
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === "check") {
      const loaded = await loadPayload(options.themeDir);
      // loadPayload already fails closed, but every installer, importer and
      // theme switch gates on this command, so the guard is re-asserted at the
      // CLI boundary rather than being an internal implementation detail.
      assertPayloadIntegrity(loaded.payload);
      console.log(JSON.stringify({
        pass: true,
        version: SKIN_VERSION,
        payloadIntegrity: "verified",
        themeId: loaded.theme.id,
        themeName: loaded.theme.name,
        opacityUpdateKey: loaded.theme.opacityUpdateKey ?? null,
        imageBytes: loaded.imageBytes,
        payloadBytes: Buffer.byteLength(loaded.payload),
        safeCssStatus: loaded.safeCssStatus,
        artMetadata: loaded.theme.artMetadata ?? null,
        timings: loaded.timings,
      }, null, 2));
    } else if (options.mode === "begin-operation") {
      await runBeginOperation(options);
      await new Promise((resolve) => process.stdout.write("", resolve));
      process.exit(0);
    } else if (options.mode === "finish-operation") {
      await runFinishOperation(options);
      await new Promise((resolve) => process.stdout.write("", resolve));
      process.exit(0);
    } else if (options.mode === "watch") await runWatch(options);
    else await runOneShotAndExit(options);
  } catch (error) {
    console.error(`[dream-skin] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
