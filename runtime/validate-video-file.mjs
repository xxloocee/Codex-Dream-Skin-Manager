import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateVideoFile } from "./video-decode-probe.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [filePath, statePath, ...flags] = process.argv.slice(2);
    if (!filePath || !statePath || flags.some(flag => !["--mp4", "--wait-for-renderer"].includes(flag)) || new Set(flags).size !== flags.length) throw new Error("Usage: validate-video-file.mjs <media-file> <state-file> [--mp4] [--wait-for-renderer]");
    const deadline = Date.now() + (flags.includes("--wait-for-renderer") ? 20000 : 0);
    for (;;) {
      try {
        console.log(JSON.stringify(await validateVideoFile(filePath, statePath, flags.includes("--mp4"))));
        break;
      } catch (error) {
        if (error.code !== "DREAMSKIN_VIDEO_RENDERER_PENDING" || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
