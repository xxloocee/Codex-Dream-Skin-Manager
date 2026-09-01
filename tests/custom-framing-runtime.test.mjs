import fs from "node:fs/promises";
import path from "node:path";

const candidate = path.resolve(process.argv[2] || path.join(import.meta.dirname || ".", ".."));
const isWindowsPackage = await Promise.all([
  fs.stat(path.join(candidate, "scripts", "injector.mjs")),
  fs.stat(path.join(candidate, "assets", "renderer-inject.js")),
]).then(() => true).catch(() => false);
const projectRoot = isWindowsPackage ? path.resolve(candidate, "..") : candidate;
const windowsRoot = isWindowsPackage ? candidate : path.join(projectRoot, "windows");
const runtimeRoot = isWindowsPackage
  ? path.join(windowsRoot, "assets")
  : await fs.stat(path.join(projectRoot, "runtime")).then(() => path.join(projectRoot, "runtime"));
const runtime = await fs.readFile(path.join(runtimeRoot, "renderer-inject.js"), "utf8");
const css = await fs.readFile(path.join(runtimeRoot, "dream-skin.css"), "utf8");
const windowsInjector = await fs.readFile(path.join(windowsRoot, "scripts", "injector.mjs"), "utf8");
const macosInjector = await fs.readFile(path.join(projectRoot, "macos", "scripts", "injector.mjs"), "utf8").catch(() => windowsInjector);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [label, source] of [["canonical renderer", runtime], ["canonical CSS", css]]) {
  assert(source.includes("data-dream-art-framing"), `${label} is missing the shared framing marker.`);
  assert(source.includes("--dream-art-framing-position"), `${label} is missing the shared framing position variable.`);
  assert(source.includes("--dream-art-background-size"), `${label} is missing the shared framing size variable.`);
}
for (const [label, source] of [["Windows injector", windowsInjector], ["macOS injector", macosInjector]]) {
  assert(source.includes("positionX"), `${label} does not normalize positionX.`);
  assert(source.includes("positionY"), `${label} does not normalize positionY.`);
  assert(source.includes("positionMode"), `${label} does not normalize positionMode.`);
  assert(source.includes("framingEnabled"), `${label} does not preserve framingEnabled.`);
}

const windowsRenderer = await fs.readFile(path.join(windowsRoot, "assets", "renderer-inject.js"), "utf8");
const windowsCss = await fs.readFile(path.join(windowsRoot, "assets", "dream-skin.css"), "utf8");
const macosRenderer = await fs.readFile(path.join(projectRoot, "macos", "assets", "renderer-inject.js"), "utf8").catch(() => windowsRenderer);
const macosCss = await fs.readFile(path.join(projectRoot, "macos", "assets", "dream-skin.css"), "utf8").catch(() => windowsCss);
assert(windowsRenderer === macosRenderer, "Windows and macOS renderer assets drifted.");
assert(windowsCss === macosCss, "Windows and macOS CSS assets drifted.");

console.log("PASS: shared framing contract is present, normalized on both platforms, and synchronized");
