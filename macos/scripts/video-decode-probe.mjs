import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { readImageMetadata, readImageAnimation } from "./image-metadata.mjs";

// Runs inside the actual Codex renderer, without touching its current theme.
export function installVideoDecodeProbe(key) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/mp4,.mp4";
  input.hidden = true;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(input, video);
  let url = null;
  let timer = null;
  let frameCallback = null;
  let finish = null;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback);
    video.onerror = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    input.remove();
    video.remove();
    if (url) URL.revokeObjectURL(url);
    delete window[key];
  };
  window[key] = {
    cleanup: () => { if (finish) finish({ pass: false, reason: "cancelled" }); else cleanup(); },
    start: () => new Promise((resolve) => {
      let settled = false;
      finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish({ pass: false, reason: "decode-timeout" }), 7000);
      const file = input.files?.[0];
      if (!file || file.size < 1 || file.size > 128 * 1024 * 1024 ||
          !/\.mp4$/i.test(file.name) || file.type && file.type !== "video/mp4") {
        finish({ pass: false, reason: "invalid-file" });
        return;
      }
      if (typeof video.requestVideoFrameCallback !== "function") {
        finish({ pass: false, reason: "frame-verification-unavailable" });
        return;
      }
      video.onerror = () => finish({ pass: false, reason: "decode-error", mediaError: video.error?.code || 0 });
      frameCallback = video.requestVideoFrameCallback((_time, frame) => {
        finish({ pass: frame.width > 0 && frame.height > 0 && frame.presentedFrames > 0,
          reason: "decoded-frame", width: frame.width, height: frame.height });
      });
      url = URL.createObjectURL(file);
      video.src = url;
      video.play().catch(() => finish({ pass: false, reason: "playback-rejected" }));
    }),
  };
  // Self-clean even if CDP disconnects before start is invoked.
  timer = setTimeout(() => window[key]?.cleanup(), 9000);
  return input;
}

export async function probeVideoDecode(session, snapshotPath) {
  const key = `__dream_skin_decode_${randomUUID().replaceAll("-", "")}`;
  const literal = JSON.stringify(key);
  let objectId;
  try {
    const result = await session.send("Runtime.evaluate", {
      expression: `(${installVideoDecodeProbe.toString()})(${literal})`, returnByValue: false,
    });
    objectId = result.result?.objectId;
    if (result.exceptionDetails || !objectId) throw new Error("无法在 Codex 中建立视频解码校验。");
    await session.send("DOM.setFileInputFiles", { files: [snapshotPath], objectId });
    const decoded = await session.evaluate(`window[${literal}]?.start()`);
    if (decoded?.pass !== true) {
      throw new Error(`当前 Codex 未能解码此视频（${decoded?.reason || "renderer-changed"}）。请使用 H.264 兼容副本，或检查 HEVC 解码支持。`);
    }
    return decoded;
  } finally {
    await session.evaluate(`window[${literal}]?.cleanup()`).catch(() => {});
    if (objectId) await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

export async function validateVideoFile(filePath, statePath, forceVideo = false) {
  if (!forceVideo && path.extname(filePath).toLowerCase() !== ".mp4") return { pass: true, video: false };
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 128 * 1024 * 1024) {
    throw new Error("MP4 必须是非空普通文件，且不能超过 128 MiB。");
  }
  const bytes = await fs.readFile(filePath);
  if (bytes.length !== stat.size) throw new Error("视频在校验期间发生变化，请重试。");
  const metadata = readImageMetadata(bytes, ".mp4");
  if (!metadata) throw new Error("MP4 格式不合规：仅支持非分片 H.264/AVC 或 H.265/HEVC，最长 60 秒、最高 60 FPS，尺寸需符合限制。");
  let state;
  try { state = JSON.parse(await fs.readFile(statePath, "utf8")); } catch {}
  if (!Number.isInteger(state?.port) || state.port < 1024 || state.port > 65535) {
    throw new Error("无法验证视频解码能力：请先启动 Codex 并连接皮肤运行时，再重试导入或应用。");
  }
  const { materializeMediaSnapshot, probeVideoInCodex } = await import("./injector.mjs");
  const snapshot = await materializeMediaSnapshot(bytes);
  const decoded = await probeVideoInCodex(snapshot, state);
  const current = await fs.readFile(filePath);
  if (!createHash("sha256").update(bytes).digest().equals(createHash("sha256").update(current).digest())) {
    throw new Error("视频在校验期间发生变化，请重试。");
  }
  return { ...decoded, codec: readImageAnimation(bytes, ".mp4")?.codec };
}
