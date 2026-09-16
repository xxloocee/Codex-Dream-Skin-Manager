import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  MAX_IMAGE_FRAMES,
  readImageAnimation,
  readRawDimensions,
  classifyImageDimensions,
} from "./image-metadata.mjs";

const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Usage: validate-image-macos.mjs <image>");

const fullPath = path.resolve(file);
const allowed = new Map([
  [".png", "png"], [".apng", "apng"], [".jpg", "jpg"], [".jpeg", "jpeg"], [".webp", "webp"],
  [".gif", "gif"], [".mp4", "mp4"],
  [".heic", "heic"], [".tif", "tiff"], [".tiff", "tiff"],
]);
const format = allowed.get(path.extname(fullPath).toLowerCase());
if (!format) throw new Error("仅支持 PNG、APNG、JPEG、WebP、GIF、MP4、HEIC 和 TIFF。");

const stat = await fs.stat(fullPath).catch(() => null);
if (!stat?.isFile() || stat.size < 1) throw new Error("图片必须是非空普通文件。");
if (stat.size > 50 * 1024 * 1024) throw new Error("图片不能超过 50 MB。");
if (format === "mp4" && stat.size > 30 * 1024 * 1024) {
  throw new Error("MP4 视频不能超过 30 MiB；视频会按原文件保存，不会转码压缩。");
}

const bytes = await fs.readFile(fullPath);
let dimensions = readRawDimensions(bytes, path.extname(fullPath));
if (!dimensions && format !== "mp4") {
  dimensions = await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", fullPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(error.trim() || "sips 无法读取图片尺寸。"));
      const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
      const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
      resolve(Number.isInteger(width) && Number.isInteger(height) ? { width, height } : null);
    });
  });
}
const metadata = dimensions && classifyImageDimensions(dimensions);
if (!metadata) throw new Error(format === "mp4"
  ? "MP4 必须是标准非分片 H.264/AVC 文件，包含可播放媒体，且不能超过 60 秒 / 60 FPS 限制。"
  : "图片已损坏，或超过 16384 像素 / 5000 万像素限制。");
const animation = readImageAnimation(bytes, path.extname(fullPath));
if (!animation || animation.frameCount > MAX_IMAGE_FRAMES) {
  throw new Error("动图帧数不能超过 " + MAX_IMAGE_FRAMES + " 帧。");
}

const canPreview = !["webp", "mp4"].includes(format);
console.log(JSON.stringify({
  path: fullPath,
  format,
  width: metadata.width,
  height: metadata.height,
  bytes: stat.size,
  animated: animation.animated,
  frameCount: animation.frameCount,
  canPreview,
  previewMessage: canPreview ? "" : format === "mp4"
    ? "MP4 视频会在 Codex 中静音循环播放，当前预览器不播放视频。"
    : "WebP 可以保存并应用，但部分预览器可能无法显示。",
}));
