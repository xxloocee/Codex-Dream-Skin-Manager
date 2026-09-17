import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPayload as loadMacPayload, loadTheme as loadMacTheme } from "../scripts/injector.mjs";
import { loadPayload as loadWindowsPayload, loadTheme as loadWindowsTheme } from "../../windows/scripts/injector.mjs";
import { readImageAnimation } from "../scripts/image-metadata.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const macosRoot = path.resolve(here, "..");
const projectRoot = path.resolve(macosRoot, "..");
const validator = path.join(macosRoot, "assets", "theme-package-validator.mjs");
const macosInjector = path.join(macosRoot, "scripts", "injector.mjs");
const windowsInjector = path.join(projectRoot, "windows", "scripts", "injector.mjs");
const importer = path.join(macosRoot, "scripts", "import-theme-zip-macos.sh");
const fixtureImage = path.join(macosRoot, "assets", "portal-hero.png");
const fixtureMp4 = Buffer.from((await fs.readFile(path.join(
  projectRoot, "tests", "fixtures", "h264-32x18-2fps.mp4.base64",
), "utf8")).trim(), "base64");
const tempRoot = await fs.mkdtemp(path.join("/tmp", "codex-dream-skin-package-contract-"));

const colors = {
  background: "#071116",
  panel: "#0b1a20",
  panelAlt: "#10272c",
  accent: "#7cff46",
  accentAlt: "#b8ff3d",
  secondary: "#36d7e8",
  highlight: "#642a8c",
  text: "#e9fff1",
  muted: "#9ebdb3",
  line: "rgba(124, 255, 70, .28)",
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code, stdout, stderr };
      if (code === 0) resolve(result);
      else reject(Object.assign(new Error(stderr || stdout || `${command} exited with ${code}`), result));
    });
  });
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileEntry(filePath, mediaType, bytes) {
  return { path: filePath, mediaType, bytes: bytes.length, sha256: digest(bytes) };
}

async function makeOfficial(name, options = {}) {
  const source = path.join(tempRoot, name);
  await fs.mkdir(source);
  const image = options.backgroundBytes ?? await fs.readFile(fixtureImage);
  const backgroundName = options.backgroundName ?? "background.png";
  const backgroundMedia = options.backgroundMedia ?? "image/png";
  const theme = {
    schemaVersion: 1,
    id: options.themeId ?? "studio.contract-theme",
    name: options.themeName ?? "Studio Contract Theme",
    image: options.themeImage ?? backgroundName,
    appearance: "auto",
    art: { focusX: 0.7, focusY: 0.5, safeArea: "left", taskMode: "full" },
    colors,
  };
  if (options.mutateTheme) options.mutateTheme(theme);
  const themeData = jsonBytes(theme);
  const files = [
    fileEntry("theme.json", "application/json", themeData),
    fileEntry(backgroundName, backgroundMedia, image),
  ];
  const capabilities = ["background", "tokens"];
  const extraFiles = new Map();
  if (options.css !== false) {
    const css = Buffer.from(options.cssSource ??
      '[data-ds-part="composer"] { background-color: var(--ds-theme-color-panel); }\n', "utf8");
    files.push(fileEntry("theme.css", "text/css", css));
    capabilities.push("safe-css");
    extraFiles.set("theme.css", css);
  }
  if (options.license) {
    const license = Buffer.from(options.licenseText ?? "CC0-1.0\n", "utf8");
    files.push(fileEntry("LICENSE.txt", "text/plain", license));
    extraFiles.set("LICENSE.txt", license);
  }
  if (options.signature) extraFiles.set("manifest.sig", Buffer.from("reserved-signature\n", "utf8"));
  const manifest = {
    packageVersion: 1,
    themeId: options.manifestThemeId ?? theme.id,
    version: "1.2.3",
    skinApiVersion: 1,
    minClientVersion: options.minClientVersion ?? "1.3.0",
    platforms: options.platforms ?? ["macos", "windows"],
    capabilities,
    publisher: { id: "dreamskin-studio", displayName: "DreamSkin Studio" },
    license: "CC0-1.0",
    provenance: { aiGenerated: false, summary: "Studio contract test package." },
    files,
    createdAt: "2026-07-24T00:00:00Z",
    ...(options.extraManifestField ? { unexpected: true } : {}),
  };
  if (options.mutateManifest) options.mutateManifest(manifest);
  await fs.writeFile(path.join(source, "manifest.json"), jsonBytes(manifest));
  await fs.writeFile(path.join(source, "theme.json"), themeData);
  await fs.writeFile(path.join(source, backgroundName), image);
  for (const [fileName, bytes] of extraFiles) await fs.writeFile(path.join(source, fileName), bytes);
  if (options.mutateImageAfterManifest) {
    const tampered = Buffer.from(image);
    tampered[tampered.length - 1] ^= 0x01;
    await fs.writeFile(path.join(source, backgroundName), tampered);
  }
  if (options.unknownFile) await fs.writeFile(path.join(source, "notes.txt"), "not registered\n");
  return { source, manifest, theme };
}

async function validate(source, platform, label) {
  const stage = path.join(tempRoot, `stage-${label}`);
  await fs.mkdir(stage);
  const result = await run(process.execPath, [
    validator,
    "--source", source,
    "--stage", stage,
    "--platform", platform,
    "--client-version", "1.3.3",
  ]);
  return { stage, output: JSON.parse(result.stdout) };
}

async function expectRejected(source, platform, pattern, label) {
  const stage = path.join(tempRoot, `rejected-${label}`);
  await fs.mkdir(stage);
  await assert.rejects(
    run(process.execPath, [
      validator,
      "--source", source,
      "--stage", stage,
      "--platform", platform,
      "--client-version", "1.3.3",
    ]),
    pattern,
  );
  assert.deepEqual(await fs.readdir(stage), []);
}

try {
  const base = await makeOfficial("official-base");
  const macos = await validate(base.source, "macos", "official-macos");
  const windows = await validate(base.source, "windows", "official-windows");
  assert.deepEqual(macos.output, {
    format: "official",
    image: "background.png",
    safeCssStatus: "validated",
    signatureIgnored: false,
  });
  assert.deepEqual(windows.output, macos.output);
  assert.deepEqual((await fs.readdir(macos.stage)).sort(), [
    "background.png",
    "manifest.json",
    "theme.css",
    "theme.json",
  ]);

  const impossibleTimestamp = await makeOfficial("official-impossible-timestamp", {
    mutateManifest: (manifest) => { manifest.createdAt = "2026-02-30T00:00:00Z"; },
  });
  await expectRejected(
    impossibleTimestamp.source,
    "macos",
    /createdAt is not a valid date-time/,
    "impossible-timestamp",
  );

  const leapTimestamp = await makeOfficial("official-valid-leap-timestamp", {
    mutateManifest: (manifest) => {
      manifest.createdAt = "2024-02-29T23:59:59.123456789+05:30";
    },
  });
  const leapResult = await validate(leapTimestamp.source, "windows", "valid-leap-timestamp");
  assert.equal(leapResult.output.format, "official");

  const legacyOfficial = await makeOfficial("legacy-official-no-css", { css: false });
  await expectRejected(
    legacyOfficial.source,
    "macos",
    /New official theme imports require theme\.css/,
    "legacy-official-no-css",
  );
  const [legacyMac, legacyWindows] = await Promise.all([
    loadMacTheme(legacyOfficial.source),
    loadWindowsTheme(legacyOfficial.source),
  ]);
  assert.equal(legacyMac.safeCssStatus, "none");
  assert.equal(legacyWindows.safeCssStatus, "none");

  const cssWithoutCapability = await makeOfficial("css-without-capability", {
    mutateManifest: (manifest) => {
      manifest.capabilities = manifest.capabilities.filter((value) => value !== "safe-css");
    },
  });
  await expectRejected(
    cssWithoutCapability.source,
    "macos",
    /presence must match the safe-css capability/,
    "css-without-capability",
  );

  for (const [injector, stage] of [[macosInjector, macos.stage], [windowsInjector, windows.stage]]) {
    const checked = await run(process.execPath, [injector, "--check-payload", "--theme-dir", stage]);
    assert.equal(JSON.parse(checked.stdout).pass, true, "Studio taskMode=full must pass both payload validators");
  }

  const boundaryColors = {
    background: "#abc",
    panel: "#abcd",
    panelAlt: "#11223344",
    accent: "#123456",
    accentAlt: "rgb(1, 2, 3)",
    secondary: "rgb(999, 0, 255)",
    highlight: "rgba(4, 5, 6, .5)",
    text: "#fff",
    muted: "#ffff",
    line: "rgba(124, 255, 70, .28)",
  };
  const longName = "😀".repeat(80);
  const longCopy = "✨".repeat(120);
  const boundaries = await makeOfficial("official-runtime-boundaries", {
    mutateTheme: (theme) => {
      theme.name = longName;
      theme.brandSubtitle = longCopy;
      theme.tagline = longCopy;
      theme.projectPrefix = longCopy;
      theme.projectLabel = longCopy;
      theme.statusText = longCopy;
      theme.quote = longCopy;
      theme.promoTitle = "ignored promo title";
      theme.promoSub = "ignored promo subtitle";
      theme.promoUrl = "https://example.invalid/ignored";
      theme.colors = boundaryColors;
    },
  });
  const macosBoundaries = await validate(boundaries.source, "macos", "runtime-boundaries-macos");
  const windowsBoundaries = await validate(boundaries.source, "windows", "runtime-boundaries-windows");
  const [loadedMac, loadedWindows] = await Promise.all([
    loadMacTheme(macosBoundaries.stage),
    loadWindowsTheme(windowsBoundaries.stage),
  ]);
  for (const loaded of [loadedMac, loadedWindows]) {
    assert.equal(loaded.theme.name, longName);
    for (const key of ["brandSubtitle", "tagline", "projectPrefix", "projectLabel", "statusText", "quote"]) {
      assert.equal(loaded.theme[key], longCopy, `${key} must retain 120 Unicode code points`);
    }
    assert.deepEqual(loaded.theme.colors, boundaryColors);
    assert.equal(Object.hasOwn(loaded.theme, "promoTitle"), false);
    assert.equal(Object.hasOwn(loaded.theme, "promoSub"), false);
    assert.equal(Object.hasOwn(loaded.theme, "promoUrl"), false);
  }

  const overlongCopy = await makeOfficial("official-overlong-copy", {
    mutateTheme: (theme) => { theme.brandSubtitle = "界".repeat(121); },
  });
  await expectRejected(overlongCopy.source, "macos", /invalid length/, "overlong-copy");
  await assert.rejects(loadMacTheme(overlongCopy.source), /invalid brandSubtitle field/);
  await assert.rejects(loadWindowsTheme(overlongCopy.source), /invalid brandSubtitle field/);

  const controlCopy = await makeOfficial("official-control-copy", {
    mutateTheme: (theme) => { theme.quote = "unsafe\u0007quote"; },
  });
  await expectRejected(controlCopy.source, "windows", /control characters/, "control-copy");
  await assert.rejects(loadMacTheme(controlCopy.source), /invalid quote field/);
  await assert.rejects(loadWindowsTheme(controlCopy.source), /invalid quote field/);

  const optional = await makeOfficial("official-optional", { css: true, license: true, signature: true });
  const optionalResult = await validate(optional.source, "macos", "official-optional");
  assert.equal(optionalResult.output.safeCssStatus, "validated");
  assert.equal(optionalResult.output.signatureIgnored, true);
  assert.deepEqual((await fs.readdir(optionalResult.stage)).sort(), [
    "LICENSE.txt",
    "background.png",
    "manifest.json",
    "manifest.sig",
    "theme.css",
    "theme.json",
  ]);

  const apngOfficial = await makeOfficial("official-apng", {
    backgroundName: "background.apng",
    backgroundMedia: "image/png",
  });
  const apngOfficialResult = await validate(apngOfficial.source, "macos", "official-apng");
  assert.equal(apngOfficialResult.output.image, "background.apng");

  const mp4Official = await makeOfficial("official-mp4", {
    backgroundName: "background.mp4",
    backgroundMedia: "video/mp4",
    backgroundBytes: Buffer.concat([
      fixtureMp4,
      Buffer.alloc((10 * 1024 * 1024) + 1 - fixtureMp4.length),
    ]),
  });
  const [mp4Mac, mp4Windows] = await Promise.all([
    validate(mp4Official.source, "macos", "official-mp4-macos"),
    validate(mp4Official.source, "windows", "official-mp4-windows"),
  ]);
  assert.equal(mp4Mac.output.image, "background.mp4");
  assert.equal(mp4Windows.output.image, "background.mp4");
  const [macVideoPayload, windowsVideoPayload] = await Promise.all([
    loadMacPayload(mp4Mac.stage, path.join(tempRoot, "mac-media-cache")),
    loadWindowsPayload(mp4Windows.stage, null, path.join(tempRoot, "windows-media-cache")),
  ]);
  assert.equal(macVideoPayload.theme.artMetadata.video, true);
  assert.equal(windowsVideoPayload.theme.artMetadata.video, true);
  assert.match(macVideoPayload.payload, /dreamskin-file:video\/mp4/);
  assert.match(windowsVideoPayload.payload, /dreamskin-file:video\/mp4/);
  assert.doesNotMatch(macVideoPayload.payload, /data:video\/mp4;base64/);
  assert.doesNotMatch(windowsVideoPayload.payload, /data:video\/mp4;base64/);

  const fragmentedMp4 = Buffer.concat([
    fixtureMp4,
    Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66]),
  ]);
  const fragmentedMp4Official = await makeOfficial("official-fragmented-mp4", {
    backgroundName: "background.mp4",
    backgroundMedia: "video/mp4",
    backgroundBytes: fragmentedMp4,
  });
  await expectRejected(
    fragmentedMp4Official.source,
    "windows",
    /standard non-fragmented H\.264\/AVC or H\.265\/HEVC MP4/,
    "official-fragmented-mp4",
  );

  const simpleSource = path.join(tempRoot, "simple-source");
  await fs.mkdir(simpleSource);
  await fs.copyFile(fixtureImage, path.join(simpleSource, "custom-background.png"));
  await fs.writeFile(path.join(simpleSource, "theme.json"), jsonBytes({
    schemaVersion: 1,
    id: "local_simple",
    name: "Local Simplified Theme",
    image: "custom-background.png",
    art: { safeArea: "auto", taskMode: "auto" },
  }));
  await fs.writeFile(
    path.join(simpleSource, "theme.css"),
    '[data-ds-part="root"] { color: var(--ds-theme-color-text); }\n',
  );
  const simple = await validate(simpleSource, "macos", "simple");
  assert.equal(simple.output.format, "simple");
  assert.equal(simple.output.safeCssStatus, "validated");

  const apngSource = path.join(tempRoot, "simple-apng-source");
  await fs.mkdir(apngSource);
  await fs.copyFile(fixtureImage, path.join(apngSource, "custom-background.apng"));
  await fs.writeFile(path.join(apngSource, "theme.json"), jsonBytes({
    schemaVersion: 1,
    id: "local_apng",
    name: "Local APNG Theme",
    image: "custom-background.apng",
  }));
  await fs.writeFile(
    path.join(apngSource, "theme.css"),
    '[data-ds-part="root"] { color: var(--ds-theme-color-text); }\n',
  );
  const [apngMac, apngWindows] = await Promise.all([
    validate(apngSource, "macos", "simple-apng-macos"),
    validate(apngSource, "windows", "simple-apng-windows"),
  ]);
  assert.equal(apngMac.output.image, "custom-background.apng");
  assert.equal(apngWindows.output.image, "custom-background.apng");
  const [loadedApngMac, loadedApngWindows] = await Promise.all([
    loadMacTheme(apngMac.stage),
    loadWindowsTheme(apngWindows.stage),
  ]);
  assert.equal(loadedApngMac.theme.image, "custom-background.apng");
  assert.equal(loadedApngWindows.theme.image, "custom-background.apng");

  const animatedGif = Buffer.concat([
    Buffer.from("GIF89a", "ascii"),
    Buffer.from([1, 0, 1, 0, 0, 0, 0]),
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00]),
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00]),
    Buffer.from([0x3b]),
  ]);
  const animatedSource = path.join(tempRoot, "simple-gif-source");
  await fs.mkdir(animatedSource);
  await fs.writeFile(path.join(animatedSource, "custom-background.gif"), animatedGif);
  await fs.writeFile(path.join(animatedSource, "theme.json"), jsonBytes({
    schemaVersion: 1,
    id: "local_gif",
    name: "Local Animated GIF",
    image: "custom-background.gif",
  }));
  await fs.writeFile(
    path.join(animatedSource, "theme.css"),
    '[data-ds-part="root"] { color: var(--ds-theme-color-text); }\n',
  );
  const [animatedMac, animatedWindows] = await Promise.all([
    validate(animatedSource, "macos", "simple-gif-macos"),
    validate(animatedSource, "windows", "simple-gif-windows"),
  ]);
  assert.equal(animatedMac.output.image, "custom-background.gif");
  assert.equal(animatedWindows.output.image, "custom-background.gif");
  const [loadedAnimatedMac, loadedAnimatedWindows] = await Promise.all([
    loadMacTheme(animatedMac.stage),
    loadWindowsTheme(animatedWindows.stage),
  ]);
  assert.equal(loadedAnimatedMac.theme.image, "custom-background.gif");
  assert.equal(loadedAnimatedWindows.theme.image, "custom-background.gif");
  assert.deepEqual(
    readImageAnimation(await fs.readFile(path.join(animatedMac.stage, "custom-background.gif")), ".gif"),
    { animated: true, frameCount: 2 },
  );

  const simpleWithoutCss = path.join(tempRoot, "simple-without-css");
  await fs.mkdir(simpleWithoutCss);
  await fs.copyFile(fixtureImage, path.join(simpleWithoutCss, "custom-background.png"));
  await fs.copyFile(path.join(simpleSource, "theme.json"), path.join(simpleWithoutCss, "theme.json"));
  await expectRejected(
    simpleWithoutCss,
    "macos",
    /must contain exactly theme\.json, theme\.css/,
    "simple-without-css",
  );

  const unsafeCss = await makeOfficial("official-unsafe-css", {
    css: true,
    cssSource: 'body { background-image: url("https://example.invalid/tracker"); }\n',
  });
  await expectRejected(unsafeCss.source, "macos", /registered \[data-ds-part/, "unsafe-css");

  const tampered = await makeOfficial("tampered", { mutateImageAfterManifest: true });
  await expectRejected(tampered.source, "macos", /SHA-256/, "tampered");
  const bytesMismatch = await makeOfficial("bytes-mismatch", {
    mutateManifest: (manifest) => { manifest.files[0].bytes += 1; },
  });
  await expectRejected(bytesMismatch.source, "macos", /byte length/, "bytes-mismatch");
  const future = await makeOfficial("future-client", { minClientVersion: "9.9.9" });
  await expectRejected(future.source, "macos", /requires Dream Skin 9\.9\.9/, "future-client");
  const wrongPlatform = await makeOfficial("wrong-platform", { platforms: ["macos"] });
  await expectRejected(wrongPlatform.source, "windows", /does not support windows/, "wrong-platform");
  const wrongId = await makeOfficial("wrong-id", { manifestThemeId: "different.theme" });
  await expectRejected(wrongId.source, "macos", /themeId does not match/, "wrong-id");
  const wrongImage = await makeOfficial("wrong-image", { themeImage: "background.jpg" });
  await expectRejected(wrongImage.source, "macos", /image does not match/, "wrong-image");
  const unknown = await makeOfficial("unknown-file", { unknownFile: true });
  await expectRejected(unknown.source, "macos", /unregistered file notes\.txt/, "unknown-file");
  const extraField = await makeOfficial("extra-field", { extraManifestField: true });
  await expectRejected(extraField.source, "macos", /unsupported field unexpected/, "extra-field");

  if (process.platform === "darwin" &&
    process.env.CODEX_DREAM_SKIN_SKIP_SIGNED_RUNTIME_TESTS !== "1") {
    const importHome = path.join(tempRoot, "import-home");
    const active = path.join(importHome, "Library", "Application Support", "CodexDreamSkinStudio", "theme");
    await fs.mkdir(active, { recursive: true });
    await fs.copyFile(path.join(base.source, "theme.json"), path.join(active, "theme.json"));
    await fs.copyFile(path.join(base.source, "background.png"), path.join(active, "background.png"));
    const activeBefore = await Promise.all([
      fs.readFile(path.join(active, "theme.json")),
      fs.readFile(path.join(active, "background.png")),
    ]);
    const oversizedArchive = path.join(tempRoot, "oversized-source.zip");
    const oversizedHandle = await fs.open(oversizedArchive, "wx");
    try {
      await oversizedHandle.truncate((160 * 1024 * 1024) + 1);
    } finally {
      await oversizedHandle.close();
    }
    await assert.rejects(run(importer, ["--file", oversizedArchive], {
      env: { ...process.env, HOME: importHome, LC_ALL: "C", LANG: "C" },
    }), /160 MiB archive limit/);
    const savedThemesRoot = path.join(
      importHome,
      "Library",
      "Application Support",
      "CodexDreamSkinStudio",
      "themes",
    );
    assert.equal(await fs.access(savedThemesRoot).then(() => true, () => false), false);

    const archive = path.join(tempRoot, "studio-export.zip");
    await run("/usr/bin/zip", ["-q", archive, ...await fs.readdir(optional.source)], { cwd: optional.source });
    const firstImport = await run(importer, ["--file", archive], {
      env: { ...process.env, HOME: importHome, LC_ALL: "C", LANG: "C" },
    });
    const firstResult = JSON.parse(firstImport.stdout);
    assert.equal(firstResult.status, "imported");
    assert.equal(firstResult.packageFormat, "official");
    assert.equal(firstResult.safeCssStatus, "validated");
    assert.equal(firstResult.signatureIgnored, true);
    const saved = path.join(savedThemesRoot, firstResult.id);
    assert.deepEqual((await fs.readdir(saved)).sort(), ["LICENSE.txt", "background.png", "theme.css", "theme.json"]);
    const secondImport = JSON.parse((await run(importer, ["--file", archive], {
      env: { ...process.env, HOME: importHome, LC_ALL: "C", LANG: "C" },
    })).stdout);
    assert.equal(secondImport.status, "duplicate");

    const licenseVariant = await makeOfficial("official-license-variant", {
      css: true,
      license: true,
      licenseText: "MIT\n",
      signature: true,
    });
    const licenseArchive = path.join(tempRoot, "studio-license-variant.zip");
    await run("/usr/bin/zip", ["-q", licenseArchive, ...await fs.readdir(licenseVariant.source)], {
      cwd: licenseVariant.source,
    });
    const licenseImport = JSON.parse((await run(importer, ["--file", licenseArchive], {
      env: { ...process.env, HOME: importHome, LC_ALL: "C", LANG: "C" },
    })).stdout);
    assert.equal(licenseImport.status, "imported");
    assert.equal(licenseImport.id, "studio.contract-theme");
    assert.equal(licenseImport.replaced, true);
    assert.equal(await fs.readFile(path.join(
      importHome,
      "Library",
      "Application Support",
      "CodexDreamSkinStudio",
      "themes",
      licenseImport.id,
      "LICENSE.txt",
    ), "utf8"), "MIT\n");
    assert.deepEqual(await fs.readFile(path.join(active, "theme.json")), activeBefore[0]);
    assert.deepEqual(await fs.readFile(path.join(active, "background.png")), activeBefore[1]);

    console.log("PASS: Studio manifest ZIPs validate on macOS/Windows and import without changing active theme.");
  } else if (process.platform === "darwin") {
    console.log("PASS: Studio manifest packages validate on both client platforms.");
    console.log("SKIP: macOS shell importer integration requires an installed, signed Codex app.");
  } else {
    console.log("PASS: Studio manifest packages validate on both client platforms.");
    console.log("SKIP: macOS shell importer integration requires macOS.");
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
