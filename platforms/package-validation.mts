import path from "node:path";
import { pathToFileURL } from "node:url";
import { ContractError } from "../contracts/manager.mjs";
import type { PackageValidation } from "../core/theme-package.mjs";
import { safePath } from "../core/local-files.mjs";
import { mediaInspector } from "./media-metadata.mjs";
import { transactionProcess } from "./transaction-process.mjs";

export function packageValidation(root: string, platform: "windows" | "macos", version: () => Promise<string | null>): PackageValidation {
  const load = async (name: string) => {
    const file = path.join(root, platform, "assets", name + ".mjs"); await safePath(file, root); return import(pathToFileURL(file).href);
  };
  return { platform, inspect: mediaInspector(root, platform),
    async css(bytes) {
      try { (await load("safe-css-validator")).decodeAndValidateSafeCss(Buffer.from(bytes)); }
      catch { throw new ContractError("THEME_INVALID", "The package contains unsupported Safe CSS."); }
    },
    async legacyZip(files, community = false) {
      const clientVersion = community ? "" : await version();
      if (!community && !clientVersion) throw new ContractError("THEME_INVALID", "无法读取本地主题引擎版本，无法校验主题包。");
      const validator = await load("theme-package-validator");
      try {
        return await validator.validateThemePackageBytes(files, platform, clientVersion, { allowCrossPlatform: community, allowCompatibilityMismatch: community });
      } catch (error) { throw new ContractError("THEME_INVALID", `主题包校验失败：${error instanceof Error ? error.message : "无法识别包内容"}`); }
    },
    async payload(directory) {
      if (platform !== "macos") return;
      const script = path.join(root, "macos", "scripts", "injector.mjs"); await safePath(script, root);
      try { await transactionProcess(process.execPath, [script, "--check-payload", "--theme-dir", directory], 120000, false); }
      catch { throw new ContractError("THEME_INVALID", "The existing Mac payload compiler refused this package."); }
    },
  };
}
