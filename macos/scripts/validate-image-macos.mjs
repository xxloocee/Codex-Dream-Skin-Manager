import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { readRawDimensions, classifyImageDimensions } from "./image-metadata.mjs";

const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Usage: validate-image-macos.mjs <image>");

const fullPath = path.resolve(file);
const allowed = new Map([
  [".png", "png"], [".jpg", "jpg"], [".jpeg", "jpeg"], [".webp", "webp"],
  [".heic", "heic"], [".tif", "tiff"], [".tiff", "tiff"],
]);
const format = allowed.get(path.extname(fullPath).toLowerCase());
if (!format) throw new Error("仅支持 PNG、JPEG、WebP、HEIC 和 TIFF 图片。");

const stat = await fs.stat(fullPath).catch(() => null);
if (!stat?.isFile() || stat.size < 1) throw new Error("图片必须是非空普通文件。");
if (stat.size > 50 * 1024 * 1024) throw new Error("图片不能超过 50 MB。");

const bytes = await fs.readFile(fullPath);
let dimensions = readRawDimensions(bytes, path.extname(fullPath));
if (!dimensions) {
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
if (!metadata) throw new Error("图片已损坏，或超过 16384 像素 / 5000 万像素限制。");

const canPreview = format !== "webp";
console.log(JSON.stringify({
  path: fullPath,
  format,
  width: metadata.width,
  height: metadata.height,
  bytes: stat.size,
  canPreview,
  previewMessage: canPreview ? "" : "WebP 可以保存并应用，但部分预览器可能无法显示。",
}));
