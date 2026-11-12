import { readMp4VideoTrack } from './image-metadata.mjs';

// Claude Code's inspected DOM is an application detail, not a stable public API.
// Keep source construction separate so fixtures can exercise it without Electron.
export function claudeBackgroundLayout(image, viewport, parameters) {
  const finite = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
  const framing = parameters.framingEnabled ?? [parameters.positionX, parameters.positionY, parameters.zoom, parameters.positionMode].some(value => value != null);
  const scale = Math.max(viewport.width / image.width, viewport.height / image.height) * (framing ? finite(parameters.zoom, 1, 1, 2) : 1);
  const width = image.width * scale, height = image.height * scale;
  if (!framing) return { width, height, x: (viewport.width - width) * finite(parameters.focusX, .5, 0, 1), y: (viewport.height - height) * finite(parameters.focusY, .5, 0, 1) };
  const free = parameters.positionMode === 'free';
  return { width, height,
    x: (viewport.width - width) / 2 + finite(parameters.positionX, 0, -1, 1) * (free ? (width + viewport.width) / 2 : Math.max(0, (width - viewport.width) / 2)),
    y: (viewport.height - height) / 2 + finite(parameters.positionY, 0, -1, 1) * (free ? (height + viewport.height) / 2 : Math.max(0, (height - viewport.height) / 2)) };
}

// Decode supplied bytes directly: Claude's media-src policy rejects data/blob
// video URLs. No media URL or application content policy is changed.
export async function loadClaudeVideo(payload, signal, options = {}) {
  const track = payload.videoTrack;
  if (!globalThis.VideoDecoder || !globalThis.EncodedVideoChunk) throw new Error('Desktop video requires WebCodecs support.');
  const config = { ...track.config, description: new Uint8Array(track.config.description) };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`Desktop video codec is not supported: ${config.codec}.`);
  if (signal.aborted) throw new Error('Desktop media request was superseded.');
  const bytes = Uint8Array.from(atob(payload.mediaBase64), character => character.charCodeAt(0));
  const element = document.createElement('canvas');
  const rotate = track.rotate ?? 0;
  const swapped = rotate === 90 || rotate === 270;
  element.width = swapped ? track.height : track.width;
  element.height = swapped ? track.width : track.height;
  const context = element.getContext('2d');
  if (!context) throw new Error('Desktop video canvas could not be created.');
  const rate = payload.parameters.playbackRate ?? 1;
  let decoder, disposed = false, failure = null, frames = [], index = 0;
  let animation = 0, cycle = 0, flushing = false, drained = false, startedAt = null, firstDrawn = false;
  let pausedAt = document.hidden ? performance.now() : null;
  let resolveFirst, rejectFirst;
  const firstFrame = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const stopWaiting = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
  const dispose = () => {
    if (disposed) return;
    disposed = true; cycle++;
    stopWaiting(); cancelAnimationFrame(animation); animation = 0;
    document.removeEventListener('visibilitychange', visibilityChanged);
    if (decoder && decoder.state !== 'closed') decoder.close();
    for (const frame of frames) frame.close();
    frames = []; element.remove();
  };
  const failed = error => {
    if (disposed) return;
    failure = new Error(`Desktop video decode/playback failed (${config.codec}): ${error?.message ?? error}`);
    if (!firstDrawn) rejectFirst(failure);
    dispose();
    options.onError?.(failure);
  };
  const aborted = () => failed(new Error('Desktop media request was superseded.'));
  const timer = setTimeout(() => failed(new Error('first frame deadline exceeded')), 6000);
  signal.addEventListener('abort', aborted, { once: true });
  const drawFrame = frame => {
    try {
      context.save();
      if (rotate === 90) { context.translate(element.width, 0); context.rotate(Math.PI / 2); }
      else if (rotate === 180) { context.translate(element.width, element.height); context.rotate(Math.PI); }
      else if (rotate === 270) { context.translate(0, element.height); context.rotate(-Math.PI / 2); }
      context.drawImage(frame, 0, 0, track.width, track.height);
    } finally { try { context.restore(); } finally { frame.close(); } }
    if (!firstDrawn) { firstDrawn = true; stopWaiting(); resolveFirst(); }
  };
  const pump = () => {
    if (disposed || flushing || drained || (document.hidden && firstDrawn)) return;
    try {
      // Bound both compressed work and decoded frames. Decoder-internal frame
      // reordering can additionally retain a codec-defined picture buffer.
      while (index < track.samples.length && decoder.decodeQueueSize < 4 && frames.length < 6) {
        const sample = track.samples[index++];
        decoder.decode(new EncodedVideoChunk({ type: sample.key ? 'key' : 'delta', timestamp: sample.timestamp,
          duration: sample.duration, data: bytes.subarray(sample.offset, sample.offset + sample.size) }));
      }
      if (index === track.samples.length) {
        flushing = true;
        const currentCycle = cycle;
        decoder.flush().then(() => {
          if (!disposed && cycle === currentCycle) { flushing = false; drained = true; }
        }, error => { if (!disposed && cycle === currentCycle) failed(error); });
      }
    } catch (error) { failed(error); }
  };
  const beginCycle = () => {
    if (decoder && decoder.state !== 'closed') decoder.close();
    cycle++; index = 0; flushing = false; drained = false; startedAt = null;
    const currentCycle = cycle;
    decoder = new VideoDecoder({
      output(frame) {
        if (disposed || cycle !== currentCycle || frame.timestamp < 0 || frame.timestamp >= track.duration) { frame.close(); return; }
        if (document.hidden && !firstDrawn) {
          try { drawFrame(frame); } catch (error) { failed(error); }
          return;
        }
        frames.push(frame); frames.sort((left, right) => left.timestamp - right.timestamp);
      },
      error(error) { if (!disposed && cycle === currentCycle) failed(error); },
    });
    decoder.addEventListener('dequeue', () => {
      if (!disposed && cycle === currentCycle && document.hidden && !firstDrawn) pump();
    });
    decoder.configure(config);
    pump();
  };
  const tick = now => {
    animation = 0;
    if (disposed || document.hidden) return;
    try {
      if (startedAt === null && (frames.length || (firstDrawn && cycle === 1))) startedAt = now;
      const timestamp = startedAt === null ? 0 : (now - startedAt) * 1000 * rate;
      let visible;
      while (frames.length && frames[0].timestamp <= timestamp) {
        visible?.close(); visible = frames.shift();
      }
      if (visible) drawFrame(visible);
      pump();
      if (!disposed && drained && !frames.length && timestamp >= track.duration) {
        if (options.loop === false) { dispose(); options.onEnded?.(); }
        else beginCycle();
      }
      if (!disposed) animation = requestAnimationFrame(tick);
    } catch (error) { failed(error); }
  };
  const visibilityChanged = () => {
    if (disposed) return;
    try {
      if (document.hidden) {
        pausedAt ??= performance.now();
        cancelAnimationFrame(animation); animation = 0;
        if (!firstDrawn && frames.length) drawFrame(frames.shift());
        pump();
      } else {
        if (startedAt !== null && pausedAt !== null) startedAt += performance.now() - pausedAt;
        pausedAt = null;
        pump();
        if (!disposed && !animation) animation = requestAnimationFrame(tick);
      }
    } catch (error) { failed(error); }
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  try { beginCycle(); if (!disposed && !document.hidden) animation = requestAnimationFrame(tick); }
  catch (error) { failed(error); }
  await firstFrame;
  if (disposed) throw failure;
  return { element, width: element.width, height: element.height, dispose, healthy: () => !disposed && !failure && firstDrawn };
}

// Native images preserve GIF/WebP animation. A failed or cancelled decode
// never replaces the current background.
export async function loadClaudeMedia(payload, signal, loadVideo = loadClaudeVideo) {
  if (payload.mediaKind === 'video') return loadVideo(payload, signal);
  const element = document.createElement('img');
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    element.removeAttribute('src');
    element.remove();
  };
  element.alt = '';
  try {
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        element.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      };
      const aborted = () => { finish(new Error('Desktop media request was superseded.')); dispose(); };
      const failed = () => finish(new Error('Desktop media decode failed or was blocked by the application content policy.'));
      const timer = setTimeout(() => finish(new Error('Desktop media decode/play deadline exceeded.')), 6000);
      signal.addEventListener('abort', aborted, { once: true });
      element.addEventListener('error', failed, { once: true });
      if (signal.aborted) { aborted(); return; }
      element.src = `data:${payload.mimeType};base64,${payload.mediaBase64}`;
      element.decode().then(() => {
        if (element.naturalWidth > 0 && element.naturalHeight > 0) finish(); else failed();
      }, failed);
    });
    return { element, width: element.naturalWidth, height: element.naturalHeight, dispose,
      healthy: () => !disposed && element.complete && element.naturalWidth > 0 };
  } catch (error) { dispose(); throw error; }
}

export async function claudeRendererOperation(action, payload, layout, loadMedia, loadVideo, target = 'claude') {
  const namespace = target === 'dsh' ? 'Dsh' : 'Claude';
  const key = `__dreamskin${namespace}RuntimeV1`;
  const pendingKey = `__dreamskin${namespace}PendingV1`;
  const readyKey = `__dreamskin${namespace}ReadyV1`;
  const startupKey = `__dreamskin${namespace}StartupV1`;
  const marker = `data-dreamskin-${target}-v1`;
  const validBoundary = () => (target === 'dsh'
    ? location.protocol === 'dsh-app:' && location.hostname === 'app' && location.pathname === '/'
    : location.protocol === 'app:' && location.hostname === 'localhost' &&
    (location.pathname === '/epitaxy' || location.pathname.startsWith('/epitaxy/')) &&
    [...document.querySelectorAll('iframe,webview')].every(frame => window[startupKey]?.frames.has(frame))) && window.top === window;
  const validPage = () => validBoundary() && (target === 'dsh' ? !!document.querySelector('#root')?.firstElementChild
    : !!document.querySelector('main.dframe-content') && !!document.querySelector('aside.dframe-sidebar') && !!document.querySelector('.dframe-root'));
  const removeStartup = () => window[startupKey]?.remove();
  const cancelReady = () => { window[readyKey]?.abort(); delete window[readyKey]; };
  if (action === 'cancelReady' || action === 'removeStartup') {
    cancelReady();
    if (action === 'removeStartup') removeStartup();
    return { renderer: 'removed', revision: null };
  }
  if (action === 'ready') {
    cancelReady();
    if (validPage()) return true;
    return new Promise(resolve => {
      const generation = new AbortController();
      window[readyKey] = generation;
      const observer = new MutationObserver(() => { if (validPage()) finish(true); });
      const finish = ready => {
        clearTimeout(timer); observer.disconnect();
        if (window[readyKey] === generation) delete window[readyKey];
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), 2000);
      generation.signal.addEventListener('abort', () => finish(false), { once: true });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
  const current = window[key];
  const generation = action === 'inspect' ? null : new AbortController();
  if (generation) cancelReady();
  if (generation) { window[pendingKey]?.abort(); window[pendingKey] = generation; }
  const releasePending = () => { if (window[pendingKey] === generation) delete window[pendingKey]; };
  if (action === 'remove') {
    try { current?.remove(); removeStartup(); } finally { releasePending(); }
    return { renderer: window[key] ? 'unknown' : 'removed', revision: null };
  }
  if (!(action === 'inspect' && current ? validBoundary() : validPage())) {
    if (generation) releasePending();
    return { renderer: 'unavailable', revision: null };
  }
  if (action === 'inspect') {
    const applied = current?.active();
    const startup = window[startupKey];
    const startupStatus = startup?.api.status();
    return { renderer: applied ? 'applied' : current ? 'unknown' : 'removed', revision: applied ? current.revision : null,
      error: startupStatus && ['failed', 'timeout'].includes(startupStatus.phase) ? `${namespace === 'Dsh' ? 'DSH' : 'Claude'} startup animation ${startupStatus.phase}.` : null };
  }
  let media;
  let installed = false;
  try {
    media = await loadMedia(payload, generation.signal, loadVideo);
    if (window[pendingKey] !== generation) return { renderer: 'unknown', revision: null };
    if (!validPage()) return { renderer: 'unavailable', revision: null };
    const background = document.createElement('div');
    background.setAttribute('aria-hidden', 'true');
    background.setAttribute(marker, 'background');
    const mask = document.createElement('div');
    Object.assign(mask.style, { position: 'absolute', inset: '0' });
    Object.assign(media.element.style, { position: 'absolute', maxWidth: 'none', maxHeight: 'none' });
    background.append(media.element, mask);
    const style = document.createElement('style');
    style.setAttribute(marker, 'style');
    const p = payload.parameters;
    const darkQuery = matchMedia('(prefers-color-scheme: dark)');
    const draw = () => {
      const dark = p.appearance === 'dark' || (p.appearance !== 'light' && darkQuery.matches);
      const color = dark ? '24,24,28' : '248,247,244';
      const shell = p.shellOpacity ?? (dark ? .58 : .64);
      const surface = p.surfaceOpacity ?? .3;
      const box = layout(media, { width: innerWidth, height: innerHeight }, p);
      Object.assign(media.element.style, { width: `${box.width}px`, height: `${box.height}px`, left: `${box.x}px`, top: `${box.y}px` });
      background.style.background = `rgb(${color})`;
      mask.style.background = `rgba(${color},${shell})`;
      const surfaces = target === 'dsh' ? `
html[${marker}="active"] body,
html[${marker}="active"] #root { background: transparent !important; }
html[${marker}="active"] body,
html[${marker}="active"] #root,
html[${marker}="active"] #root * {
  --dsw-alias-bg-base: transparent !important;
  --dsw-specific-sidebar-fill: rgba(${color},${surface * .5}) !important;
  --dsw-specific-input-major: rgba(${color},${surface}) !important;
}
` : `
html[${marker}="active"] body,
html[${marker}="active"] #root,
html[${marker}="active"] .dframe-root,
html[${marker}="active"] .dframe-content,
html[${marker}="active"] .dframe-content-inner,
html[${marker}="active"] .dframe-content-inner::before,
html[${marker}="active"] .dframe-content .tiles-shell,
html[${marker}="active"] .dframe-content .epitaxy-chat-panel,
html[${marker}="active"] .dframe-content .epitaxy-chat-panel-body,
html[${marker}="active"] .bg-surface-1:has(.dframe-root) { background: transparent !important; }
html[${marker}="active"] .dframe-sidebar { background: rgba(${color},${surface * .5}) !important; }
html[${marker}="active"] .dframe-content .epitaxy-chat-panel { --epitaxy-transcript-surface: transparent !important; }
html[${marker}="active"] .epitaxy-chat-panel .scroll-fade-strip-top { background: none !important; }
html[${marker}="active"] .epitaxy-chat-panel .epitaxy-prompt .rounded-composer,
html[${marker}="active"] .epitaxy-chat-panel .epitaxy-summary-card-control-text,
html[${marker}="active"] .epitaxy-chat-panel .epitaxy-codeblock .epitaxy-fence { background: rgba(${color},${surface}) !important; }
`;
      style.textContent = `
html[${marker}="active"] { background: transparent !important; isolation: isolate; }
html[${marker}="active"] > div[${marker}="background"] { position: fixed !important; inset: 0 !important; overflow: hidden !important; pointer-events: none !important; z-index: -1 !important; }
${surfaces}
`;
    };
    draw();
    // No async boundary between the generation check and ownership transfer.
    window[key]?.remove();
    const previousMarker = document.documentElement.getAttribute(marker);
    document.head.append(style);
    document.documentElement.prepend(background);
    document.documentElement.setAttribute(marker, 'active');
    const remove = () => {
      observer.disconnect();
      removeEventListener('resize', draw);
      removeEventListener('popstate', routeChanged);
      removeEventListener('hashchange', routeChanged);
      darkQuery.removeEventListener('change', draw);
      style.remove(); background.remove(); media.dispose();
      if (document.documentElement.getAttribute(marker) === 'active') {
        if (previousMarker === null) document.documentElement.removeAttribute(marker);
        else document.documentElement.setAttribute(marker, previousMarker);
      }
      if (window[key] === state) delete window[key];
    };
    // Session switches rebuild the shell while the route remains in Code.
    const routeChanged = () => { if (!validBoundary()) remove(); };
    const observer = new MutationObserver(routeChanged);
    const state = { remove, revision: payload.revision, active: () => validBoundary() && background.isConnected && style.isConnected && media.healthy() &&
      document.documentElement.getAttribute(marker) === 'active' && !!style.sheet?.cssRules.length };
    window[key] = state; installed = true;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('resize', draw);
    addEventListener('popstate', routeChanged);
    addEventListener('hashchange', routeChanged);
    darkQuery.addEventListener('change', draw);
    return { renderer: state.active() ? 'applied' : 'unknown', revision: state.revision };
  } finally { if (!installed) media?.dispose(); releasePending(); }
}

function prepareClaudePayload(payload) {
  if (payload?.mediaKind !== 'video') return payload;
  const bytes = Uint8Array.from(atob(payload.mediaBase64), character => character.charCodeAt(0));
  const videoTrack = readMp4VideoTrack(bytes);
  if (!videoTrack) throw new Error('Desktop MP4 video track could not be prepared for playback.');
  return { ...payload, videoTrack };
}

export function buildClaudeRendererSource(action, payload = null, target = 'claude') {
  if (!['inspect', 'apply', 'remove', 'removeStartup', 'ready', 'cancelReady'].includes(action)) throw new Error('Unsupported Claude renderer operation.');
  return `(${claudeRendererOperation.toString()})(${JSON.stringify(action)},${JSON.stringify(prepareClaudePayload(payload))},${claudeBackgroundLayout.toString()},${loadClaudeMedia.toString()},${loadClaudeVideo.toString()},${JSON.stringify(target)})`;
}

function installClaudeStartupVideo(payload, loadVideo) {
  if (window.top !== window || !document.body) return { installed: false };
  window.__aemeathExtension?.dispose();
  const generation = new AbortController();
  const priorFocus = document.activeElement;
  let overlay = document.createElement('div'), media = null;
  let ready = false, completed = false, phase = 'loading', disposed = false, finished = false;
  const cleanup = () => {
    if (!overlay) return;
    clearTimeout(watchdog);
    window.removeEventListener('keydown', keyboard, true);
    generation.abort(); media?.dispose();
    overlay?.remove(); overlay = null;
    if (priorFocus?.isConnected) priorFocus.focus();
  };
  const finish = (next = 'complete') => {
    if (disposed || finished) return;
    finished = true; completed = next === 'complete'; phase = next; cleanup();
  };
  const keyboard = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; cleanup();
    if (window.__aemeathExtension === api) delete window.__aemeathExtension;
  };
  const watchdog = setTimeout(() => finish('timeout'), 75000);
  Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483646', background: '#000', display: 'grid', placeItems: 'center' });
  const skip = document.createElement('button');
  skip.textContent = document.documentElement.lang.startsWith('zh') ? '跳过 · Esc' : 'Skip · Esc';
  Object.assign(skip.style, { position: 'absolute', right: '24px', bottom: '24px', padding: '8px 14px', border: '1px solid #ffffff66', borderRadius: '6px', background: '#0009', color: '#fff', cursor: 'pointer', font: '13px system-ui' });
  skip.addEventListener('click', () => finish());
  overlay.append(skip);
  const api = { dispose, status: () => ({ ready, completed, phase, overlay: !!overlay }) };
  window.__aemeathExtension = api;
  window.addEventListener('keydown', keyboard, true);
  document.body.append(overlay);
  skip.focus();
  void loadVideo(payload, generation.signal, { loop: false, onEnded: () => finish(), onError: () => finish('failed') }).then(loaded => {
    if (disposed || finished) { loaded.dispose(); return; }
    media = loaded;
    Object.assign(media.element.style, { position: 'absolute', width: '100%', height: '100%', objectFit: 'contain' });
    overlay.prepend(media.element);
    ready = true; phase = 'playing';
  }, () => finish('failed'));
  return { installed: true };
}

export function buildClaudeStartupVideoSource(video, target = 'claude') {
  const payload = prepareClaudePayload({ ...video, mediaKind: 'video', parameters: { playbackRate: 1 } });
  return buildClaudeStartupSource(`(${installClaudeStartupVideo.toString()})(${JSON.stringify(payload)},${loadClaudeVideo.toString()})`, target);
}

export function buildClaudeStartupSource(source, target = 'claude') {
  return `(()=>{
    const key=${JSON.stringify(target === 'dsh' ? '__dreamskinDshStartupV1' : '__dreamskinClaudeStartupV1')};
    const owned=window[key];
    if(owned)return {installed:true,alreadyActive:true};
    if(window.__aemeathExtension)throw new Error('Another startup animation already owns this page.');
    const before=new Set(document.querySelectorAll('iframe,webview'));
    const result=${source};
    if(!result?.installed)throw new Error('Desktop startup animation was not installed.');
    const api=window.__aemeathExtension;
    const state={api,frames:new Set([...document.querySelectorAll('iframe')].filter(frame=>!before.has(frame))),remove(){
      const other=window.__aemeathExtension;
      api.dispose();
      if(other&&other!==api)window.__aemeathExtension=other;
      if(window[key]===state)delete window[key];
    }};
    window[key]=state;
    return result;
  })()`;
}

// Lives in Claude's main process so closing the manager transport does not
// disable a user's selected appearance. All listeners and sources are owned.
export function installClaudeMainController(electron, rendererSource, target = 'claude') {
  const namespace = target === 'dsh' ? 'Dsh' : 'Claude';
  const key = `__dreamskin${namespace}ControllerV1`;
  const dispatchKey = `__dreamskin${namespace}DispatchV1`;
  if (globalThis[key]) return globalThis[key];
  const records = new Map();
  let desired = null, startupSource = null, epoch = 0, disposed = false, commanding = false;
  const eligible = (page, anyRoute = false) => {
    if (page.isDestroyed() || page.getType() !== 'window') return false;
    try {
      const url = new URL(page.getURL());
      return target === 'dsh' ? url.protocol === 'dsh-app:' && url.hostname === 'app' && url.pathname === '/'
        : url.protocol === 'app:' && url.hostname === 'localhost' && (anyRoute || url.pathname === '/epitaxy' || url.pathname.startsWith('/epitaxy/'));
    }
    catch { return false; }
  };
  const run = async record => {
    if (disposed || commanding || record.running) { record.dirty = true; return; }
    record.running = true; record.dirty = false;
    const generation = epoch, document = record.document;
    try {
      if (!eligible(record.page)) return;
      const ready = await record.page.executeJavaScript(rendererSource('ready'));
      if (!ready || disposed || globalThis[key] !== controller || epoch !== generation || record.document !== document) return;
      if (desired) {
        const result = await record.page.executeJavaScript(rendererSource('apply', desired));
        if (disposed || globalThis[key] !== controller || epoch !== generation || record.document !== document) return;
        if (result?.renderer !== 'applied' || result.revision !== desired.revision) throw new Error('Desktop background could not be reapplied to the new document.');
      }
      if (startupSource && !record.started) {
        record.started = true;
        await record.page.executeJavaScript(startupSource);
      }
      record.error = null;
    } catch (error) { if (!disposed && epoch === generation && record.document === document) record.error = String(error?.message ?? error); }
    finally {
      record.running = false;
      if (record.dirty && !disposed && !commanding) void run(record);
    }
  };
  const attach = (page, existing = false) => {
    if (page.isDestroyed() || page.getType() !== 'window' || records.has(page)) return;
    const record = { page, document: 0, started: existing, running: false, dirty: false, error: null, listeners: [] };
    const changed = () => { record.document++; record.started = false; void run(record); };
    const navigated = () => { void run(record); };
    const destroyed = () => { records.delete(page); };
    record.listeners = [['dom-ready', changed], ['did-finish-load', navigated], ['did-navigate-in-page', navigated], ['destroyed', destroyed]];
    for (const [event, listener] of record.listeners) page.on(event, listener);
    records.set(page, record);
  };
  const created = (_event, page) => attach(page);
  electron.app.on('web-contents-created', created);
  for (const page of electron.webContents.getAllWebContents()) attach(page, true);
  const controller = {
    rendererSourceKey: rendererSource.toString(),
    configuredStartupSource: null,
    async command(action, payload, source = null) {
      if (action === 'inspect') {
        const results = [];
        for (const page of electron.webContents.getAllWebContents().filter(page => eligible(page))) {
          try {
            const result = await page.executeJavaScript(rendererSource('inspect'));
            results.push({ ...result, error: records.get(page)?.error || result.error });
          } catch (error) { results.push({ renderer: 'unknown', failed: true, error: String(error?.message ?? error) }); }
        }
        return { supported: true, results };
      }
      const generation = ++epoch;
      const dispatch = {};
      globalThis[dispatchKey] = dispatch;
      commanding = true;
      if (action === 'remove') {
        disposed = true; desired = null; startupSource = null;
        controller.configuredStartupSource = null;
        electron.app.removeListener('web-contents-created', created);
        for (const record of records.values()) for (const [event, listener] of record.listeners) record.page.removeListener(event, listener);
        if (globalThis[key] === controller) delete globalThis[key];
      }
      if (action === 'configureStartup') {
        startupSource = source;
        controller.configuredStartupSource = source;
        // Configuration applies to future documents. It never starts playback
        // in a document which is already open when the option changes.
        for (const record of records.values()) record.started = true;
      }
      const previous = desired;
      if (action === 'apply') desired = payload;
      const results = [];
      try {
        for (const page of electron.webContents.getAllWebContents().filter(page => eligible(page, action !== 'apply'))) {
          if (epoch !== generation || globalThis[dispatchKey] !== dispatch) return { supported: true, results, cancelled: true };
          try {
            const result = await page.executeJavaScript(rendererSource(action === 'configureStartup' ? (source ? 'cancelReady' : 'removeStartup') : action, payload));
            results.push(result);
            if (action === 'apply' && result.renderer === 'applied' && result.revision === payload.revision) {
              const record = records.get(page);
              if (record) record.error = null;
            }
          } catch (error) { results.push({ renderer: 'unknown', failed: true, error: String(error?.message ?? error) }); }
        }
        if (epoch !== generation || globalThis[dispatchKey] !== dispatch) return { supported: true, results, cancelled: true };
        if (action === 'apply' && (!results.length || results.some(row => row.renderer !== 'applied' || row.revision !== payload.revision))) desired = previous;
        return { supported: true, results };
      } finally {
        if (epoch === generation) {
          commanding = false;
          if (!disposed) for (const record of records.values()) if (record.dirty) void run(record);
        }
      }
    },
  };
  globalThis[key] = controller;
  return controller;
}

export function buildClaudeMainSource(action, payload = null, startupSource = null, target = 'claude') {
  payload = prepareClaudePayload(payload);
  const namespace = target === 'dsh' ? 'Dsh' : 'Claude';
  const controllerKey = JSON.stringify(`__dreamskin${namespace}ControllerV1`);
  const dispatchKey = JSON.stringify(`__dreamskin${namespace}DispatchV1`);
  const factory = `function(action,payload){return '('+${JSON.stringify(claudeRendererOperation.toString())}+')('+JSON.stringify(action)+','+JSON.stringify(payload ?? null)+','+${JSON.stringify(claudeBackgroundLayout.toString())}+','+${JSON.stringify(loadClaudeMedia.toString())}+','+${JSON.stringify(loadClaudeVideo.toString())}+','+${JSON.stringify(JSON.stringify(target))}+')';}`;
  return `(async()=>{
    let electron;
    if(typeof require==='function')electron=require('electron');
    else if(process.mainModule?.require)electron=process.mainModule.require('electron');
    else {
      const nodeModule=process.getBuiltinModule?.('module')??await import('node:module');
      electron=nodeModule.createRequire(process.execPath)('electron');
    }
    if(!electron?.webContents||!electron.app)return {supported:false};
    const rendererSource=${factory};
    let controller=globalThis[${controllerKey}];
    ${action === 'apply' ? `let savedStartupSource;
    if(controller&&controller.rendererSourceKey!==rendererSource.toString()){
      const previous=controller;
      savedStartupSource=previous.configuredStartupSource??null;
      const removed=await previous.command('remove',null);
      if(removed.cancelled)return removed;
      const active=globalThis[${controllerKey}];
      if(active&&active!==previous)return {...removed,cancelled:true};
      if(active===previous)delete globalThis[${controllerKey}];
      controller=null;
    }` : ''}
    ${action === 'inspect' || action === 'remove' ? '' : `controller??=(${installClaudeMainController.toString()})(electron,rendererSource,${JSON.stringify(target)});`}
    ${action === 'apply' ? `if(savedStartupSource!==undefined){
      const configuring=controller.command('configureStartup',null,savedStartupSource);
      const dispatch=globalThis[${dispatchKey}];
      const configured=await configuring;
      if(configured.cancelled||configured.results.some(row=>row.failed||row.renderer!=='removed'))return configured;
      if(globalThis[${controllerKey}]!==controller||globalThis[${dispatchKey}]!==dispatch)return {...configured,cancelled:true};
    }` : ''}
    if(controller){
      ${action === 'configureStartup' ? `const source=${JSON.stringify(startupSource)};
      const configuring=controller.command('configureStartup',null,source);
      const dispatch=globalThis[${dispatchKey}];
      const result=await configuring;
      if(result.cancelled)return result;
      if(globalThis[${controllerKey}]!==controller||globalThis[${dispatchKey}]!==dispatch)return {...result,cancelled:true};
      if(!result.results.some(row=>row.failed||row.renderer!=='removed'))controller.configuredStartupSource=source;
      return result;` : `return controller.command(${JSON.stringify(action)},${JSON.stringify(payload)},${JSON.stringify(startupSource)});`}
    }
    const dispatch=${action === 'inspect' ? 'null' : '{}'};
    if(dispatch)globalThis[${dispatchKey}]=dispatch;
    const results=[];
    for(const page of electron.webContents.getAllWebContents()){
      if(page.isDestroyed()||page.getType()!=='window')continue;
      let url;try{url=new URL(page.getURL());}catch{continue;}
      ${target === 'dsh' ? "if(url.protocol!=='dsh-app:'||url.hostname!=='app'||url.pathname!=='/')continue;" : `if(url.protocol!=='app:'||url.hostname!=='localhost'||(${JSON.stringify(action)}!=='remove'&&url.pathname!=='/epitaxy'&&!url.pathname.startsWith('/epitaxy/')))continue;`}
      if(dispatch&&globalThis[${dispatchKey}]!==dispatch)return {supported:true,results,cancelled:true};
      try{results.push(await page.executeJavaScript(rendererSource(${JSON.stringify(action)},null)));}
      catch(error){results.push({renderer:'unknown',failed:true,error:String(error?.message??error)});}
    }
    if(dispatch&&globalThis[${dispatchKey}]!==dispatch)return {supported:true,results,cancelled:true};
    return {supported:true,results};
  })()`;
}

