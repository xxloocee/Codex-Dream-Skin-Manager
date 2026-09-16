import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  bindVideoFileToSession as bindMacVideo,
  loadPayload as loadMacPayload,
  materializeMediaSnapshot as materializeMacSnapshot,
} from "../macos/scripts/injector.mjs";
import {
  bindVideoFileToSession as bindWindowsVideo,
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
  }

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
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("PASS: MP4 payloads use the private CDP file bridge without Base64 or path disclosure.");
