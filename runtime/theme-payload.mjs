import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { MEDIA_CACHE_ROOT, materializeMediaSnapshot, sameFileStat } from "./media-cache.mjs";
import { MAX_IMAGE_FRAMES, readImageAnimation, readImageMetadata } from "./image-metadata.mjs";
import { normalizeThemeColor, normalizeThemeText } from "./theme-package-validator.mjs";
import { decodeAndValidateSafeCss } from "./safe-css-validator.mjs";

// Packaged beside each platform injector; generated from runtime/ only.
export function createThemePayload(root, SKIN_VERSION) {
  const MAX_ART_BYTES = 128 * 1024 * 1024, MAX_VIDEO_BYTES = MAX_ART_BYTES, MAX_SAFE_CSS_BYTES = 256 * 1024;
  let staticPayloadAssets = null;
function assertContainedPath(rootPath, candidatePath, label) {
  const relative = path.relative(rootPath, candidatePath);
  if (
    relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) return;
  throw new Error(`${label} must stay inside its theme directory`);
}



async function loadSafeCss(assetsRoot) {
  const cssPath = path.join(assetsRoot, "theme.css");
  let handle;
  try {
    handle = await fs.open(cssPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error("Theme Safe CSS must not be a symbolic link");
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_SAFE_CSS_BYTES) {
      throw new Error(`Theme Safe CSS must be a non-empty file no larger than ${MAX_SAFE_CSS_BYTES} bytes`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileStat(before, after) || bytes.length !== after.size) {
      throw new Error("Theme Safe CSS changed while being loaded");
    }
    const { source, runtimeSource, validation } = decodeAndValidateSafeCss(bytes);
    return { path: cssPath, runtimeSource, source, stat: after, validation };
  } finally {
    await handle.close();
  }
}

async function loadTheme(themeDir) {
  const requestedRoot = themeDir ?? path.join(root, "assets");
  const configPath = path.join(requestedRoot, "theme.json");
  let assetsRoot;
  let canonicalConfigPath;
  try {
    [assetsRoot, canonicalConfigPath] = await Promise.all([
      fs.realpath(requestedRoot),
      fs.realpath(configPath),
    ]);
  } catch (error) {
    if (themeDir && error.code === "ENOENT") {
      throw new Error(`Explicit theme directory is missing theme.json: ${configPath}`);
    }
    throw error;
  }
  assertContainedPath(assetsRoot, canonicalConfigPath, "Theme config");
  let config;
  try {
    config = await fs.readFile(canonicalConfigPath, "utf8");
  } catch (error) {
    if (themeDir && error.code === "ENOENT") {
      throw new Error(`Explicit theme directory is missing theme.json: ${configPath}`);
    }
    throw error;
  }
  const raw = JSON.parse(config);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schemaVersion !== 1) {
    throw new Error(`${configPath} must use schemaVersion 1`);
  }
  if (typeof raw.image !== "string" || !raw.image) {
    throw new Error(`${configPath} has an unsupported schema or image field`);
  }
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(raw.image)) {
    throw new Error(`${configPath} has an invalid image field`);
  }
  if (path.basename(raw.image) !== raw.image) throw new Error("Theme image must stay inside its theme directory");
  const choice = (value, name, choices) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !choices.includes(value)) {
      throw new Error(`${configPath} has an invalid ${name} field`);
    }
    return value;
  };
  const unit = (value, name) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${configPath} has an invalid ${name} field`);
    }
    return value;
  };
  const range = (value, name, min, max, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${configPath} has an invalid ${name} field`);
    }
    return value;
  };
  const colors = raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors)
    ? raw.colors : null;
  const palette = raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette) ? raw.palette : null;
  // Both on-disk theme formats remain supported by the shared renderer.
  const rawColors = colors || palette?.accent != null
    ? { ...(palette?.accent != null ? { accent: palette.accent } : {}), ...(colors ?? {}) } : null;
  const colorKeys = [
    "background", "panel", "panelAlt", "accent", "accentAlt", "secondary",
    "highlight", "text", "muted", "line",
  ];
  const appearance = choice(raw.appearance, "appearance", ["auto", "light", "dark"]);
  if (raw.art !== undefined && (!raw.art || typeof raw.art !== "object" || Array.isArray(raw.art))) {
    throw new Error(`${configPath} has an invalid art field`);
  }
  const rawArt = raw.art || {};
  const framingKeys = ["positionX", "positionY", "zoom", "positionMode"];
  const hasFramingValues = framingKeys.some((key) => Object.hasOwn(rawArt, key));
  if (Object.hasOwn(rawArt, "framingEnabled") && typeof rawArt.framingEnabled !== "boolean") {
    throw new Error(`${configPath} has an invalid art.framingEnabled field`);
  }
  const framingEnabled = rawArt.framingEnabled === true || hasFramingValues;
  const art = {
    focusX: unit(rawArt.focusX, "art.focusX"),
    focusY: unit(rawArt.focusY, "art.focusY"),
    bubbleOpacity: range(rawArt.bubbleOpacity, "art.bubbleOpacity", 0, 1, 0),
    surfaceOpacity: range(rawArt.surfaceOpacity, "art.surfaceOpacity", 0, 1, 0.3),
    shellOpacity: range(rawArt.shellOpacity, "art.shellOpacity", 0, 1, undefined),
    playbackRate: range(rawArt.playbackRate, "art.playbackRate", 0.25, 2, 1),
    safeArea: choice(rawArt.safeArea, "art.safeArea", ["auto", "left", "right", "center", "none"]),
    taskMode: choice(rawArt.taskMode, "art.taskMode", ["auto", "ambient", "banner", "full", "off"]),
    ...(framingEnabled ? {
      positionX: range(rawArt.positionX, "art.positionX", -1, 1, 0),
      positionY: range(rawArt.positionY, "art.positionY", -1, 1, 0),
      zoom: range(rawArt.zoom, "art.zoom", 1, 2, 1),
      positionMode: choice(rawArt.positionMode ?? "locked", "art.positionMode", ["locked", "free"]),
      framingEnabled: true,
    } : {}),
  };
  const theme = {
    schemaVersion: 1,
    id: normalizeThemeText(raw.id, "custom", 80, "id", configPath),
    name: normalizeThemeText(raw.name, "Codex Dream Skin", 80, "name", configPath),
    brandSubtitle: normalizeThemeText(raw.brandSubtitle, "CODEX DREAM SKIN", 120, "brandSubtitle", configPath),
    tagline: normalizeThemeText(raw.tagline, "Make something wonderful.", 120, "tagline", configPath),
    projectPrefix: normalizeThemeText(raw.projectPrefix, "选择项目 · ", 120, "projectPrefix", configPath),
    projectLabel: normalizeThemeText(raw.projectLabel, "◉  选择项目", 120, "projectLabel", configPath),
    statusText: normalizeThemeText(raw.statusText, "DREAM SKIN ONLINE", 120, "statusText", configPath),
    quote: normalizeThemeText(raw.quote, "MAKE SOMETHING WONDERFUL", 120, "quote", configPath),
    image: raw.image,
    colorMode: rawColors ? "explicit" : "auto",
    explicitColorKeys: rawColors ? colorKeys.filter((key) => Object.hasOwn(rawColors, key)) : [],
    colors: {
      background: normalizeThemeColor(rawColors?.background, "#071116"),
      panel: normalizeThemeColor(rawColors?.panel, "#0b1a20"),
      panelAlt: normalizeThemeColor(rawColors?.panelAlt, "#10272c"),
      accent: normalizeThemeColor(rawColors?.accent, "#7cff46"),
      accentAlt: normalizeThemeColor(rawColors?.accentAlt, "#b8ff3d"),
      secondary: normalizeThemeColor(rawColors?.secondary, "#36d7e8"),
      highlight: normalizeThemeColor(rawColors?.highlight, "#642a8c"),
      text: normalizeThemeColor(rawColors?.text, "#e9fff1"),
      muted: normalizeThemeColor(rawColors?.muted, "#9ebdb3"),
      line: normalizeThemeColor(rawColors?.line, "rgba(124, 255, 70, .28)"),
    },
  };
  theme.appearance = appearance ?? "auto";
  if (Object.values(art).some((value) => value !== undefined)) {
    theme.art = Object.fromEntries(Object.entries(art).filter(([, value]) => value !== undefined));
  }
  const requestedImagePath = path.join(assetsRoot, theme.image);
  let imagePath;
  try {
    imagePath = await fs.realpath(requestedImagePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Theme image is missing: ${requestedImagePath}`);
    throw error;
  }
  assertContainedPath(assetsRoot, imagePath, "Theme image");
  const imageStat = await fs.stat(imagePath);
  const extension = path.extname(theme.image).toLowerCase();
  if (![".png", ".apng", ".jpg", ".jpeg", ".webp", ".gif", ".mp4"].includes(extension)) {
    throw new Error(`Unsupported theme image format: ${extension || "missing"}`);
  }
  const maxArtBytes = extension === ".mp4" ? MAX_VIDEO_BYTES : MAX_ART_BYTES;
  let imageHandle;
  try {
    imageHandle = await fs.open(imagePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error.code === "ELOOP") throw new Error("Theme image changed into a symbolic link while loading");
    throw error;
  }
  try {
    const openedStat = await imageHandle.stat();
    if (
      !imageStat.isFile()
      || !openedStat.isFile()
      || imageStat.dev !== openedStat.dev
      || imageStat.ino !== openedStat.ino
      || openedStat.size < 1
      || openedStat.size > maxArtBytes
    ) {
      throw new Error(`Theme media must be a stable non-empty file no larger than ${maxArtBytes / 1024 / 1024} MiB`);
    }
    const art = await imageHandle.readFile();
    if (art.length < 1 || art.length > maxArtBytes) {
      throw new Error(`Theme media must be a non-empty file no larger than ${maxArtBytes / 1024 / 1024} MiB`);
    }
    const safeCss = await loadSafeCss(assetsRoot);
    const after = await imageHandle.stat();
    if (!sameFileStat(openedStat, after) || art.length !== after.size) throw new Error("Theme media changed while being loaded");
    const themeStat = await fs.stat(canonicalConfigPath);
    if (await fs.readFile(canonicalConfigPath, "utf8") !== config) throw new Error("Theme config changed while being loaded");
    const metadata = readImageMetadata(art, extension), animation = readImageAnimation(art, extension);
    if (!metadata) throw new Error("Theme media metadata is invalid or exceeds the 16384px / 50MP safety limit");
    if (!animation || animation.frameCount > MAX_IMAGE_FRAMES) throw new Error(`Theme image has too many animation frames (maximum ${MAX_IMAGE_FRAMES})`);
    theme.artMetadata = { ...metadata, ...animation };
    const fingerprint = createHash("sha256").update(config).update("\0").update(art).update("\0").update(safeCss?.source ?? "").digest("hex");
    return {
      art,
      imageBytes: art,
      fingerprint,
      themePath: canonicalConfigPath,
      sourceStamp: `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}:` + (safeCss ? `${safeCss.stat.size}:${safeCss.stat.mtimeMs}` : "none"),
      assetsRoot,
      extension,
      imagePath,
      safeCss: safeCss?.source ?? "",
      safeCssRuntime: safeCss?.runtimeSource ?? "",
      safeCssPath: safeCss?.path ?? null,
      safeCssStatus: safeCss ? "validated" : "none",
      theme,
    };
  } finally {
    await imageHandle.close();
  }
}

async function loadStaticPayloadAssets() {
  const cacheHit = Boolean(staticPayloadAssets);
  if (!staticPayloadAssets) {
    staticPayloadAssets = Promise.all([
      fs.readFile(path.join(root, "assets", "dream-skin.css"), "utf8"),
      fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
    ]).catch((error) => {
      staticPayloadAssets = null;
      throw error;
    });
  }
  const [css, template] = await staticPayloadAssets;
  return { css, template, cacheHit };
}

function invalidateStaticPayloadAssets() {
  staticPayloadAssets = null;
}

async function loadPayload(themeDir, candidateTheme = null, mediaCacheRoot = MEDIA_CACHE_ROOT) {
  const startedAt = performance.now();
  const [staticAssets, loaded] = await Promise.all([
    loadStaticPayloadAssets(),
    candidateTheme ?? loadTheme(themeDir),
  ]);
  const { css, template } = staticAssets;
  const { art, imageBytes: _bytes, extension, safeCssRuntime, safeCssStatus, theme, ...themeState } = loaded;
  const combinedCss = safeCssRuntime ? `${css}\n${safeCssRuntime}\n` : css;
  const styleRevision = createHash("sha256").update(combinedCss).digest("hex").slice(0, 20);
  const artKey = createHash("sha256").update(art).digest("hex").slice(0, 20);
  theme.artKey = artKey;
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp"
      : extension === ".gif" ? "image/gif"
        : extension === ".mp4" ? "video/mp4" : "image/png";
  const artDataUrl = `dreamskin-file:${mime}`;
  const opacityIndependentArt = { ...theme.art };
  delete opacityIndependentArt.bubbleOpacity;
  delete opacityIndependentArt.surfaceOpacity;
  delete opacityIndependentArt.shellOpacity;
  theme.opacityUpdateKey = createHash("sha256")
    .update(SKIN_VERSION).update(combinedCss).update(template).update(art)
    .update(JSON.stringify({ ...theme, image: undefined, opacityUpdateKey: undefined, art: opacityIndependentArt }))
    .digest("hex");
  const revision = createHash("sha256")
    .update(SKIN_VERSION)
    .update(combinedCss)
    .update(template)
    .update(JSON.stringify(theme))
    .digest("hex")
    .slice(0, 20);
  // Every replacement value must be supplied as a function. A plain string
  // replacement would still interpret `$$`, `$&`, `` $` `` and `$'` inside the
  // JSON, so a theme name that legitimately contains `$` could silently corrupt
  // or truncate the payload. Function replacements are inserted verbatim.
  const payload = template
    .replace("__DREAM_SKIN_CSS_JSON__", () => JSON.stringify(combinedCss))
    .replace("__DREAM_SKIN_ART_JSON__", () => JSON.stringify(artDataUrl))
    .replace("__DREAM_SKIN_THEME_JSON__", () => JSON.stringify(theme))
    .replace("__DREAM_SKIN_VERSION_JSON__", () => JSON.stringify(SKIN_VERSION))
    .replace("__DREAM_SKIN_STYLE_REVISION_JSON__", () => JSON.stringify(styleRevision))
    .replace("__DREAM_SKIN_PAYLOAD_REVISION_JSON__", () => JSON.stringify(revision));
  assertPayloadIntegrity(payload);
  const mediaFilePath = await materializeMediaSnapshot(art, mediaCacheRoot, extension);
  return {
    ...themeState,
    imageBytes: art.length,
    mediaFilePath,
    payload,
    revision,
    safeCssStatus,
    theme,
    timings: {
      buildMs: Number((performance.now() - startedAt).toFixed(3)),
      staticCacheHit: staticAssets.cacheHit,
    },
  };
}

// Fail closed before a payload can reach the renderer. Theme display fields are
// attacker-influenced text, so template substitution is verified structurally
// instead of trusting any single sanitiser:
//   1. no placeholder token may survive substitution;
//   2. the payload must still parse as the standalone expression that
//      Runtime.evaluate would receive.
// The second assertion is deliberately generic: it catches any corruption of
// the template, not only the `$` replacement patterns that motivated it.
// `new Script` compiles without running the payload, so nothing executes here.
function assertPayloadIntegrity(payload) {
  if (/__DREAM_SKIN_[A-Z0-9_]+_JSON__/.test(payload)) {
    throw new Error("Payload placeholders were not fully replaced");
  }
  try {
    new Script(payload, { filename: "dream-skin-payload.js" });
  } catch (error) {
    throw new Error(`Payload is not a parsable renderer script: ${error.message}`);
  }
  return true;
}

  return { loadTheme, loadPayload, invalidateStaticPayloadAssets, assertPayloadIntegrity };
}
