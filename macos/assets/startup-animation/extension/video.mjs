// A temporary, silent, one-shot video overlay. The host supplies a checked
// local file through CDP, using the same file-input bridge as theme videos.
export function installStartupVideo(source = null) {
  if (window.top !== window || !document.body) return { installed: false };
  window.__aemeathExtension?.dispose();
  let frame = document.createElement("iframe"), objectURL = null, video = null;
  let ready = false, completed = false, phase = "loading", disposed = false;
  const priorFocus = document.activeElement;
  const input = document.createElement("input");
  input.type = "file"; input.accept = "video/mp4"; input.hidden = true;
  input.id = "dream-skin-startup-video-file";
  document.body.appendChild(input);
  function cleanup() {
    clearTimeout(watchdog);
    window.removeEventListener("keydown", keyboard, true);
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); video = null; }
    frame?.remove(); frame = null; input.value = ""; input.remove();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    if (priorFocus?.isConnected) priorFocus.focus();
  }
  function finish(next = "complete") {
    if (disposed || completed) return;
    completed = next === "complete"; phase = next; cleanup();
  }
  function keyboard(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; cleanup();
    if (window.__aemeathExtension === api) delete window.__aemeathExtension;
  }
  const watchdog = setTimeout(() => finish("timeout"), 75000);
  frame.title = "Startup animation";
  Object.assign(frame.style, { position: "fixed", inset: "0", width: "100%", height: "100%", border: "0", zIndex: "2147483646", background: "#000" });
  const current = frame;
  current.addEventListener("load", () => {
    if (frame !== current || disposed) return;
    const doc = current.contentDocument;
    doc.documentElement.innerHTML = '<head></head><body></body>';
    const style = doc.createElement("style");
    style.textContent = 'html,body{margin:0;width:100%;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain}button{position:fixed;right:24px;bottom:24px;padding:8px 14px;border:1px solid #ffffff66;border-radius:6px;background:#0009;color:#fff;cursor:pointer;font:13px system-ui}button:focus-visible{outline:2px solid #fff;outline-offset:3px}';
    doc.head.appendChild(style);
    video = doc.createElement("video");
    video.muted = true; video.playsInline = true; video.loop = false;
    video.addEventListener("playing", () => { if (frame && !disposed) { ready = true; phase = "playing"; } }, { once: true });
    video.addEventListener("ended", () => finish(), { once: true });
    video.addEventListener("error", () => finish("failed"), { once: true });
    const skip = doc.createElement("button");
    skip.textContent = document.documentElement.lang.startsWith("zh") ? "跳过 · Esc" : "Skip · Esc";
    skip.addEventListener("click", () => finish());
    doc.body.append(video, skip);
    current.contentWindow.addEventListener("keydown", keyboard, true);
    skip.focus();
    bind();
  }, { once: true });
  function bind() {
    if (!video || objectURL || video.hasAttribute('src') || disposed || completed || (!source && !input.files?.[0])) return false;
    if (source) video.src = `data:${source.mimeType};base64,${source.mediaBase64}`;
    else {
      objectURL = URL.createObjectURL(input.files[0]);
      video.src = objectURL;
    }
    void video.play().catch(() => { if (!disposed && phase === "loading") finish("failed"); });
    return true;
  }
  const api = { dispose, bind, status: () => ({ ready, completed, phase, overlay: !!frame }) };
  window.__aemeathExtension = api;
  window.addEventListener("keydown", keyboard, true);
  current.src = "about:blank";
  document.body.appendChild(current);
  return { installed: true };
}
