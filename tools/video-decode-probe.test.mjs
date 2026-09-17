import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { probeVideoDecode } from "../runtime/video-decode-probe.mjs";
import { readImageMetadata, readImageAnimation } from "../runtime/image-metadata.mjs";
import { validateVideoFile } from "../windows/scripts/video-decode-probe.mjs";

const hevc = Buffer.from(await fs.readFile(new URL("../tests/fixtures/hevc-32x32-2fps.mp4.base64", import.meta.url), "utf8"), "base64");
assert.equal(readImageAnimation(hevc, ".mp4").codec, "hvc1");
assert.equal(readImageMetadata(hevc, ".mp4").width, 32);
const hev1 = Buffer.from(hevc);
hev1.write("hev1", hev1.indexOf("hvc1", hev1.indexOf("stsd")));
assert.equal(readImageAnimation(hev1, ".mp4").codec, "hev1");
const broken = Buffer.from(hevc);
broken[broken.indexOf("hvcC") + 4] = 0;
assert.equal(readImageMetadata(broken, ".mp4"), null, "Malformed HEVC configuration must be rejected");
const missingSets = Buffer.from(hevc);
missingSets[missingSets.indexOf("hvcC") + 4 + 22] = 0;
assert.equal(readImageMetadata(missingSets, ".mp4"), null);

for (const outcome of ["frame", "error", "timeout", "disconnect", "navigation"]) {
  const nodes = [];
  const timers = new Map();
  const revoked = [];
  const calls = [];
  let frameCallback;
  let timerId = 0;
  const context = {
    window: {},
    document: {
      body: { append(...elements) { nodes.push(...elements); } },
      createElement(tag) {
        return { tag, style: {}, files: [], setAttribute() {}, removeAttribute() {}, load() {}, pause() {},
          remove() { nodes.splice(nodes.indexOf(this), 1); },
          requestVideoFrameCallback(callback) { frameCallback = callback; return 1; },
          cancelVideoFrameCallback() {},
          play() {
            queueMicrotask(() => {
              if (outcome === "frame") frameCallback(0, { width: 32, height: 32, presentedFrames: 1 });
              else if (outcome === "error") this.onerror();
              else for (const callback of [...timers.values()]) callback();
            });
            return Promise.resolve();
          },
        };
      },
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    URL: { createObjectURL() { return "blob:probe"; }, revokeObjectURL(url) { revoked.push(url); } },
  };
  const session = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        vm.runInNewContext(params.expression, context);
        return { result: { objectId: "private-input" } };
      }
      if (method === "DOM.setFileInputFiles") {
        if (outcome === "disconnect") throw new Error("CDP socket closed");
        nodes.find(node => node.tag === "input").files = [{ name: "snapshot.mp4", size: 100, type: "video/mp4" }];
      }
      return {};
    },
    async evaluate(expression) {
      if (outcome === "navigation" && expression.endsWith("?.start()")) return undefined;
      return vm.runInNewContext(expression, context);
    },
  };
  if (outcome === "frame") assert.equal((await probeVideoDecode(session, "private/snapshot.mp4")).pass, true);
  else await assert.rejects(probeVideoDecode(session, "private/snapshot.mp4"), /Codex|CDP/);
  assert.equal(nodes.length, 0, `${outcome}: probe DOM must be removed`);
  assert.equal(Object.keys(context.window).length, 0);
  assert.equal(timers.size, 0);
  assert.equal(revoked.length, ["frame", "error", "timeout"].includes(outcome) ? 1 : 0);
  assert.ok(calls.some(call => call.method === "Runtime.releaseObject"));
  assert.equal(calls.some(call => call.method !== "DOM.setFileInputFiles" && JSON.stringify(call).includes("private/snapshot.mp4")), false);
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dream-hevc-preflight-"));
try {
  const file = path.join(temp, "video.mp4");
  await fs.writeFile(file, hevc);
  await assert.rejects(validateVideoFile(file, path.join(temp, "missing-state.json")), /先启动 Codex/);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
for (const platform of ["windows", "macos"]) {
  const { applyLoadedToSession, earlyPayloadFor } = await import(`../${platform}/scripts/injector.mjs`);
  assert.equal(earlyPayloadFor('"dreamskin-file:video/mp4"', "video-revision"), "void 0;",
    "Video themes must not run before the decode preflight");
  const evaluated = [];
  const session = {
    async send(method) { return method === "Runtime.evaluate" ? { result: { objectId: "input" } } : {}; },
    async evaluate(expression) {
      evaluated.push(expression);
      return expression.endsWith("?.start()") ? { pass: false, reason: "decode-error" } : undefined;
    },
  };
  await assert.rejects(applyLoadedToSession(session, {
    payload: "REPLACE_CURRENT_THEME", mediaFilePath: "video.mp4", theme: { artMetadata: { video: true } },
  }), /Codex/);
  assert.equal(evaluated.includes("REPLACE_CURRENT_THEME"), false,
    `${platform}: rejected video must not replace the current theme`);
}
console.log("PASS: HEVC structure, decoded-frame gating, failure/timeout/navigation cleanup, and disconnected rejection.");
