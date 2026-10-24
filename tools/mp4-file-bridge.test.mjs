import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { applyLoadedToSession, bindMediaFileToSession } from "../runtime/renderer-session.mjs";
import { assessRendererVerification } from "../runtime/renderer-verification.mjs";

import {
  bindMediaFileToSession as bindMacVideo,
  loadPayload as loadMacPayload,
  materializeMediaSnapshot as materializeMacSnapshot,
} from "../macos/scripts/injector.mjs";
import {
  bindMediaFileToSession as bindWindowsVideo,
  loadPayload as loadWindowsPayload,
  materializeMediaSnapshot as materializeWindowsSnapshot,
} from "../windows/scripts/injector.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const mp4 = Buffer.from((await fs.readFile(path.join(
  projectRoot, "tests", "fixtures", "h264-32x18-2fps.mp4.base64",
), "utf8")).trim(), "base64");
const tempRoot = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-mp4-file-")),
);
const theme = {
  schemaVersion: 1,
  id: "file_fixture",
  name: "File Fixture",
  image: "background.mp4",
  appearance: "auto",
  art: { safeArea: "auto", taskMode: "auto" },
};
const sourceVideoPath = path.join(tempRoot, "background.mp4");

await fs.writeFile(path.join(tempRoot, "theme.json"), `${JSON.stringify(theme)}\n`);
await fs.writeFile(sourceVideoPath, mp4);

try {
  for (const [materialize, cacheName] of [
    [materializeWindowsSnapshot, "windows-cache"],
    [materializeMacSnapshot, "macos-cache"],
  ]) {
    const cacheRoot = path.join(tempRoot, cacheName);
    const staleTemp = path.join(
      cacheRoot, `.${"a".repeat(64)}.1.00000000-0000-4000-8000-000000000000.tmp`,
    );
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.writeFile(staleTemp, "stale");
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(staleTemp, staleTime, staleTime);
    for (let index = 0; index < 18; index += 1) {
      await materialize(Buffer.from(`validated snapshot ${index}`), cacheRoot);
    }
    const cachedFiles = (await fs.readdir(cacheRoot)).filter((name) => name.endsWith(".mp4"));
    assert.equal(cachedFiles.length, 16, "The media cache must retain at most 16 snapshots");
    await assert.rejects(fs.stat(staleTemp), { code: "ENOENT" });
  }

  const windows = await loadWindowsPayload(
    tempRoot, null, path.join(tempRoot, "windows-runtime-cache"),
  );
  const macos = await loadMacPayload(tempRoot, path.join(tempRoot, "macos-runtime-cache"));
  for (const loaded of [windows, macos]) {
    assert.match(loaded.theme.opacityUpdateKey, /^[a-f0-9]{64}$/);
    assert.match(loaded.payload, /dreamskin-file:video\/mp4/);
    assert.doesNotMatch(loaded.payload, /data:video\/mp4;base64/);
    assert.ok(path.isAbsolute(loaded.mediaFilePath));
    assert.equal(path.relative(tempRoot, loaded.mediaFilePath).startsWith(".."), false,
      "Bridge tests must never use or prune the real user media cache");
    assert.notEqual(loaded.mediaFilePath, await fs.realpath(sourceVideoPath));
    assert.match(path.basename(loaded.mediaFilePath), /^[a-f0-9]{64}\.mp4$/);
    assert.deepEqual(await fs.readFile(loaded.mediaFilePath), mp4);
    assert.equal(loaded.payload.includes(loaded.mediaFilePath), false,
      "The local filesystem path must never enter renderer JavaScript");
    assert.ok(Buffer.byteLength(loaded.payload) < 500_000,
      "File-backed video payloads must not scale with MP4 byte length");
    const calls = [];
    const styles = new Map([["--ds-bubble-opacity", String(loaded.theme.art.bubbleOpacity ?? 0)],
      ["--ds-surface-opacity", String(loaded.theme.art.surfaceOpacity ?? 0.3)]]), priorities = new Map();
    const attributes = new Map([["data-dream-skin", "active"], ["data-dream-art-wide", "true"],
      ["data-dream-task-mode", "ambient"], ["data-dream-shell", "dark"]]);
    const root = {
      getAttribute: name => attributes.get(name) ?? null,
      style: {
        getPropertyValue: name => styles.get(name) ?? "",
        getPropertyPriority: name => priorities.get(name) ?? "",
        setProperty(name, value, priority = "") { styles.set(name, value); priorities.set(name, priority); },
        removeProperty(name) { styles.delete(name); priorities.delete(name); },
      },
    };
    let lightDarkSupported = true, forcedAlpha = null;
    let mediaCalls = 0, rejectedRollbackRevision = null;
    const opacityCalls = [], video = {};
    for (const [name, value] of [["src", "blob:unchanged"], ["currentTime", 12]]) {
      Object.defineProperty(video, name, { enumerable: true, get: () => value,
        set() { mediaCalls += 1; throw new Error("Opacity updates must not modify video state"); } });
    }
    for (const name of ["play", "pause", "load"]) Object.defineProperty(video, name, {
      value() { mediaCalls += 1; throw new Error("Opacity updates must not call media methods"); },
    });
    const state = {
      themeId: loaded.theme.id, revision: loaded.revision, videoLayer: video,
      updateVideoOpacity(request) {
        opacityCalls.push(request);
        assert.deepEqual(Object.keys(request), ["themeId", "opacityUpdateKey", "revision", "bubbleOpacity", "surfaceOpacity"],
          "Older renderers must receive exactly their original five opacity fields.");
        if (request.opacityUpdateKey !== loaded.theme.opacityUpdateKey || request.revision === rejectedRollbackRevision) return false;
        styles.set("--ds-bubble-opacity", String(Number(request.bubbleOpacity.toFixed(4))));
        styles.set("--ds-surface-opacity", String(Number(request.surfaceOpacity.toFixed(4))));
        this.revision = request.revision;
        return { applied: true, themeId: request.themeId, revision: request.revision };
      },
    };
    const context = vm.createContext({
      window: { __CODEX_DREAM_SKIN_STATE__: state }, document: { documentElement: root, body: {} },
      CSS: { supports(_property, value) {
        assert.equal(value.includes("var("), false, "Feature detection must not be deferred by CSS variable substitution.");
        return lightDarkSupported;
      } },
      getComputedStyle(node) {
        const base = attributes.get("data-dream-shell") === "light" ? 0.64 : 0.58;
        const token = styles.get("--ds-shell-background") || `rgb(17 19 24 / ${base})`;
        if (node === root) return { getPropertyValue: () => token };
        const value = token.match(/\/\s*([0-9.]+)\)/)?.[1] ?? token.match(/,\s*([0-9.]+)\)$/)?.[1];
        return { content: '\"\"', display: "block", backgroundColor: `rgba(17, 19, 24, ${forcedAlpha ?? Number(value)})` };
      },
    });
    const session = {
      async send() { throw new Error("Opacity refresh must not decode or bind video files"); },
      async evaluate(expression) {
        calls.push(expression);
        return vm.runInContext(expression, context);
      },
    };
    const initialReceipt = await applyLoadedToSession(session, loaded, { opacityOnly: true });
    assert.equal(initialReceipt.shellOpacityVerified, true);
    assert.equal(calls.length, 1, "Opacity parameters and shell readback must run in one synchronous renderer evaluation");
    assert.ok(calls[0].includes("updateVideoOpacity"));
    assert.equal(calls.includes(loaded.payload), false);
    let rejectedCalls = 0;
    await assert.rejects(applyLoadedToSession({ ...session, async evaluate() { rejectedCalls += 1; return false; } }, loaded, { opacityOnly: true }), /no video reload/);
    assert.equal(rejectedCalls, 1, "An incompatible runtime must not fall back to full injection");
    let revisionSequence = 1;
    const shellPayload = value => ({ ...loaded, revision: (revisionSequence++).toString(16).padStart(20, "0"),
      theme: { ...loaded.theme, art: { ...loaded.theme.art,
      ...(value === undefined ? {} : { shellOpacity: value }) } } });
    for (const alpha of [0.1, 0.8]) {
      const receipt = await applyLoadedToSession(session, shellPayload(alpha), { opacityOnly: true });
      assert.equal(receipt.shellOpacity, alpha);
      assert.equal(receipt.shellVeilVerified, true);
      assert.equal(receipt.shellVeilAlpha, alpha);
      assert.equal(state.shellOpacity, alpha);
      assert.match(styles.get("--ds-shell-background"), /^light-dark\(rgb\(var\(--ds-panel-rgb\)/);
      assert.deepEqual(video, { src: "blob:unchanged", currentTime: 12 });
    }
    attributes.set("data-dream-shell", "light");
    const resetReceipt = await applyLoadedToSession(session, shellPayload(undefined), { opacityOnly: true });
    assert.equal(resetReceipt.shellVeilAlpha, 0.64);
    assert.equal(styles.has("--ds-shell-background"), false);
    assert.equal(Object.hasOwn(state, "shellOpacity"), false);
    attributes.set("data-dream-shell", "dark");
    root.style.setProperty("--ds-shell-background", "rgba(10, 20, 30, 0.42)", "important");
    await applyLoadedToSession(session, shellPayload(0.7), { opacityOnly: true });
    const baselineReceipt = await applyLoadedToSession(session, shellPayload(undefined), { opacityOnly: true });
    assert.equal(baselineReceipt.shellVeilAlpha, 0.42);
    assert.equal(root.style.getPropertyValue("--ds-shell-background"), "rgba(10, 20, 30, 0.42)");
    assert.equal(root.style.getPropertyPriority("--ds-shell-background"), "important");
    await applyLoadedToSession(session, shellPayload(0.7), { opacityOnly: true });
    root.style.setProperty("--ds-shell-background", "rgba(1, 2, 3, 0.33)", "important");
    await assert.rejects(applyLoadedToSession(session, shellPayload(0.2), { opacityOnly: true }), /another owner/);
    assert.equal(root.style.getPropertyValue("--ds-shell-background"), "rgba(1, 2, 3, 0.33)");
    delete state.shellOpacity; delete state.shellOpacityOverride; root.style.removeProperty("--ds-shell-background");
    forcedAlpha = 0.9;
    const failedPayload = shellPayload(0.2);
    failedPayload.theme.art.bubbleOpacity = 0.45;
    failedPayload.theme.art.surfaceOpacity = 0.12;
    const beforeFailure = { revision: state.revision, bubble: styles.get("--ds-bubble-opacity"), surface: styles.get("--ds-surface-opacity") };
    await assert.rejects(applyLoadedToSession(session, failedPayload, { opacityOnly: true }), /visible shell veil/);
    assert.equal(state.revision, beforeFailure.revision);
    assert.equal(styles.get("--ds-bubble-opacity"), beforeFailure.bubble);
    assert.equal(styles.get("--ds-surface-opacity"), beforeFailure.surface);
    assert.equal(styles.has("--ds-shell-background"), false);
    assert.equal(Object.hasOwn(state, "shellOpacity"), false);
    const independentVerification = expectedRevision => assessRendererVerification({
      installed: true, version: "fixture", stylePresent: true, businessClassPollution: 0,
      documentVisibility: "visible", documentHidden: false, viewport: { width: 1200, height: 800 },
      scope: { baseState: "thread", level: "L1", missingL1: [] }, shell: { visible: true }, sidebar: { visible: true },
      themeId: loaded.theme.id, revision: state.revision, opacityUpdateFailed: state.opacityUpdateFailed === true,
    }, { status: "ready" }, { skinVersion: "fixture", expectedThemeId: loaded.theme.id, expectedRevision });
    const rejectedVerification = independentVerification(failedPayload.revision);
    assert.equal(rejectedVerification.checks.payloadPass, false);
    assert.equal(rejectedVerification.pass, false, "A failed shell update must not leave the failed revision independently verifiable.");
    rejectedRollbackRevision = state.revision;
    await assert.rejects(applyLoadedToSession(session, failedPayload, { opacityOnly: true }), /rollback could not be verified/);
    assert.equal(state.opacityUpdateFailed, true);
    assert.equal(independentVerification(failedPayload.revision).checks.payloadPass, true);
    assert.equal(independentVerification(failedPayload.revision).pass, false, "Failed rollback must stay unverified even if revision changed.");
    rejectedRollbackRevision = null;
    state.updateVideoOpacity({ ...opacityCalls.at(-1), revision: beforeFailure.revision,
      bubbleOpacity: Number(beforeFailure.bubble), surfaceOpacity: Number(beforeFailure.surface) });
    const callsBeforeInvalidBaseline = opacityCalls.length;
    styles.set("--ds-bubble-opacity", "not-a-number");
    await assert.rejects(applyLoadedToSession(session, loaded, { opacityOnly: true }), /no video reload/);
    assert.equal(opacityCalls.length, callsBeforeInvalidBaseline, "A non-rollbackable baseline must fail before mutation.");
    styles.set("--ds-bubble-opacity", beforeFailure.bubble);
    forcedAlpha = null; lightDarkSupported = false;
    const beforeUnsupported = calls.length;
    await assert.rejects(applyLoadedToSession(session, shellPayload(0.2), { opacityOnly: true }), /does not support/);
    assert.equal(calls.length, beforeUnsupported + 1, "Unsupported CSS must reject before the old opacity API mutates state.");
    lightDarkSupported = true; attributes.set("data-dream-task-mode", "off");
    const noVeil = await applyLoadedToSession(session, shellPayload(0.2), { opacityOnly: true });
    assert.equal(noVeil.shellOpacityVerified, true);
    assert.equal(noVeil.shellVeilVerified, false);
    assert.equal(Object.hasOwn(state, "opacityUpdateFailed"), false, "A successful in-place retry must clear the failure marker.");
    assert.equal(calls.includes(loaded.payload), false);
    assert.equal(mediaCalls, 0, "Successful updates and failed rollbacks must not reload or reposition the video.");
    attributes.set("data-dream-task-mode", "ambient");
    const bridgeSession = {
      async send(method) { return method === "Runtime.evaluate" ? { result: { objectId: "fixture-input" } } : {}; },
      async evaluate(expression) {
        if (expression.includes("state.bindMediaFile")) return true;
        if (expression.includes("video.readyState")) return { ready: true };
        return session.evaluate(expression);
      },
    };
    const bridgePayload = shellPayload(0.4);
    state.revision = bridgePayload.revision;
    forcedAlpha = 0.9;
    await assert.rejects(bindMediaFileToSession(bridgeSession, bridgePayload), /visible shell veil/);
    assert.equal(state.opacityUpdateFailed, true);
    assert.equal(independentVerification(bridgePayload.revision).checks.payloadPass, true);
    assert.equal(independentVerification(bridgePayload.revision).pass, false, "Full/early binding failures must not pass independent verification.");
    forcedAlpha = null;
    assert.equal(await bindMediaFileToSession(bridgeSession, bridgePayload), true);
    assert.equal(state.shellOpacity, 0.4, "Early/bootstrap image binding must also restore explicit shell opacity.");
    assert.equal(Object.hasOwn(state, "opacityUpdateFailed"), false);
    assert.equal(independentVerification(bridgePayload.revision).pass, true);
  }

  await fs.writeFile(path.join(tempRoot, "alias.mp4"), mp4);
  for (const load of [(dir, cache) => loadWindowsPayload(dir, null, cache), loadMacPayload]) {
    const cache = path.join(tempRoot, "opacity-key-cache");
    await fs.writeFile(path.join(tempRoot, "theme.json"), JSON.stringify(theme));
    const original = await load(tempRoot, cache);
    assert.equal(Object.hasOwn(original.theme.art, "shellOpacity"), false, "Missing shell opacity must preserve older runtime keys.");
    const edited = { ...theme, image: "alias.mp4", art: { ...theme.art, surfaceOpacity: 0.12, bubbleOpacity: 0.45, shellOpacity: 0.2 } };
    await fs.writeFile(path.join(tempRoot, "theme.json"), JSON.stringify(edited));
    const updated = await load(tempRoot, cache);
    assert.equal(updated.theme.art.shellOpacity, 0.2);
    assert.equal(updated.theme.opacityUpdateKey, original.theme.opacityUpdateKey, "Only opacity or the media filename may change without replacing the video");
    assert.notEqual(updated.revision, original.revision, "A verified opacity update must still have a new content revision");
    await fs.writeFile(path.join(tempRoot, "theme.json"), JSON.stringify({ ...edited, art: { ...edited.art, playbackRate: 0.5 } }));
    assert.notEqual((await load(tempRoot, cache)).theme.opacityUpdateKey, original.theme.opacityUpdateKey, "Other parameters must not enter the opacity-only path");
  }
  await fs.writeFile(path.join(tempRoot, "theme.json"), JSON.stringify(theme));

  await fs.writeFile(sourceVideoPath, Buffer.from("source replaced after validation"));

  for (const [bind, loaded] of [[bindWindowsVideo, windows], [bindMacVideo, macos]]) {
    const calls = [];
    const session = {
      async send(method, params) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate") return { result: { objectId: "video-file-input" } };
        if (method === "DOM.setFileInputFiles") return {};
        if (method === "Runtime.releaseObject") return {};
        throw new Error(`Unexpected CDP method ${method}`);
      },
      async evaluate(expression) {
        calls.push({ method: "evaluate", expression });
        if (expression.includes("?.start()")) return { pass: true };
        if (expression.includes("video.readyState")) {
          return { error: null, ready: true };
        }
        return true;
      },
    };
    assert.equal(await bind(session, loaded), true);
    const setFiles = calls.find((call) => call.method === "DOM.setFileInputFiles");
    assert.deepEqual(setFiles.params, {
      files: [loaded.mediaFilePath],
      objectId: "video-file-input",
    });
    assert.deepEqual(await fs.readFile(setFiles.params.files[0]), mp4,
      "Binding must use the validated snapshot after the source file is replaced");
    assert.deepEqual(calls.find((call) => call.method === "Runtime.releaseObject")?.params, {
      objectId: "video-file-input",
    });
    assert.equal(calls.some((call) => JSON.stringify(call).includes(loaded.mediaFilePath) &&
      call.method !== "DOM.setFileInputFiles"), false,
    "The file path may only cross CDP as a structured DOM.setFileInputFiles parameter");
  }

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  for (const [load, bind, platform] of [
    [(dir, cache) => loadWindowsPayload(dir, null, cache), bindWindowsVideo, "windows"],
    [loadMacPayload, bindMacVideo, "macos"],
  ]) {
    for (const [extension, bytes, mime] of [["png", png, "image/png"], ["mp4", mp4, "video/mp4"]]) {
      const source = path.join(tempRoot, `large.${extension}`);
      await fs.writeFile(source, bytes);
      await fs.truncate(source, 128 * 1024 * 1024);
      await fs.writeFile(path.join(tempRoot, "theme.json"), JSON.stringify({ ...theme, image: `large.${extension}` }));
      const loaded = await load(tempRoot, path.join(tempRoot, `${platform}-large-cache`));
      assert.ok(loaded.payload.includes(`dreamskin-file:${mime}`));
      assert.doesNotMatch(loaded.payload, /data:(?:image|video)\/[^;]+;base64/);
      assert.equal(path.extname(loaded.mediaFilePath), `.${extension}`);
      assert.equal((await fs.stat(loaded.mediaFilePath)).size, 128 * 1024 * 1024);
      assert.ok(Buffer.byteLength(loaded.payload) < 500_000);
      await fs.truncate(source, 128 * 1024 * 1024 + 1);
      await assert.rejects(load(tempRoot, path.join(tempRoot, `${platform}-large-cache`)), /128/);
      if (extension === "png") {
        for (const [status, expected] of [
          [{ ready: true }, null], [{ error: "Image decode failed" }, /Image decode failed/],
          [{ stale: true }, /Renderer changed/], [{ ready: false }, /Timed out/],
        ]) {
          const session = {
            async send(method, params) {
              if (method === "Runtime.evaluate") return { result: { objectId: "image-input" } };
              if (method === "DOM.setFileInputFiles") assert.equal(params.files[0], loaded.mediaFilePath);
              return {};
            },
            async evaluate(expression) {
              return expression.includes("state.bindMediaFile") ? true : status;
            },
          };
          if (expected) await assert.rejects(bind(session, loaded, 100), expected);
          else assert.equal(await bind(session, loaded), true);
        }
      }
    }
  }

  for (const [materialize, platform] of [[materializeWindowsSnapshot, "win"], [materializeMacSnapshot, "mac"]]) {
    const cache = path.join(tempRoot, `${platform}-mixed-cache`);
    await fs.mkdir(cache);
    for (const [index, extension] of ["png", "gif", "mp4"].entries()) {
      const file = path.join(cache, `${String(index).repeat(64)}.${extension}`);
      await fs.writeFile(file, "");
      await fs.truncate(file, 100 * 1024 * 1024);
    }
    const retained = await materialize(png, cache, ".png");
    const sizes = await Promise.all((await fs.readdir(cache)).map(async name => (await fs.stat(path.join(cache, name))).size));
    assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 256 * 1024 * 1024,
      "Images and videos must share the same 256 MiB cache budget");
    assert.deepEqual(await fs.readFile(retained), png);
    await assert.rejects(materialize(png, cache, "/../outside.png"), /Unsupported/);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("PASS: image/video file bridge, 128 MiB boundaries, decode errors, and shared cache budget.");
