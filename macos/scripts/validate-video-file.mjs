import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateVideoFile } from "./video-decode-probe.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [filePath, statePath, forceFlag] = process.argv.slice(2);
    if (!filePath || !statePath || (forceFlag ? forceFlag !== "--mp4" || process.argv.length !== 5 : process.argv.length !== 4)) throw new Error("Usage: validate-video-file.mjs <media-file> <state-file>");
    console.log(JSON.stringify(await validateVideoFile(filePath, statePath, forceFlag === "--mp4")));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
