import { probeVideoDecode } from "./video-decode-probe.mjs";
const OPERATION_UI_HOST_ID = "chatgpt-dream-skin-operation";
const OPERATION_UI_REGISTRY_KEY = "__CHATGPT_DREAM_SKIN_OPERATION_UI__";
const OPERATION_UI_CSS = `
  :host {
    all: initial;
    position: fixed;
    top: var(--dream-skin-operation-top, 0px);
    left: var(--dream-skin-operation-left, 0px);
    width: var(--dream-skin-operation-width, 100vw);
    height: var(--dream-skin-operation-height, 100vh);
    z-index: 2147483647;
    pointer-events: none;
    opacity: 0;
    display: grid;
    place-items: center;
    transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  :host([data-visible="true"]) {
    opacity: 1;
  }
  .status {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: min(220px, calc(100% - 32px));
    min-height: 112px;
    padding: 18px 20px;
    border: 1px solid rgba(238, 239, 244, 0.16);
    border-radius: 8px;
    background: rgba(32, 33, 38, 0.94);
    color: #f3f3f6;
    box-shadow: 0 8px 24px rgba(12, 14, 19, 0.22);
    font-size: 13px;
    font-weight: 550;
    line-height: 1.35;
    letter-spacing: 0;
    text-align: center;
    transform: translateY(-4px) scale(0.98);
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  :host([data-visible="true"]) .status {
    transform: translateY(0) scale(1);
  }
  :host([data-tone="light"]) .status {
    border-color: #d9dbe3;
    background: rgba(248, 248, 251, 0.96);
    color: #25262c;
    box-shadow: 0 8px 24px rgba(31, 35, 48, 0.14);
  }
  .indicator {
    box-sizing: border-box;
    flex: 0 0 22px;
    width: 22px;
    height: 22px;
    color: #78a8f5;
  }
  :host([data-state="loading"]) .indicator {
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: dream-skin-operation-spin 720ms linear infinite;
  }
  :host([data-state="success"]) .indicator,
  :host([data-state="error"]) .indicator,
  :host([data-state="cancelled"]) .indicator {
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-size: 16px;
    font-weight: 750;
  }
  :host([data-state="success"]) .indicator {
    color: #53b77b;
  }
  :host([data-state="success"]) .indicator::before {
    content: "✓";
  }
  :host([data-state="error"]) .indicator {
    color: #e26d7e;
  }
  :host([data-state="error"]) .indicator::before {
    content: "!";
  }
  :host([data-state="cancelled"]) .indicator {
    color: #a5a7b0;
  }
  :host([data-state="cancelled"]) .indicator::before {
    content: "×";
  }
  .message {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  @keyframes dream-skin-operation-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    :host, .status { transition: none; }
    :host([data-state="loading"]) .indicator {
      animation: none;
      border-top-color: currentColor;
      opacity: 0.65;
    }
  }
`;

export function operationUiExpression(action, token, state = "loading", message = "", selectorLiteral) {
  const config = { action, token, state, message };
  return `(() => {
    const config = ${JSON.stringify(config)};
    const hostId = ${JSON.stringify(OPERATION_UI_HOST_ID)};
    const registryKey = ${JSON.stringify(OPERATION_UI_REGISTRY_KEY)};
    const css = ${JSON.stringify(OPERATION_UI_CSS)};
    const revealDelayMs = 16;
    const minimumLoadingMs = 700;
    const stateTtl = (value) => value === "loading" ? 180000
      : value === "success" ? 1800 : value === "cancelled" ? 2400 : 6000;
    const issuedAt = (value) => Number(String(value).split(":")[1]) || 0;
    const positionInMainArea = (host) => {
      const main = document.querySelector(${selectorLiteral("shell-main")}) ||
        document.querySelector('[role="main"]') || document.documentElement;
      const rect = main.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const left = Math.max(0, rect.left);
      const width = Math.max(1, Math.min(innerWidth - left, rect.width || innerWidth));
      const height = Math.max(1, Math.min(innerHeight - top, rect.height || innerHeight));
      host.style.setProperty("--dream-skin-operation-top", String(top) + "px");
      host.style.setProperty("--dream-skin-operation-left", String(left) + "px");
      host.style.setProperty("--dream-skin-operation-width", String(width) + "px");
      host.style.setProperty("--dream-skin-operation-height", String(height) + "px");
    };
    const clearTimer = (timer) => { if (timer) clearTimeout(timer); };
    const removeHost = (expectedToken, force = false) => {
      const host = document.getElementById(hostId);
      const registry = window[registryKey];
      if (!force && host?.dataset.operationToken !== expectedToken) return false;
      if (!force && registry?.token && registry.token !== expectedToken) return false;
      clearTimer(registry?.showTimer);
      clearTimer(registry?.expiryTimer);
      clearTimer(registry?.terminalTimer);
      host?.remove();
      if (force || registry?.token === expectedToken) delete window[registryKey];
      return true;
    };
    if (config.action === "clear") {
      removeHost("", true);
      return { visible: false, cleared: true };
    }
    if (config.action === "hide") {
      return { visible: false, removed: removeHost(config.token) };
    }
    let host = document.getElementById(hostId);
    if (config.action === "show") {
      const currentIssuedAt = Number(host?.dataset.operationIssuedAt || 0);
      if (host?.dataset.operationToken !== config.token && currentIssuedAt > issuedAt(config.token)) {
        return { visible: false, stale: true };
      }
      removeHost("", true);
      host = document.createElement("div");
      host.id = hostId;
      host.dataset.operationToken = config.token;
      host.dataset.operationIssuedAt = String(issuedAt(config.token));
      host.dataset.state = config.state;
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-atomic", "true");
      const rgb = getComputedStyle(document.body || document.documentElement).backgroundColor.match(/\\d+(?:\\.\\d+)?/g)?.map(Number);
      const light = rgb?.length >= 3
        ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 150
        : matchMedia("(prefers-color-scheme: light)").matches;
      host.dataset.tone = light ? "light" : "dark";
      positionInMainArea(host);
      const shadow = host.attachShadow({ mode: "open" });
      const styleNode = document.createElement("style");
      styleNode.textContent = css;
      const statusNode = document.createElement("div");
      statusNode.className = "status";
      const indicator = document.createElement("span");
      indicator.className = "indicator";
      indicator.setAttribute("aria-hidden", "true");
      const messageNode = document.createElement("span");
      messageNode.className = "message";
      messageNode.textContent = config.message;
      statusNode.append(indicator, messageNode);
      shadow.append(styleNode, statusNode);
      document.documentElement.append(host);
      const registry = {
        token: config.token,
        startedAt: Date.now(),
        showTimer: null,
        expiryTimer: null,
        terminalTimer: null,
      };
      registry.showTimer = setTimeout(() => {
        const current = document.getElementById(hostId);
        if (current?.dataset.operationToken === config.token) current.dataset.visible = "true";
      }, revealDelayMs);
      registry.expiryTimer = setTimeout(() => removeHost(config.token), stateTtl(config.state));
      window[registryKey] = registry;
      return { visible: true, state: config.state };
    }
    if (!host || host.dataset.operationToken !== config.token) {
      return { visible: false, stale: true };
    }
    const registry = window[registryKey];
    clearTimer(registry?.terminalTimer);
    clearTimer(registry?.expiryTimer);
    positionInMainArea(host);
    const terminal = config.state === "success" || config.state === "error" || config.state === "cancelled";
    const remainingLoadingMs = terminal && host.dataset.state === "loading" && registry?.startedAt
      ? Math.max(0, registry.startedAt + minimumLoadingMs - Date.now())
      : 0;
    if (remainingLoadingMs > 0 && registry?.token === config.token) {
      registry.terminalTimer = setTimeout(() => {
        const current = document.getElementById(hostId);
        const currentRegistry = window[registryKey];
        if (current?.dataset.operationToken !== config.token || currentRegistry?.token !== config.token) return;
        current.dataset.state = config.state;
        current.dataset.visible = "true";
        const currentMessage = current.shadowRoot?.querySelector(".message");
        if (currentMessage) currentMessage.textContent = config.message;
        clearTimer(currentRegistry.expiryTimer);
        currentRegistry.expiryTimer = setTimeout(() => removeHost(config.token), stateTtl(config.state));
      }, remainingLoadingMs);
      return { visible: true, state: "loading", deferred: true };
    }
    host.dataset.state = config.state;
    host.dataset.visible = "true";
    const messageNode = host.shadowRoot?.querySelector(".message");
    if (messageNode) messageNode.textContent = config.message;
    if (registry?.token === config.token) {
      registry.expiryTimer = setTimeout(() => removeHost(config.token), stateTtl(config.state));
    }
    return { visible: true, state: config.state };
  })()`;
}


export async function bindMediaFileToSession(session, loadedPayload, timeoutMs = 10000) {
  if (!loadedPayload?.mediaFilePath) return true;
  const deadline = Date.now() + timeoutMs;
  const revision = JSON.stringify(loadedPayload.revision);
  while (Date.now() < deadline) {
    const result = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const state = window.__CODEX_DREAM_SKIN_STATE__;
        if (state?.revision !== ${revision}) return null;
        return document.getElementById("codex-dream-skin-media-file");
      })()`,
      returnByValue: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Media file bridge lookup failed: ${detail}`);
    }
    const objectId = result.result?.objectId;
    if (!objectId) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try {
      await session.send("DOM.setFileInputFiles", {
        files: [loadedPayload.mediaFilePath],
        objectId,
      });
    } finally {
      await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
    const bound = await session.evaluate(`(() => {
      const state = window.__CODEX_DREAM_SKIN_STATE__;
      return state?.revision === ${revision} && Boolean(state.bindMediaFile?.());
    })()`);
    if (!bound) throw new Error("Renderer rejected the validated media file bridge");
    while (Date.now() < deadline) {
      const status = await session.evaluate(`(() => {
        const state = window.__CODEX_DREAM_SKIN_STATE__;
        if (state?.revision !== ${revision}) return { stale: true };
        if (state.mediaType === "image") return { error: state.imageError, ready: state.imageReady };
        const video = state.videoLayer;
        return {
          error: state.videoError || null,
          ready: Boolean(video && video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0),
        };
      })()`);
      if (status?.stale) throw new Error("Renderer changed while binding the media file bridge");
      if (status?.error) throw new Error(`Media loading failed: ${status.error}`);
      if (status?.ready) {
        if (loadedPayload.theme?.art?.shellOpacity !== undefined) await applyShellOpacityToSession(session, loadedPayload);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    break;
  }
  throw new Error("Timed out waiting for the renderer media file bridge to load");
}

function updateShellOpacity({ themeId, revision, shellOpacity }) {
  const state = window.__CODEX_DREAM_SKIN_STATE__;
  const root = document.documentElement;
  if (!state || state.themeId !== themeId || state.revision !== revision ||
      window.__CODEX_DREAM_SKIN_DISABLED__ || !root || root.getAttribute("data-dream-skin") !== "active") {
    throw new Error("The renderer changed before shell opacity could be verified.");
  }
  if (shellOpacity !== undefined && (typeof shellOpacity !== "number" || !Number.isFinite(shellOpacity) || shellOpacity < 0 || shellOpacity > 1)) {
    throw new Error("Shell opacity must be between 0 and 1.");
  }
  const hadOverride = Object.hasOwn(state, "shellOpacity");
  const result = { applied: true, themeId, revision, shellOpacity: shellOpacity ?? null,
    shellOpacityVerified: true, shellVeilVerified: false, shellVeilAlpha: null };
  if (shellOpacity === undefined && !hadOverride) return result;
  if (shellOpacity !== undefined && (typeof CSS !== "object" ||
      !CSS.supports("background-color", "light-dark(rgb(0 0 0 / .5), rgb(255 255 255 / .5))"))) {
    throw new Error("This renderer does not support light-dark shell opacity.");
  }
  const property = "--ds-shell-background";
  const previous = root.style.getPropertyValue(property);
  const priority = root.style.getPropertyPriority(property);
  const previousOpacity = state.shellOpacity;
  const owner = state.shellOpacityOverride;
  if (hadOverride && (!owner || typeof owner.value !== "string" ||
      typeof owner.baseline?.value !== "string" || typeof owner.baseline?.priority !== "string" ||
      previous !== owner.value || priority !== "")) {
    throw new Error("The shell opacity override was changed by another owner.");
  }
  const baseline = hadOverride ? owner.baseline : { value: previous, priority };
  const value = shellOpacity === undefined ? baseline.value :
    `light-dark(rgb(var(--ds-panel-rgb) / ${shellOpacity}), rgb(var(--ds-bg-rgb) / ${shellOpacity}))`;
  const nextPriority = shellOpacity === undefined ? baseline.priority : "";
  try {
    if (value) root.style.setProperty(property, value, nextPriority);
    else root.style.removeProperty(property);
    if (root.style.getPropertyValue(property).trim() !== value.trim() ||
        root.style.getPropertyPriority(property) !== nextPriority ||
        !getComputedStyle(root).getPropertyValue(property).trim()) {
      throw new Error("The shell opacity token did not read back correctly.");
    }
    const veil = document.body ? getComputedStyle(document.body, "::before") : null;
    const taskMode = root.getAttribute("data-dream-task-mode") || root.getAttribute("data-dream-art-task-mode");
    if (root.getAttribute("data-dream-art-wide") === "true" && taskMode !== "off" &&
        veil && veil.content !== "none" && veil.content !== "normal" && veil.display !== "none") {
      const color = veil.backgroundColor.trim();
      const channel = color.match(/\/\s*([0-9.]+%?)\s*\)$/)?.[1] ??
        color.match(/^rgba\([^)]*,\s*([0-9.]+%?)\s*\)$/i)?.[1];
      const alpha = channel !== undefined ? Number.parseFloat(channel) / (channel.endsWith("%") ? 100 : 1)
        : color === "transparent" ? 0 : /^(?:rgb|color|lab|lch|oklab|oklch)\(/i.test(color) ? 1 : NaN;
      const expectedAlpha = shellOpacity ?? (baseline.value ? null :
        root.getAttribute("data-dream-shell") === "light" ? 0.64 : 0.58);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1 ||
          expectedAlpha !== null && Math.abs(alpha - expectedAlpha) > 0.001) {
        throw new Error("The visible shell veil did not use the requested opacity.");
      }
      result.shellVeilVerified = expectedAlpha !== null;
      result.shellVeilAlpha = alpha;
    }
    if (shellOpacity === undefined) {
      delete state.shellOpacity;
      delete state.shellOpacityOverride;
    } else {
      state.shellOpacity = shellOpacity;
      state.shellOpacityOverride = { baseline, value };
    }
    if (Object.hasOwn(state, "shellOpacity") !== (shellOpacity !== undefined) ||
        state.shellOpacity !== shellOpacity) throw new Error("The shell opacity state did not read back correctly.");
    return result;
  } catch (error) {
    if (previous) root.style.setProperty(property, previous, priority);
    else root.style.removeProperty(property);
    if (hadOverride) {
      state.shellOpacity = previousOpacity;
      state.shellOpacityOverride = owner;
    } else {
      delete state.shellOpacity;
      delete state.shellOpacityOverride;
    }
    throw error;
  }
}

async function applyShellOpacityToSession(session, loadedPayload) {
  const shellOpacity = loadedPayload.theme?.art?.shellOpacity;
  const request = { themeId: loadedPayload.theme.id, revision: loadedPayload.revision,
    ...(shellOpacity === undefined ? {} : { shellOpacity }) };
  const result = await session.evaluate(`(() => {
    const request = ${JSON.stringify(request)};
    try {
      const result = (${updateShellOpacity.toString()})(request);
      const state = window.__CODEX_DREAM_SKIN_STATE__;
      if (state?.themeId === request.themeId && state.revision === request.revision) delete state.opacityUpdateFailed;
      return result;
    } catch (error) {
      const state = window.__CODEX_DREAM_SKIN_STATE__;
      if (state?.themeId === request.themeId && state.revision === request.revision) state.opacityUpdateFailed = true;
      throw error;
    }
  })()`);
  if (result?.applied !== true || result.themeId !== request.themeId || result.revision !== request.revision ||
      result.shellOpacityVerified !== true || result.shellOpacity !== (shellOpacity ?? null)) {
    throw new Error("The shell opacity update did not verify.");
  }
  return result;
}

function updateVideoOpacityWithShell(request, shellRequest, applyShell) {
  const state = window.__CODEX_DREAM_SKIN_STATE__;
  const root = document.documentElement;
  if (!state || !root || typeof state.updateVideoOpacity !== "function") return false;
  const readOpacity = (name) => {
    const value = root.style.getPropertyValue(name).trim();
    return value ? Number(value) : NaN;
  };
  const previous = { themeId: request.themeId, opacityUpdateKey: request.opacityUpdateKey,
    revision: state.revision, bubbleOpacity: readOpacity("--ds-bubble-opacity"), surfaceOpacity: readOpacity("--ds-surface-opacity") };
  if (typeof previous.revision !== "string" || !/^[a-f0-9]{20}$/.test(previous.revision) ||
      ![previous.bubbleOpacity, previous.surfaceOpacity].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return false;
  const hadFailure = Object.hasOwn(state, "opacityUpdateFailed");
  const previousFailure = state.opacityUpdateFailed;
  const applied = state.updateVideoOpacity(request);
  if (applied?.applied !== true || applied.themeId !== request.themeId || applied.revision !== request.revision) return false;
  try {
    const result = applyShell(shellRequest);
    delete state.opacityUpdateFailed;
    return result;
  } catch (error) {
    let restored = false;
    if (window.__CODEX_DREAM_SKIN_STATE__ === state && document.documentElement === root) {
      state.opacityUpdateFailed = true;
      try {
        const rollback = state.updateVideoOpacity(previous);
        restored = rollback?.applied === true && rollback.themeId === previous.themeId && rollback.revision === previous.revision &&
          state.revision === previous.revision && readOpacity("--ds-bubble-opacity") === previous.bubbleOpacity &&
          readOpacity("--ds-surface-opacity") === previous.surfaceOpacity;
      } catch {}
    }
    if (!restored) throw new Error("The shell opacity update failed and its rollback could not be verified; no video reload was attempted.");
    if (hadFailure) state.opacityUpdateFailed = previousFailure;
    else delete state.opacityUpdateFailed;
    throw error;
  }
}

export async function applyLoadedToSession(session, loadedPayload, { opacityOnly = false } = {}) {
  const shellOpacity = loadedPayload.theme?.art?.shellOpacity;
  if (shellOpacity !== undefined && (typeof shellOpacity !== "number" || !Number.isFinite(shellOpacity) || shellOpacity < 0 || shellOpacity > 1)) {
    throw new Error("Shell opacity must be between 0 and 1.");
  }
  if (shellOpacity !== undefined) {
    if (await session.evaluate('typeof CSS === "object" && CSS.supports("background-color", "light-dark(rgb(0 0 0 / .5), rgb(255 255 255 / .5))")') !== true) {
      throw new Error("This renderer does not support light-dark shell opacity.");
    }
  }
  if (loadedPayload.theme?.artMetadata?.video && typeof loadedPayload.theme.opacityUpdateKey === "string") {
    const request = { themeId: loadedPayload.theme.id, opacityUpdateKey: loadedPayload.theme.opacityUpdateKey, revision: loadedPayload.revision,
      bubbleOpacity: loadedPayload.theme.art?.bubbleOpacity ?? 0, surfaceOpacity: loadedPayload.theme.art?.surfaceOpacity ?? 0.3 };
    const shellRequest = { themeId: request.themeId, revision: request.revision,
      ...(shellOpacity === undefined ? {} : { shellOpacity }) };
    const result = await session.evaluate(`(${updateVideoOpacityWithShell.toString()})(${JSON.stringify(request)}, ${JSON.stringify(shellRequest)}, ${updateShellOpacity.toString()})`);
    if (result?.applied === true) {
      if (result.themeId !== request.themeId || result.revision !== request.revision ||
          result.shellOpacityVerified !== true || result.shellOpacity !== (shellOpacity ?? null)) {
        throw new Error("The in-place opacity update did not verify.");
      }
      return result;
    }
  }
  if (opacityOnly) throw new Error("The current video cannot be updated in place; no video reload or Codex restart was attempted.");
  if (loadedPayload.theme?.artMetadata?.video) await probeVideoDecode(session, loadedPayload.mediaFilePath);
  await session.evaluate(loadedPayload.payload);
  await bindMediaFileToSession(session, loadedPayload);
  return applyShellOpacityToSession(session, loadedPayload);
}


export async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    let cleaned = false;
    try { cleaned = Boolean(state?.cleanup && state.cleanup()); } catch {}
    if (cleaned) return true;
    const root = document.documentElement;
    for (const attribute of [...(root?.attributes || [])]) {
      if (attribute.name.startsWith('data-dream-')) root.removeAttribute(attribute.name);
    }
    for (const property of [...(root?.style || [])]) {
      if (property.startsWith('--dream-') || property.startsWith('--ds-')) {
        root.style.removeProperty(property);
      }
    }
    for (const node of document.querySelectorAll('[data-ds-part]')) {
      node.removeAttribute('data-ds-part');
    }
    const sheets = window.__CODEX_DREAM_SKIN_STYLE_SHEETS__;
    if (sheets && 'adoptedStyleSheets' in document) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets]
        .filter((sheet) => !sheets.has(sheet));
    }
    delete window.__CODEX_DREAM_SKIN_STYLE_SHEETS__;
    try { if (state?.artUrl) URL.revokeObjectURL(state.artUrl); } catch {}
    document.getElementById('codex-dream-skin-style')?.remove();
    delete window.__CODEX_DREAM_SKIN_STATE__;
    return true;
  })()`);
}

export async function verifyRemovedSession(session) {
  return session.evaluate(`(() => {
    const root = document.documentElement;
    const hasAttributes = [...root.attributes].some((attribute) =>
      attribute.name.startsWith('data-dream-'));
    const hasVariables = [...root.style].some((property) =>
      property.startsWith('--dream-') || property.startsWith('--ds-'));
    const hasParts = Boolean(document.querySelector('[data-ds-part]'));
    const sheets = window.__CODEX_DREAM_SKIN_STYLE_SHEETS__;
    const hasSheets = Boolean(sheets?.size && 'adoptedStyleSheets' in document &&
      [...document.adoptedStyleSheets].some((sheet) => sheets.has(sheet)));
    return !hasAttributes && !hasVariables && !hasParts && !hasSheets &&
      !document.getElementById('codex-dream-skin-style') &&
      !window.__CODEX_DREAM_SKIN_STATE__;
  })()`);
}

export async function cleanupExcludedSurface(session) {
  if (!await removeFromSession(session)) return false;
  return verifyRemovedSession(session);
}
