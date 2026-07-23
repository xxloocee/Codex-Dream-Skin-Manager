import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const windowsRoot = path.resolve(process.argv[2] || "");
if (!windowsRoot || !fs.statSync(windowsRoot).isDirectory()) {
  throw new Error("Packaged Windows runtime path is required.");
}
const template = fs.readFileSync(path.join(windowsRoot, "assets", "renderer-inject.js"), "utf8");
const css = fs.readFileSync(path.join(windowsRoot, "assets", "dream-skin.css"), "utf8");
const injector = fs.readFileSync(path.join(windowsRoot, "scripts", "injector.mjs"), "utf8");
const common = fs.readFileSync(path.join(windowsRoot, "scripts", "common-windows.ps1"), "utf8");
const start = fs.readFileSync(path.join(windowsRoot, "scripts", "start-dream-skin.ps1"), "utf8");

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  removeProperty(name) { this.values.delete(name); }
  getPropertyValue(name) { return this.values.get(name) || ""; }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(width = 0, height = 0) {
    this.clientWidth = width;
    this.clientHeight = height;
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.parentElement = null;
    this.children = [];
    this.id = "";
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this); }
  setAttribute() {}
  querySelectorAll() { return []; }
}

function execute(config, options = {}) {
  const elementsById = new Map();
  const root = new FakeElement(1200, 800);
  const body = new FakeElement(1200, 800);
  const head = new FakeElement();
  const main = new FakeElement(1000, 500);
  main.classList.add("main-surface");
  const homeLevelOne = new FakeElement();
  const homeLevelTwo = new FakeElement();
  const homeArt = new FakeElement(900, 450);
  main.appendChild(homeLevelOne).appendChild(homeLevelTwo).appendChild(homeArt);
  const registerAppend = (element) => {
    const append = element.appendChild.bind(element);
    element.appendChild = (child) => {
      const result = append(child);
      if (child.id) elementsById.set(child.id, child);
      return result;
    };
  };
  registerAppend(head);
  registerAppend(body);

  const document = {
    documentElement: root,
    body,
    head,
    getElementById: (id) => elementsById.get(id) || null,
    createElement: () => new FakeElement(),
    querySelector: (selector) => {
      if (selector === "main.main-surface" || selector === "main" || selector === '[role="main"]') return main;
      if (selector === '[role="main"]:has([data-testid="home-icon"])') return options.home ? main : null;
      if (selector === ".dream-home > div:first-child > div:first-child > div:first-child") {
        return main.classList.contains("dream-home") ? homeArt : null;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '[role="main"]') return [main];
      if (selector === ".dream-task") return main.classList.contains("dream-task") ? [main] : [];
      if (selector === ".dream-home") return main.classList.contains("dream-home") ? [main] : [];
      if (selector === ".dream-home-shell") return main.classList.contains("dream-home-shell") ? [main] : [];
      if (selector === ".dream-home-utility") return [];
      return [];
    },
  };
  class PendingImage { set src(_) {} }
  class MutationObserver { observe() {} disconnect() {} }
  const resizeObservers = [];
  class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      this.disconnected = false;
      resizeObservers.push(this);
    }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
  }
  const window = {};
  const eventListeners = new Map();
  const timeouts = new Map();
  let nextTimeout = 0;
  const context = {
    window,
    document,
    Image: PendingImage,
    MutationObserver,
    ResizeObserver,
    Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    getComputedStyle: () => ({ colorScheme: "dark", backgroundColor: "rgb(24, 24, 24)" }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (callback) => { const id = ++nextTimeout; timeouts.set(id, callback); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    console,
    Uint8Array,
    Math,
    Promise,
  };
  window.window = window;
  window.document = document;
  window.innerHeight = 800;
  window.addEventListener = (name, listener) => eventListeners.set(name, listener);
  window.removeEventListener = (name, listener) => {
    if (eventListeners.get(name) === listener) eventListeners.delete(name);
  };
  const source = template
    .replace("__DREAM_CSS_JSON__", JSON.stringify(css))
    .replace("__DREAM_ART_JSON__", JSON.stringify("data:image/png;base64,AA=="))
    .replace("__DREAM_THEME_JSON__", JSON.stringify(config));
  vm.runInNewContext(source, context, { filename: "renderer-inject.js" });
  const flushTimeouts = () => {
    for (const [id, callback] of [...timeouts]) { timeouts.delete(id); callback(); }
  };
  return { root, body, main, homeArt, window, eventListeners, resizeObservers, flushTimeouts,
    styleElement: elementsById.get("codex-dream-skin-style") };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const framed = execute({
  appearance: "dark",
  artMetadata: { ratio: 2 },
  art: {
    focusX: .5, focusY: .4, positionX: .6, positionY: -.5,
    zoom: 1.5, positionMode: "locked", framingEnabled: true,
  },
});
assert(framed.root.classList.contains("dream-art-framed"), "Renderer did not enable custom positioning.");
assert(framed.main.style.getPropertyValue("--dream-art-size") === "1500.00px 750.00px",
  "Renderer did not calculate cover-relative zoom size.");
assert(framed.main.style.getPropertyValue("--dream-art-position") === "-100.00px -187.50px",
  "Renderer did not calculate locked movement from the centered zoomed rectangle.");
assert(framed.styleElement?.textContent.includes("Custom framing is manager-owned."),
  "Packaged renderer did not load the custom framing CSS extension.");
assert(typeof framed.eventListeners.get("resize") === "function",
  "Renderer did not register an immediate resize refresh.");
framed.main.clientWidth = 1200;
framed.eventListeners.get("resize")();
framed.flushTimeouts();
assert(framed.main.style.getPropertyValue("--dream-art-size") === "1800.00px 900.00px",
  "Renderer did not refresh zoom sizing after resize.");
assert(framed.main.style.getPropertyValue("--dream-art-position") === "-120.00px -300.00px",
  "Renderer did not refresh centered positioning after resize.");
framed.main.clientWidth = 1100;
framed.resizeObservers[0].callback();
framed.flushTimeouts();
assert(framed.main.style.getPropertyValue("--dream-art-size") === "1650.00px 825.00px",
  "Renderer did not refresh after a surface-only resize.");
assert(framed.main.style.getPropertyValue("--dream-art-position") === "-110.00px -243.75px",
  "Surface-only resize lost centered positioning.");
framed.window.__CODEX_DREAM_SKIN_STATE__.cleanup();
assert(!framed.eventListeners.has("resize"), "Renderer did not remove its resize listener during cleanup.");
assert(framed.resizeObservers[0].disconnected, "Renderer did not disconnect its surface resize observer.");
assert(framed.main.style.getPropertyValue("--dream-art-size") === "" &&
  framed.main.style.getPropertyValue("--dream-art-position") === "",
  "Renderer cleanup left per-surface framing variables behind.");
assert(framed.root.style.getPropertyValue("--dream-art-fill") === "",
  "Renderer cleanup left the image-derived fill variable behind.");

const centeredZoom = execute({
  appearance: "auto",
  artMetadata: { ratio: 2 },
  art: { positionX: 0, positionY: 0, zoom: 1.5, positionMode: "locked", framingEnabled: true },
});
assert(centeredZoom.main.style.getPropertyValue("--dream-art-size") === "1500.00px 750.00px",
  "Centered zoom did not preserve cover-relative dimensions.");
assert(centeredZoom.main.style.getPropertyValue("--dream-art-position") === "-250.00px -125.00px",
  "Zoom is not anchored to the display area's center.");

const lockedEndpoint = execute({
  appearance: "auto",
  artMetadata: { ratio: 4 },
  art: { positionX: 1, positionY: 0, zoom: 1, positionMode: "locked", framingEnabled: true },
});
assert(lockedEndpoint.main.style.getPropertyValue("--dream-art-size") === "1472.00px 368.00px",
  `Locked mode did not retain cover sizing: ${lockedEndpoint.main.style.getPropertyValue("--dream-art-size")}`);
assert(lockedEndpoint.main.style.getPropertyValue("--dream-art-position") === "0.00px 0.00px",
  "Locked movement exposed the backdrop at its positive endpoint.");

const explicitLockedDefault = execute({
  appearance: "auto",
  artMetadata: { ratio: 4 },
  art: { positionX: 0, positionY: 0, zoom: 1, positionMode: "locked", framingEnabled: true },
});
assert(explicitLockedDefault.root.classList.contains("dream-art-framed"),
  "Explicit locked framing was mistaken for a legacy theme at default values.");
assert(explicitLockedDefault.main.style.getPropertyValue("--dream-art-size") === "1472.00px 368.00px",
  "Explicit locked framing did not enforce centered cover sizing.");
assert(explicitLockedDefault.main.style.getPropertyValue("--dream-art-position") === "-236.00px 0.00px",
  "Explicit locked framing was not centered at default values.");

const freeEndpoint = execute({
  appearance: "auto",
  artMetadata: { ratio: 2 },
  art: { positionX: 1, positionY: 0, zoom: 1, positionMode: "free", framingEnabled: true },
});
assert(freeEndpoint.root.classList.contains("dream-art-framed"),
  "Free mode did not enable explicit framing at default zoom.");
assert(freeEndpoint.root.classList.contains("dream-art-free"),
  "Free mode did not enable the fill treatment.");
assert(freeEndpoint.main.style.getPropertyValue("--dream-art-position") === "1000.00px 0.00px",
  "Free movement cannot move the image fully beyond the viewport edge.");
assert(freeEndpoint.root.style.getPropertyValue("--dream-art-fill").includes("rgb(108 131 142)"),
  "Free mode did not expose the image-derived muted fill variable.");
assert(css.includes("dream-art-free .dream-task::before") && css.includes("background-color: var(--dream-art-fill"),
  "Free mode CSS does not paint uncovered areas with the derived fill.");

const homeFraming = execute({
  appearance: "auto",
  artMetadata: { ratio: 2 },
  art: { positionX: .2, positionY: -.4, zoom: 1.25, positionMode: "free", framingEnabled: true },
}, { home: true });
assert(homeFraming.homeArt.style.getPropertyValue("--dream-art-size") === "1125.00px 562.50px",
  "Home art did not receive custom framing dimensions.");
assert(homeFraming.homeArt.style.getPropertyValue("--dream-art-position") === "90.00px -258.75px",
  "Home art did not receive free-position framing.");
assert(homeFraming.body.style.getPropertyValue("--dream-art-size") === "2000.00px 1000.00px",
  "Body-backed home art did not receive custom framing dimensions.");
assert(homeFraming.body.style.getPropertyValue("--dream-art-position") === "-80.00px -460.00px",
  "Body-backed home art did not receive free-position framing.");
homeFraming.homeArt.clientWidth = 1000;
homeFraming.homeArt.clientHeight = 500;
homeFraming.root.clientWidth = 1400;
homeFraming.root.clientHeight = 900;
homeFraming.eventListeners.get("resize")();
homeFraming.flushTimeouts();
assert(homeFraming.homeArt.style.getPropertyValue("--dream-art-size") === "1250.00px 625.00px",
  "Home art framing did not refresh after resize.");
assert(homeFraming.body.style.getPropertyValue("--dream-art-size") === "2250.00px 1125.00px",
  "Body-backed framing did not refresh after resize.");

const legacy = execute({ appearance: "auto", artMetadata: { ratio: 2 }, art: { focusX: .725, focusY: .455 } });
assert(legacy.root.style.getPropertyValue("--dream-art-position") === "73% 46%",
  "Legacy theme focus position changed.");
assert(!legacy.root.classList.contains("dream-art-framed"), "Legacy theme unexpectedly enabled custom framing.");
assert(legacy.main.style.getPropertyValue("--dream-art-size") === "",
  "Legacy theme unexpectedly overrides the original background sizing.");
assert(legacy.main.style.getPropertyValue("--dream-art-position") === "",
  "Legacy theme unexpectedly overrides per-surface positioning.");

for (const expected of [
  'positionMode: new Set(["locked", "free"])',
  'positionX: normalizedRange(art.positionX, "art.positionX", -1, 1, 0)',
  'positionY: normalizedRange(art.positionY, "art.positionY", -1, 1, 0)',
  'zoom: normalizedRange(art.zoom, "art.zoom", 1, 2, 1)',
  'positionMode: normalizedChoice(art.positionMode, "art.positionMode", THEME_CHOICES.positionMode, "locked")',
  'framingEnabled: ["positionX", "positionY", "zoom", "positionMode"]',
]) {
  assert(injector.includes(expected), `Packaged injector does not forward ${expected.split(":")[0]}.`);
}
assert(common.includes("Wait-Process -Id $processId -Timeout 15"),
  "Packaged runtime does not allow enough time for the previous injector to exit.");
assert(common.includes("$exitDeadline = (Get-Date).AddSeconds(5)"),
  "Packaged runtime does not tolerate delayed Windows process-table cleanup.");
const fingerprintBeforeStart = start.indexOf("$runtimeFingerprint = Get-DreamSkinRuntimeFingerprint");
const injectorStart = start.indexOf("$daemon = Start-Process");
const fingerprintAfterStart = start.indexOf("$currentRuntimeFingerprint = Get-DreamSkinRuntimeFingerprint");
assert(start.includes("runtime-version.ps1") && fingerprintBeforeStart >= 0 &&
  fingerprintBeforeStart < injectorStart && fingerprintAfterStart > injectorStart &&
  start.includes("runtimeFingerprint = $runtimeFingerprint"),
  "Packaged startup does not bracket injector launch with a stable runtime fingerprint.");

console.log("PASS: packaged renderer applies locked/free centered framing and preserves legacy defaults");
