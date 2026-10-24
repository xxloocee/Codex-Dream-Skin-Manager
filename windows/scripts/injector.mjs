import { createRendererVerifier, assessRendererVerification } from "./renderer-verification.mjs";
import { createThemePayload } from "./theme-payload.mjs";
import { operationUiExpression as sharedOperationUiExpression, bindMediaFileToSession, applyLoadedToSession, removeFromSession, verifyRemovedSession, cleanupExcludedSurface } from "./renderer-session.mjs";
export { bindMediaFileToSession, applyLoadedToSession, cleanupExcludedSurface };
import { MEDIA_CACHE_ROOT, materializeMediaSnapshot } from "./media-cache.mjs";
export { materializeMediaSnapshot };
import { createCdpTransport, parseCdpMessage } from "./cdp-transport.mjs";
import { createInjectionEngine, discoverCodexTargets } from "./injection-engine.mjs";
import { WatcherLifecycle, DiscoveryRetry, nextIdentityReconnectDelay } from "./watcher-engine.mjs";
import { probeVideoDecode } from "./video-decode-probe.mjs";
import fs from "node:fs/promises";
import { closeSync, openSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";


const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const root = path.resolve(here, "..");
let diagnostics = console;
// CLI one-shot calls share one budget across connection, all windows, and
// verification. Imported helpers and the long-lived watcher retain their own limits.
let operationDeadline = Infinity;
let operationCompleted = false;
function remainingOperationTime(requestedMs) {
  const remaining = Math.min(requestedMs, operationDeadline - Date.now());
  if (remaining <= 0) throw new Error("Dream Skin renderer operation timed out");
  return remaining;
}
let SELECTOR_CONTRACT;
const SELECTOR_MAP = new Map();
async function initializeSelectorContract() {
  SELECTOR_CONTRACT = JSON.parse(await fs.readFile(
    path.join(root, "assets", "selectors.json"), "utf8",
  ));
  if (SELECTOR_CONTRACT.schema !== "codex-dream-skin-selectors/1" ||
    !Array.isArray(SELECTOR_CONTRACT.selectors)) {
    throw new Error("assets/selectors.json has an unsupported schema");
  }
  for (const entry of SELECTOR_CONTRACT.selectors) {
    if (!entry?.key || !entry.selector || SELECTOR_MAP.has(entry.key)) {
      throw new Error(`assets/selectors.json has an invalid selector key: ${entry?.key || "<missing>"}`);
    }
    SELECTOR_MAP.set(entry.key, entry.selector);
  }
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
export { SKIN_VERSION, nextIdentityReconnectDelay };
const STRONG_THEME_AUDIT_MS = 30000;
const MIN_RENDERER_VIEWPORT_WIDTH = 320;
const MIN_RENDERER_VIEWPORT_HEIGHT = 240;
const VISIBLE_WINDOW_STATES = new Set(["normal", "maximized", "fullscreen"]);
const BROWSER_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const OPERATION_KINDS = new Set(["apply", "pause", "switch"]);
const OPERATION_UI_STATES = new Set(["success", "error", "cancelled"]);
// Shared with macOS: in-renderer progress for pause/apply so both platforms feel the same.

let operationSequence = 0;

class CdpIdentityMismatchError extends Error {}

function parseArgs(argv) {
  const options = {
    port: 9335,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    opacityOnly: false,
    browserId: null,
    themeDir: path.join(root, "assets"),
    pauseFile: null,
    operationKind: null,
    operationUiState: null,
    operationMessage: null,
    operationToken: null,
    stdoutLog: null,
    stderrLog: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--apply-live") options.mode = "apply-live";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--verify-live") options.mode = "verify-live";
    else if (arg === "--verify-removed") options.mode = "verify-removed";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--begin-operation") options.mode = "begin-operation";
    else if (arg === "--finish-operation") options.mode = "finish-operation";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--browser-id") options.browserId = argv[++i];
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--pause-file") options.pauseFile = path.resolve(argv[++i]);
    else if (arg === "--stdout-log" || arg === "--stderr-log") {
      const value = argv[++i];
      if (typeof value !== "string" || !value || value.startsWith("--") || value.includes("\0")) {
        throw new Error(`${arg} requires a log file path`);
      }
      options[arg === "--stdout-log" ? "stdoutLog" : "stderrLog"] = path.resolve(value);
    }
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--operation-kind") options.operationKind = argv[++i];
    else if (arg === "--operation-ui-state") options.operationUiState = argv[++i];
    else if (arg === "--operation-message") options.operationMessage = argv[++i];
    else if (arg === "--operation-token") options.operationToken = argv[++i];
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--opacity-only") options.opacityOnly = true;
    else if (arg === "--self-test") options.mode = "self-test";
    else if (arg === "--check-payload") options.mode = "check-payload";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.opacityOnly && (!["once", "apply-live"].includes(options.mode) || options.reload)) {
    throw new Error("--opacity-only requires --once or --apply-live and cannot reload the renderer");
  }
  if (options.browserId !== null && !BROWSER_ID_PATTERN.test(options.browserId)) {
    throw new Error(`Invalid browser ID: ${options.browserId}`);
  }
  if (options.operationToken !== null && !/^\d{1,12}:\d{13}:\d{1,8}$/.test(options.operationToken)) {
    throw new Error("Invalid operation token");
  }
  if (options.mode === "begin-operation") {
    if (!OPERATION_KINDS.has(options.operationKind)) {
      throw new Error("Begin operation requires --operation-kind apply, pause, or switch");
    }
    if (!options.browserId) throw new Error("--browser-id is required in begin-operation mode");
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
    if (!options.browserId) throw new Error("--browser-id is required in finish-operation mode");
  }
  if ([
    "watch", "once", "apply-live", "verify", "verify-live", "verify-removed", "remove",
  ].includes(options.mode) && !options.browserId) {
    throw new Error(`--browser-id is required in ${options.mode} mode`);
  }
  if (options.stdoutLog !== null || options.stderrLog !== null) {
    if (options.mode !== "watch" || !options.stdoutLog || !options.stderrLog) {
      throw new Error("--stdout-log and --stderr-log must be supplied together in watch mode");
    }
    const comparePath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (comparePath(options.stdoutLog) === comparePath(options.stderrLog)) {
      throw new Error("Watcher stdout and stderr logs must use different files");
    }
  }
  return options;
}

function openWatchLogs(options) {
  const descriptors = [];
  const write = (descriptor, args) => {
    const bytes = Buffer.from(format(...args) + "\n", "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("Watcher log write did not complete");
      offset += written;
    }
  };
  const close = () => {
    for (const descriptor of descriptors.splice(0)) {
      try { closeSync(descriptor); } catch {}
    }
  };
  try {
    const stderr = openSync(options.stderrLog, "w", 0o600);
    descriptors.push(stderr);
    const stdout = openSync(options.stdoutLog, "w", 0o600);
    descriptors.push(stdout);
    // Keep logging local to this CLI instance. Synchronous writes survive
    // manager exit and need no PowerShell output-pump threads or final flush.
    return {
      logger: {
        log: (...args) => write(stdout, args),
        error: (...args) => write(stderr, args),
      },
      close,
    };
  } catch (error) {
    if (descriptors.length) {
      try { write(descriptors[0], [`[dream-skin] Could not open watcher logs: ${error.stack || error}`]); } catch {}
    }
    close();
    throw error;
  }
}

const {
  validatedDebuggerUrl, isValidCdpPageTarget, fetchCdpJson, connectTarget,
} = createCdpTransport({ timeBudget: remainingOperationTime, allowBrowserEndpoint: true });
const {
  probeSession, waitForCodexProbe, earlyPayloadFor: sharedEarlyPayloadFor,
} = createInjectionEngine({ selectorLiteral, stableTestidLiteral, tolerateProbeErrors: true });
function browserIdFromVersion(version, port) {
  const url = validatedDebuggerUrl(version, port);
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/devtools\/browser\/([A-Za-z0-9._-]{1,200})$/);
  if (!match || parsed.search || parsed.hash || !BROWSER_ID_PATTERN.test(match[1])) {
    throw new Error("Rejected an invalid CDP browser identity URL");
  }
  return match[1];
}

class BrowserIdentityAnchor {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.closed = false;
    this.ws.addEventListener("close", () => { this.closed = true; });
    this.ws.addEventListener("error", () => {
      this.closed = true;
      try { this.ws.close(); } catch {}
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error("CDP browser identity WebSocket open timed out"));
      }, 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket open failed"));
      }, { once: true });
      this.ws.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket closed during startup"));
      }, { once: true });
    });
    if (this.closed) throw new Error("CDP browser identity WebSocket is already closed");
    return this;
  }

  close() {
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

async function listAppTargets(port, expectedBrowserId = null) {
  const targets = await fetchCdpJson(port, "/json/list");
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array");
  if (expectedBrowserId) {
    const version = await fetchCdpJson(port, "/json/version");
    const actualBrowserId = browserIdFromVersion(version, port);
    if (actualBrowserId !== expectedBrowserId) {
      throw new CdpIdentityMismatchError(
        `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
      );
    }
  }
  return targets.filter((item) => isValidCdpPageTarget(item, port));
}

export async function connectBrowserIdentityAnchor(port, expectedBrowserId) {
  const version = await fetchCdpJson(port, "/json/version");
  const actualBrowserId = browserIdFromVersion(version, port);
  if (actualBrowserId !== expectedBrowserId) {
    throw new CdpIdentityMismatchError(
      `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
    );
  }
  return new BrowserIdentityAnchor(validatedDebuggerUrl(version, port)).open();
}

const { loadTheme, loadPayload } = createThemePayload(root, SKIN_VERSION);
export { loadTheme, loadPayload };

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readThemeSourceStamp(loadedTheme) {
  const [themeStat, imageStat, cssStat] = await Promise.all([
    fs.stat(loadedTheme.themePath),
    fs.stat(loadedTheme.imagePath),
    fs.stat(path.join(path.dirname(loadedTheme.themePath), "theme.css")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  ]);
  return `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}:` +
    (cssStat ? `${cssStat.size}:${cssStat.mtimeMs}` : "none");
}

function unavailableNativeWindow(error) {
  const message = String(error?.message ?? "");
  const cdpCode = Number(error?.cdpCode);
  const withoutCode = message.replace(/\s*\(-?\d+\)\s*$/, "").trim();
  const domainUnsupported = cdpCode === -32601
    || /\(-32601\)\s*$/.test(message)
    || /^method(?: ['"]Browser\.getWindowForTarget['"])? not found$/i.test(withoutCode)
    || /^['"]?Browser\.getWindowForTarget['"]? (?:wasn't|was not) found$/i.test(withoutCode);
  // Codex 26.721.x (Chrome/150) answers -32000 "Browser window not found" for
  // the app's real, focused, on-screen window -- verified live via CDP: the
  // error is identical before and after actually activating the window, while
  // documentVisibility correctly flips hidden -> visible. The domain exists but
  // this build never resolves a window for our target, so -32000 is exactly as
  // uninformative here as -32601 elsewhere. Treat both the same way and lean on
  // documentVisible, which stays a hard requirement in windowPass below, as the
  // real visibility signal. Matches macOS classifyNativeWindowError. See #256.
  const windowNotFound = cdpCode === -32000
    || /\(-32000\)\s*$/.test(message)
    || /^browser window not found$/i.test(withoutCode)
    || /^no window with given target found$/i.test(withoutCode);
  return {
    pass: false,
    bound: false,
    unsupported: domainUnsupported || windowNotFound,
    reason: domainUnsupported ? "browser-window-api-unavailable"
      : windowNotFound ? "browser-window-not-found"
      : "target-window-unavailable",
  };
}

export async function inspectTargetWindow(session, targetId) {
  if (typeof targetId !== "string" || !BROWSER_ID_PATTERN.test(targetId)) {
    return { pass: false, bound: false, reason: "invalid-target-id" };
  }

  let binding;
  try {
    binding = await session.send("Browser.getWindowForTarget", { targetId });
  } catch (error) {
    return unavailableNativeWindow(error);
  }
  if (!Number.isInteger(binding?.windowId) || binding.windowId <= 0) {
    return { pass: false, bound: false, reason: "invalid-window-binding" };
  }

  let latest;
  try {
    latest = await session.send("Browser.getWindowBounds", { windowId: binding.windowId });
  } catch (error) {
    return unavailableNativeWindow(error);
  }
  const bounds = { ...(binding.bounds ?? {}), ...(latest?.bounds ?? {}) };
  const state = typeof bounds.windowState === "string" ? bounds.windowState : null;
  const width = Number.isFinite(bounds.width) ? Number(bounds.width) : null;
  const height = Number.isFinite(bounds.height) ? Number(bounds.height) : null;
  const statePass = VISIBLE_WINDOW_STATES.has(state);
  const boundsPass = width !== null && height !== null &&
    width >= MIN_RENDERER_VIEWPORT_WIDTH && height >= MIN_RENDERER_VIEWPORT_HEIGHT;
  return {
    pass: statePass && boundsPass,
    bound: true,
    windowId: binding.windowId,
    state,
    width,
    height,
    reason: !statePass ? "window-not-visible" : !boundsPass ? "window-bounds-too-small" : null,
  };
}

export async function connectCodexTargets(port, timeoutMs, expectedBrowserId) {
  return discoverCodexTargets({
    port, timeoutMs: remainingOperationTime(timeoutMs),
    listTargets: () => listAppTargets(port, expectedBrowserId),
    connectTarget, probeSession, cleanupExcludedSurface,
    isFatalError: (error) => error instanceof CdpIdentityMismatchError,
  });
}
export async function probeVideoInCodex(snapshotPath, state) {
  let connected = [];
  let anchor = null;
  try {
    if (!BROWSER_ID_PATTERN.test(state.browserId || "")) throw new Error("Missing browser identity");
    anchor = await connectBrowserIdentityAnchor(state.port, state.browserId);
    // A newly launched browser can expose CDP before its main window is ready.
    // Wait for the shell, but never retry an actual decode failure.
    connected = await connectCodexTargets(state.port, 10000, state.browserId);
  } catch {
    anchor?.close();
    throw new Error("无法验证视频解码能力：请先启动 Codex 并连接皮肤运行时，再重试导入或应用。");
  }
  try {
    for (const { session, probe } of connected) {
      if (!probe?.codex || probe.excludedPetSurface) continue;
      const result = await probeVideoDecode(session, snapshotPath);
      if (anchor?.closed) throw new Error("Codex 连接已变化，请重试视频校验。");
      return result;
    }
    throw new Error("未找到可校验的 Codex 主窗口，请打开 Codex 主界面后重试。");
  } finally {
    for (const { session } of connected) session.close();
    anchor?.close();
  }
}


export function earlyPayloadFor(payload, revision) {
  return sharedEarlyPayloadFor(payload, revision);
}
async function registerEarlyPayload(session, payload, revision) {
  const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: earlyPayloadFor(payload, revision),
  });
  return result.identifier ?? null;
}

async function removeEarlyPayload(session, identifier) {
  if (!identifier || session.closed) return;
  await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
}


function nextOperationToken() {
  operationSequence += 1;
  return `${process.pid}:${Date.now()}:${operationSequence}`;
}

function operationKindMessage(kind) {
  if (kind === "pause") return "正在暂停皮肤…";
  if (kind === "switch") return "正在切换主题…";
  return "正在应用皮肤…";
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
    diagnostics.error(`[dream-skin] client status unavailable: ${error.message}`);
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


export async function verifyAppliedSession(
  session,
  expectedThemeId = null,
  expectedRevision = null,
) {
  return session.evaluate(`(() => {
    const runtime = window.__CODEX_DREAM_SKIN_STATE__;
    const adopted = runtime?.styleMode === 'adopted' && 'adoptedStyleSheets' in document &&
      [...document.adoptedStyleSheets].includes(runtime.styleSheet);
    const fallback = runtime?.styleMode === 'style' &&
      document.getElementById('codex-dream-skin-style') === runtime.styleNode;
    const expectedThemeId = ${JSON.stringify(expectedThemeId)};
    const expectedRevision = ${JSON.stringify(expectedRevision)};
    const result = {
      installed: document.documentElement.getAttribute('data-dream-skin') === 'active',
      disabled: window.__CODEX_DREAM_SKIN_DISABLED__ === true,
      version: runtime?.version ?? null,
      expectedVersion: ${JSON.stringify(SKIN_VERSION)},
      themeId: runtime?.themeId ?? null,
      expectedThemeId,
      revision: runtime?.revision ?? null,
      opacityUpdateFailed: runtime?.opacityUpdateFailed === true,
      expectedRevision,
      stylePresent: Boolean(adopted || fallback),
    };
    result.pass = result.installed && !result.disabled && !result.opacityUpdateFailed &&
      result.version === result.expectedVersion && result.stylePresent &&
      (!expectedThemeId || result.themeId === expectedThemeId) &&
      (!expectedRevision || result.revision === expectedRevision);
    return result;
  })()`);
}


const verifyRenderer = createRendererVerifier(selectorLiteral, stableTestidLiteral, SKIN_VERSION);
export async function verifySession(session, targetId, expectedThemeId = null, expectedRevision = null) {
  return verifyRenderer(session, await inspectTargetWindow(session, targetId), expectedThemeId, expectedRevision);
}

async function waitForVerifiedSession(
  session,
  targetId,
  timeoutMs,
  expectedThemeId = null,
  expectedRevision = null,
) {
  const deadline = Date.now() + remainingOperationTime(timeoutMs);
  let lastResult;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastResult = await verifySession(session, targetId, expectedThemeId, expectedRevision);
      lastError = null;
      if (lastResult.pass) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!lastResult && lastError) throw lastError;
  return lastResult;
}

async function waitForAppliedSession(
  session,
  timeoutMs,
  expectedThemeId = null,
  expectedRevision = null,
) {
  const deadline = Date.now() + remainingOperationTime(timeoutMs);
  let lastResult;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastResult = await verifyAppliedSession(session, expectedThemeId, expectedRevision);
      lastError = null;
      if (lastResult.pass) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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

async function runBeginOperation(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs, options.browserId);
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
  if (!shown) throw new Error("Could not show operation progress in the verified Codex renderer");
  process.stdout.write(`${operationToken}\n`);
}

async function runFinishOperation(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs, options.browserId);
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
  if (!shown) throw new Error("Could not show the completed operation state in the verified Codex renderer");
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs, options.browserId);
  const operationToken = ["once", "apply-live", "remove"].includes(options.mode)
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
  let loadedPayload = null;
  try {
    loadedPayload = (["once", "apply-live", "verify", "verify-live"].includes(options.mode) || options.reload)
      ? await loadPayload(options.themeDir) : null;
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
  try {
    for (const { target, session, probe } of connected) {
      let opacity = null;
      try {
        if (options.mode === "remove") await removeFromSession(session);
        else if (options.mode === "once" || options.mode === "apply-live") {
          if (operationToken) {
            await bestEffortOperationUi(
              session, "update", operationToken, "loading",
              `正在应用「${loadedPayload.theme.name}」…`,
            );
          }
          opacity = await applyLoadedToSession(session, loadedPayload, { opacityOnly: options.opacityOnly });
          await new Promise((resolve) => setTimeout(resolve, options.mode === "once" ? 850 : 100));
        }
        if (options.reload) {
          await session.send("Page.reload", { ignoreCache: true });
          await new Promise((resolve) => setTimeout(resolve, 1600));
          if (options.mode !== "remove") {
            if (operationToken) {
              await presentOperationUi(
                session, operationToken, "loading",
                `正在应用「${loadedPayload.theme.name}」…`,
              );
            }
            opacity = await applyLoadedToSession(session, loadedPayload);
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
        const removedMode = options.mode === "remove" || options.mode === "verify-removed";
        const liveMode = options.mode === "apply-live" || options.mode === "verify-live";
        const verified = removedMode
          ? await verifyRemovedSession(session)
          : liveMode
            ? await waitForAppliedSession(
              session,
              options.timeoutMs,
              loadedPayload?.theme.id ?? null,
              loadedPayload?.revision ?? null,
            )
          : (options.reload || options.mode === "once" || options.mode === "verify")
            ? await waitForVerifiedSession(
              session,
              target.id,
              options.timeoutMs,
              loadedPayload?.theme.id ?? null,
              loadedPayload?.revision ?? null,
            )
            : await verifySession(session, target.id);
        results.push({ targetId: target.id, markers: probe.markers, result: verified, ...(opacity ? { opacity } : {}) });
        if (operationToken) {
          const passed = removedMode ? verified === true : verified?.pass;
          await presentOperationUi(
            session,
            operationToken,
            passed ? "success" : "error",
            passed
              ? removedMode ? "皮肤已暂停" : `已应用「${loadedPayload.theme.name}」`
              : removedMode ? "暂停校验失败" : "显示校验失败",
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
        results.push({ targetId: target.id, markers: probe?.markers, error: error.message, ...(opacity ? { opacity } : {}) });
      } finally {
        session.close();
      }
    }
  } finally {
    for (const { session } of connected) session.close();
  }
  // Flush the result before marking logical completion; a socket that closes
  // late must not turn an already reported success into a timeout or truncate it.
  writeSync(1, JSON.stringify({ mode: options.mode, port: options.port, targets: results }, null, 2) + "\n");
  const removedMode = options.mode === "remove" || options.mode === "verify-removed";
  const failed = results.length === 0 || results.some((item) =>
    item.error || (removedMode ? item.result !== true : !item.result?.pass));
  if (failed) process.exitCode = 2;
}

async function runWatch(options) {
  let identityAnchor = await connectBrowserIdentityAnchor(options.port, options.browserId);
  const lifecycle = new WatcherLifecycle();
  const sessions = lifecycle.sessions;
  const discoveryRetry = new DiscoveryRetry({ profile: "windows" });
  const earlyScripts = new Map();
  const fallbackTargets = new Map();
  const fallbackListeners = new Set();
  const targetFailures = new Map();
  let lastThemeErrorLogAt = 0;
  let lastStrongThemeAuditAt = 0;
  let identityReconnectFailures = 0;
  let lastIdentityReconnectLogAt = 0;
  let loadedPayload = null;
  let paused = false;
  const stop = () => { lifecycle.transition("stopping"); };
  const rejectTarget = (target, baseDelayMs, error = null) => {
    const previous = targetFailures.get(target.id) ?? { failures: 0, lastLogAt: 0 };
    const failures = previous.failures + 1;
    const delayMs = Math.min(30000, baseDelayMs * (2 ** Math.min(failures - 1, 4)));
    const now = Date.now();
    if (error && (failures === 1 || now - previous.lastLogAt >= 30000)) {
      diagnostics.error(`[dream-skin] inject failed for ${target.id}: ${error.message}; retrying in ${delayMs}ms`);
      previous.lastLogAt = now;
    }
    targetFailures.set(target.id, { failures, lastLogAt: previous.lastLogAt, until: now + delayMs });
  };
  const attachLoadFallback = (id, target, session) => {
    if (fallbackListeners.has(session)) return;
    fallbackListeners.add(session);
    let lastReinjectErrorLogAt = 0;
    session.on("Page.loadEventFired", () => {
      if (lifecycle.stopping || !lifecycle.owns(id, session)) return;
      if (!fallbackTargets.get(id) && !loadedPayload?.mediaFilePath) return;
      const fallbackEpoch = lifecycle.epoch;
      setTimeout(() => {
        if (!lifecycle.canMutate(fallbackEpoch) || !lifecycle.owns(id, session)) return;
        const operation = paused
          ? removeFromSession(session)
          : (fallbackTargets.get(id) || loadedPayload.theme?.artMetadata?.video)
            ? applyLoadedToSession(session, loadedPayload)
            : bindMediaFileToSession(session, loadedPayload);
        operation.catch((error) => {
          if (Date.now() - lastReinjectErrorLogAt >= 30000) {
            diagnostics.error(`[dream-skin] reinject failed for ${target.id}: ${error.message}`);
            lastReinjectErrorLogAt = Date.now();
          }
        });
      }, 250);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const releaseIdentitySessions = async () => {
    const records = [...sessions.entries()];
    sessions.clear();
    for (const [id, session] of records) {
      await removeEarlyPayload(session, earlyScripts.get(id));
      earlyScripts.delete(id);
      fallbackTargets.delete(id);
      fallbackListeners.delete(session);
      targetFailures.delete(id);
      session.close();
    }
  };

  const reconnectIdentityAnchor = async () => {
    if (!identityAnchor.closed) return true;
    await releaseIdentitySessions();
    while (!lifecycle.stopping && identityAnchor.closed) {
      try {
        // The expected browser ID is deliberately retained across reconnects.
        // A replacement endpoint with a different identity is never adopted:
        // the Windows launcher must be restarted after a real browser restart.
        const replacement = await connectBrowserIdentityAnchor(options.port, options.browserId);
        if (lifecycle.stopping) {
          replacement.close();
          return false;
        }
        if (replacement.closed) {
          replacement.close();
          throw new Error("CDP browser identity closed during reconnect");
        }
        identityAnchor.close();
        identityAnchor = replacement;
        identityReconnectFailures = 0;
        diagnostics.log("[dream-skin] CDP browser identity reconnected");
        return true;
      } catch (error) {
        if (error instanceof CdpIdentityMismatchError) {
          diagnostics.error(`[dream-skin] CDP browser identity changed during handoff; watcher is stopping: ${error.message}`);
          process.exitCode = 3;
          stop();
          return false;
        }
        identityReconnectFailures += 1;
        const retryMs = nextIdentityReconnectDelay(identityReconnectFailures);
        const now = Date.now();
        if (identityReconnectFailures === 1 || now - lastIdentityReconnectLogAt >= 30000) {
          diagnostics.error(`[dream-skin] ${new Date().toISOString()} ${error.message}; waiting for the verified CDP identity (retrying in ${retryMs}ms)`);
          lastIdentityReconnectLogAt = now;
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
    return false;
  };

  try {
    loadedPayload = await loadPayload(options.themeDir);
    lastStrongThemeAuditAt = Date.now();
    paused = await fileExists(options.pauseFile);
    lifecycle.transition(paused ? "paused" : "full");
    while (!lifecycle.stopping) {
      if (identityAnchor.closed) {
        if (!await reconnectIdentityAnchor()) break;
      }
      let targets = [];
      try {
        targets = await listAppTargets(options.port, options.browserId);
        discoveryRetry.succeed();
      } catch (error) {
        if (error instanceof CdpIdentityMismatchError) {
          diagnostics.error(`[dream-skin] CDP browser identity changed while watching; watcher is stopping: ${error.message}`);
          process.exitCode = 3;
          break;
        }
        const { retryMs, shouldLog } = discoveryRetry.fail();
        if (shouldLog) {
          diagnostics.error(`[dream-skin] ${new Date().toISOString()} ${error.message}; retrying in ${retryMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }

      const nextPaused = await fileExists(options.pauseFile);
      let nextPayload = loadedPayload;
      if (!nextPaused) {
        try {
          const now = Date.now();
          let shouldAudit = !loadedPayload || now - lastStrongThemeAuditAt >= STRONG_THEME_AUDIT_MS;
          if (!shouldAudit) {
            try {
              shouldAudit = await readThemeSourceStamp(loadedPayload) !== loadedPayload.sourceStamp;
            } catch {
              shouldAudit = true;
            }
          }
          if (shouldAudit) {
            const candidateTheme = await loadTheme(options.themeDir);
            lastStrongThemeAuditAt = now;
            if (!loadedPayload || candidateTheme.fingerprint !== loadedPayload.fingerprint) {
              nextPayload = await loadPayload(options.themeDir, candidateTheme);
            } else {
              loadedPayload.sourceStamp = candidateTheme.sourceStamp;
            }
          }
        } catch (error) {
          if (Date.now() - lastThemeErrorLogAt >= 30000) {
            diagnostics.error(`[dream-skin] theme update rejected: ${error.message}; keeping the active theme`);
            lastThemeErrorLogAt = Date.now();
          }
        }
      }
      const pauseChanged = nextPaused !== paused;
      const payloadChanged = !nextPaused && nextPayload !== loadedPayload;
      const opacityOnly = payloadChanged && !pauseChanged && loadedPayload?.theme?.artMetadata?.video &&
        nextPayload?.theme?.artMetadata?.video && /^[a-f0-9]{64}$/.test(nextPayload.theme.opacityUpdateKey ?? "") &&
        nextPayload.theme.opacityUpdateKey === loadedPayload.theme.opacityUpdateKey;
      loadedPayload = nextPayload;
      paused = nextPaused;
      lifecycle.transition(paused ? "paused" : "full", { invalidate: payloadChanged });

      if (pauseChanged || payloadChanged) {
        const acceptedSessions = [...sessions.entries()].filter(([id, session]) =>
          !session.closed && lifecycle.owns(id, session));
        for (const [id, session] of acceptedSessions) {
          if (lifecycle.stopping) break;
          if (session.closed || !lifecycle.owns(id, session)) continue;
          try {
            const previousEarlyScript = earlyScripts.get(id);
            if (paused) {
              await removeFromSession(session);
              if (session.closed || !lifecycle.owns(id, session)) continue;
              await removeEarlyPayload(session, previousEarlyScript);
              if (session.closed || !lifecycle.owns(id, session)) continue;
              earlyScripts.delete(id);
              fallbackTargets.delete(id);
            } else {
              let nextEarlyScript = null;
              try {
                nextEarlyScript = await registerEarlyPayload(
                  session,
                  loadedPayload.payload,
                  loadedPayload.fingerprint,
                );
                if (!nextEarlyScript) throw new Error("CDP did not return an early-script identifier");
                if (session.closed || !lifecycle.owns(id, session)) {
                  await removeEarlyPayload(session, nextEarlyScript);
                  continue;
                }
                fallbackTargets.set(id, false);
              } catch (error) {
                if (session.closed || !lifecycle.owns(id, session)) continue;
                fallbackTargets.set(id, true);
                diagnostics.error(`[dream-skin] early theme refresh unavailable for ${id}: ${error.message}`);
                attachLoadFallback(id, { id }, session);
              }
              if (nextEarlyScript) earlyScripts.set(id, nextEarlyScript);
              else earlyScripts.delete(id);
              await removeEarlyPayload(session, previousEarlyScript);
              if (lifecycle.stopping) break;
              if (session.closed || !lifecycle.owns(id, session)) continue;
              await applyLoadedToSession(session, loadedPayload, { opacityOnly: Boolean(opacityOnly) });
              if (!session.closed && lifecycle.owns(id, session) && loadedPayload.mediaFilePath) attachLoadFallback(id, { id }, session);
            }
          } catch (error) {
            if (session.closed || !lifecycle.owns(id, session)) continue;
            diagnostics.error(`[dream-skin] live theme update failed for ${id}: ${error.message}`);
            // A rejected opacity update must not reconnect and rebind the video.
            if (opacityOnly) continue;
            await removeEarlyPayload(session, earlyScripts.get(id));
            earlyScripts.delete(id);
            fallbackTargets.delete(id);
            fallbackListeners.delete(session);
            session.close();
            sessions.delete(id);
          }
        }
        diagnostics.log(paused ? "[dream-skin] paused" : `[dream-skin] active theme ${loadedPayload.theme.id}`);
      }

      const activeIds = new Set(targets.map((target) => target.id));
      for (const id of targetFailures.keys()) {
        if (!activeIds.has(id)) targetFailures.delete(id);
      }
      for (const [id, session] of lifecycle.staleSessions(targets)) {
        await removeEarlyPayload(session, earlyScripts.get(id));
        earlyScripts.delete(id);
        fallbackTargets.delete(id);
        fallbackListeners.delete(session);
        session.close();
        sessions.delete(id);
        targetFailures.delete(id);
      }

      for (const target of targets) {
        if (lifecycle.stopping || identityAnchor.closed) break;
        if (sessions.has(target.id)) continue;
        if ((targetFailures.get(target.id)?.until ?? 0) > Date.now()) continue;
        let session;
        let earlyScriptId = null;
        lifecycle.beginTargetSetup();
        try {
          session = await connectTarget(target, options.port);
          if (lifecycle.stopping) throw new Error("Watcher stopped during renderer setup");
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyInjectionFallback = false;
          if (!paused) {
            try {
              earlyScriptId = await registerEarlyPayload(
                session,
                loadedPayload.payload,
                loadedPayload.fingerprint,
              );
              if (!earlyScriptId) throw new Error("CDP did not return an early-script identifier");
              if (lifecycle.stopping) throw new Error("Watcher stopped during renderer setup");
              await session.evaluate(earlyPayloadFor(loadedPayload.payload, loadedPayload.fingerprint));
            } catch (error) {
              await removeEarlyPayload(session, earlyScriptId);
              earlyScriptId = null;
              earlyInjectionFallback = true;
              diagnostics.error(`[dream-skin] early injection unavailable for ${target.id}: ${error.message}`);
            }
          }
          const probe = await waitForCodexProbe(session);
          if (!probe?.codex) {
            await removeEarlyPayload(session, earlyScriptId);
            if (probe?.excludedPetSurface && !await cleanupExcludedSurface(session)) {
              throw new Error("Excluded Pet surface cleanup did not verify");
            }
            rejectTarget(target, 5000);
            session.close();
            continue;
          }
          fallbackTargets.set(target.id, earlyInjectionFallback);
          if (earlyInjectionFallback || loadedPayload.mediaFilePath) {
            attachLoadFallback(target.id, target, session);
          }
          if (lifecycle.stopping) throw new Error("Watcher stopped during renderer setup");
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyApplied = false;
          if (!paused && !earlyInjectionFallback) {
            earlyApplied = await session.evaluate(
              `window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === ${JSON.stringify(loadedPayload.fingerprint)}`,
            ).catch(() => false);
          }
          if (lifecycle.stopping) throw new Error("Watcher stopped during renderer setup");
          if (paused) await removeFromSession(session);
          else {
            if (!earlyApplied || loadedPayload.theme?.artMetadata?.video) await applyLoadedToSession(session, loadedPayload);
            else await bindMediaFileToSession(session, loadedPayload);
          }
          sessions.set(target.id, session);
          if (earlyScriptId) earlyScripts.set(target.id, earlyScriptId);
          targetFailures.delete(target.id);
          diagnostics.log(`[dream-skin] injected target ${target.id}`);
        } catch (error) {
          await removeEarlyPayload(session, earlyScriptId);
          fallbackTargets.delete(target.id);
          if (session) fallbackListeners.delete(session);
          session?.close();
          if (lifecycle.stopping || identityAnchor.closed || error instanceof CdpIdentityMismatchError) break;
          rejectTarget(target, 2500, error);
        } finally {
          lifecycle.finishTargetSetup();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } finally {
    stop();
    identityAnchor.close();
    for (const [id, session] of sessions) {
      await removeEarlyPayload(session, earlyScripts.get(id));
      session.close();
    }
    earlyScripts.clear();
    sessions.clear();
    fallbackTargets.clear();
    fallbackListeners.clear();
  }
}

async function main(options) {
  await initializeSelectorContract();
  if (!["watch", "self-test", "check-payload"].includes(options.mode)) {
    operationDeadline = Date.now() + options.timeoutMs;
    // Bound even an unresolved socket close or renderer promise. Never apply
    // this watchdog to --watch, which must outlive the manager invocation.
    setTimeout(() => {
      if (operationCompleted) process.exit(process.exitCode ?? 0);
      try { writeSync(2, `Dream Skin ${options.mode} exceeded its ${options.timeoutMs} ms total budget\n`); }
      finally { process.exit(2); }
    }, options.timeoutMs + 1000).unref();
  }
  if (options.mode === "self-test") {
  const valid = validatedDebuggerUrl({ webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/test` }, options.port);
  const browserId = browserIdFromVersion({
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/test-browser`,
  }, options.port);
  const invalid = [
    "ws://example.com/devtools/page/test",
    `ws://127.0.0.1:${options.port + 1}/devtools/page/test`,
    `wss://127.0.0.1:${options.port}/devtools/page/test`,
    `ws://user@127.0.0.1:${options.port}/devtools/page/test`,
    `ws://127.0.0.1:${options.port}/unexpected/test`,
    `ws://127.0.0.1:${options.port}/devtools/page/test?query=1`,
  ];
  for (const value of invalid) {
    let rejected = false;
    try { validatedDebuggerUrl({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`CDP URL validation accepted an unsafe URL: ${value}`);
  }
  const invalidBrowserUrls = [
    `ws://127.0.0.1:${options.port}/devtools/page/not-a-browser`,
    `ws://127.0.0.1:${options.port}/devtools/browser/bad%20id`,
    `ws://127.0.0.1:${options.port}/devtools/browser/test?query=1`,
  ];
  for (const value of invalidBrowserUrls) {
    let rejected = false;
    try { browserIdFromVersion({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`Browser identity validation accepted an unsafe URL: ${value}`);
  }
  const validPageTarget = {
    id: "page-test",
    type: "page",
    url: "app://codex/",
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/page-test`,
  };
  const invalidPageTargets = [
    { ...validPageTarget, webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/page-test` },
    { ...validPageTarget, id: "other-page" },
    { ...validPageTarget, id: 123 },
    { ...validPageTarget, type: "other" },
  ];
  if (!valid || browserId !== "test-browser" || !isValidCdpPageTarget(validPageTarget, options.port) ||
      invalidPageTargets.some((item) => isValidCdpPageTarget(item, options.port))) {
    throw new Error("CDP URL and target validation self-test failed");
  }
  const validMessage = parseCdpMessage('{"id":7,"result":{"ok":true}}');
  const invalidMessages = ["{not-json", "null", '"text"', "42", "true"];
  if (validMessage?.id !== 7 || validMessage.result?.ok !== true ||
      invalidMessages.some((value) => parseCdpMessage(value) !== null)) {
    throw new Error("CDP message validation self-test failed");
  }
  if (/dispatchKeyEvent|dispatchMouseEvent/.test(capture.toString())) {
    throw new Error("Screenshot capture must not dispatch renderer input events");
  }
  console.log(JSON.stringify({ pass: true, version: SKIN_VERSION, test: "loopback-cdp-validation" }));
  } else if (options.mode === "check-payload") {
    const loaded = await loadPayload(options.themeDir);
    const unresolved = /__DREAM_SKIN_[A-Z0-9_]+_JSON__/.test(loaded.payload);
    if (unresolved) {
      throw new Error("Payload placeholders were not fully replaced");
    }
    console.log(JSON.stringify({
      pass: true,
      version: SKIN_VERSION,
      payloadBytes: Buffer.byteLength(loaded.payload),
      themeId: loaded.theme.id,
      opacityUpdateKey: loaded.theme.opacityUpdateKey,
      appearance: loaded.theme.appearance,
      colorMode: loaded.theme.colorMode,
      explicitColorKeys: loaded.theme.explicitColorKeys,
      hasColors: !!loaded.theme.colors && typeof loaded.theme.colors === "object",
      hasPalette: Object.hasOwn(loaded.theme, "palette"),
      art: loaded.theme.art,
      artMetadata: loaded.theme.artMetadata ?? null,
      safeCssStatus: loaded.safeCssStatus,
    }));
  } else if (options.mode === "begin-operation") await runBeginOperation(options);
  else if (options.mode === "finish-operation") await runFinishOperation(options);
  else if (options.mode === "watch") await runWatch(options);
  else await runOneShot(options);
  operationCompleted = true;
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  let watchLogs;
  let logUncaughtFailure;
  let cliFailed = false;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.stdoutLog && options.stderrLog) {
      watchLogs = openWatchLogs(options);
      diagnostics = watchLogs.logger;
      logUncaughtFailure = (error) => {
        try { diagnostics.error(`[dream-skin] ${error.stack || error}`); } catch {}
      };
      // Observe fatal asynchronous failures without suppressing Node's normal
      // termination, so their diagnostics also survive a detached watcher.
      process.on("uncaughtExceptionMonitor", logUncaughtFailure);
    }
    await main(options);
  } catch (error) {
    cliFailed = true;
    const message = `[dream-skin] ${error.stack || error}`;
    try {
      if (watchLogs) diagnostics.error(message);
      else writeSync(2, message + "\n");
    } catch { try { writeSync(2, message + "\n"); } catch {} }
  } finally {
    if (logUncaughtFailure) process.off("uncaughtExceptionMonitor", logUncaughtFailure);
    diagnostics = console;
    watchLogs?.close();
  }
  // Match Node's previous uncaught CLI failure behavior even if a failed CDP
  // connection left a socket alive. Diagnostics are already written above.
  if (cliFailed) process.exit(1);
} else {
  // Imported helpers retain the initialized selector contract and default
  // console without opening files or running the watcher.
  await initializeSelectorContract();
}
