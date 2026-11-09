import path from "node:path";
import { pathToFileURL } from "node:url";
import { ContractError } from "../contracts/manager.mjs";
import { safePath } from "../core/local-files.mjs";
import type { ClaudeMediaMetadata } from "../core/ports/claude.mjs";

export function mediaInspector(root: string, platform: "windows" | "macos") {
  const inspect = mediaMetadataInspector(root, platform);
  return async (bytes: Uint8Array, extension: string): Promise<void> => { await inspect(bytes, extension); };
}

export function mediaMetadataInspector(root: string, platform: "windows" | "macos") {
  let module: Promise<Record<string, any>> | undefined;
  return async (bytes: Uint8Array, extension: string): Promise<ClaudeMediaMetadata> => {
    if (!module) {
      const file = path.join(root, platform, "scripts", "image-metadata.mjs");
      module = safePath(file, root).then(() => import(pathToFileURL(file).href));
    }
    const metadata = await module;
    const source = Buffer.from(bytes), size = metadata.readImageMetadata(source, extension), animation = metadata.readImageAnimation(source, extension);
    if (!size || !animation || animation.frameCount > metadata.MAX_IMAGE_FRAMES) {
      throw new ContractError("MEDIA_UNSUPPORTED", "The media format or dimensions exceed the existing preview limits.");
    }
    const format = source.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "jpeg"
      : source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : /^GIF8[79]a$/.test(source.toString("ascii", 0, 6)) ? "gif"
      : source.toString("ascii", 0, 4) === "RIFF" && source.toString("ascii", 8, 12) === "WEBP" ? "webp"
      : animation.video === true ? "mp4" : null;
    const normalized = extension.toLowerCase().replace(/^\./, "");
    const expected = normalized === "jpg" ? "jpeg" : normalized === "apng" ? "png" : normalized;
    if (!format || expected !== format) throw new ContractError("MEDIA_UNSUPPORTED", "The media content does not match its extension.");
    return { mediaKind: animation.video === true ? "video" : animation.animated ? "animatedImage" : "image",
      mimeType: format === "mp4" ? "video/mp4" : `image/${format}` };
  };
}
