import { powerShellArgs } from "./windows/powershell.mjs";
import path from "node:path";
import { access, copyFile, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { ContractError, record, validOperationId } from "../contracts/manager.mjs";
import type { UpdateCandidate, UpdatePort } from "../core/ports/updates.mjs";
import { UpdateNotStartedError } from "../core/ports/updates.mjs";
import { fileBytes, jsonObject, optionalBytes, safePath, sha256 } from "../core/local-files.mjs";
import { stableVersion } from "../core/updates.mjs";
import { transactionProcess } from "./transaction-process.mjs";

const repository = "xxloocee/Codex-Dream-Skin-Manager";
const windowsUpdateErrors: Record<string, string> = {
  checking: "无法获取或解析更新清单，请检查网络连接后重新检查。",
  approval: "更新版本或安装包身份已改变，请重新检查后再安装。",
  checksumDownload: "更新校验清单下载失败，请检查网络连接后重试。",
  checksumValidation: "更新校验清单无效，已停止安装，请重新检查更新。",
  installerDownload: "安装包下载失败，请检查网络连接后重试。",
  installerValidation: "安装包文件校验失败，已停止安装，请重新下载。",
  checksumMismatch: "安装包 SHA-256 与发布清单不一致，已停止安装。",
  installerEmpty: "下载的安装包为空，已停止安装，请重新下载。",
  installerLaunch: "安装器启动结果未确认，请核对系统安装提示。",
  downloadTimeout: "更新下载超时，请检查网络连接后重试。",
};
interface PrivateCandidate { raw: Record<string, unknown>; repo: string; target: string | null; bundle: string | null }
export class PlatformUpdates implements UpdatePort {
  private readonly candidates = new Map<string, PrivateCandidate>();
  private readonly platform = process.platform === "win32" ? "windows" : "macos";
  constructor(private readonly root: string, private readonly state: string) {}
  private async windows(action: "Check" | "Install", candidate?: UpdateCandidate): Promise<Record<string, unknown>> {
    const script = path.join(this.root, "windows", "scripts", "manager-updates.ps1"); await safePath(script, this.root);
    const system = process.env.SystemRoot;
    if (!system || !path.isAbsolute(system)) throw new ContractError("BACKEND_UNAVAILABLE", "Windows system directory unavailable.");
    const approved = candidate ? this.candidates.get(candidate.binding) : null;
    const raw = await transactionProcess(path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      await powerShellArgs(this.root, script, ["-Action", action, ...(candidate ? ["-ExpectedVersion", candidate.latestVersion, "-ApprovedHash", String(approved?.raw.installerSha256)] : [])]), action === "Check" ? 45000 : 360000, action === "Install");
    if (typeof raw.updateError === "string") {
      const message = windowsUpdateErrors[raw.updateError] ?? "更新处理失败，请重新检查更新。";
      if (action === "Install" && raw.installerLaunchAttempted === false) throw new UpdateNotStartedError(message);
      throw new ContractError("IO_ERROR", message);
    }
    return raw;
  }
  private async signed(action: "inspect" | "prepare", candidate?: UpdateCandidate): Promise<Record<string, unknown>> {
    const script = path.join(this.root, "macos", "scripts", "gui-update.mjs"); await safePath(script, this.root);
    const approved = candidate ? this.candidates.get(candidate.binding) : null;
    return transactionProcess(process.execPath, [script, action, ...(candidate ? [candidate.latestVersion, String(approved?.raw.manifestDigest)] : [])], action === "inspect" ? 120000 : 600000, action === "prepare");
  }
  private async plist(file: string, field: string): Promise<string> {
    await safePath(file, path.parse(file).root);
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn("/usr/libexec/PlistBuddy", ["-c", "Print :" + field, file], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let text = "", size = 0; const timer = setTimeout(() => child.kill(), 10000);
      child.stdout.on("data", (bytes: Buffer) => { size += bytes.length; if (size > 16384) child.kill(); else text += bytes.toString("utf8"); });
      child.stderr.on("data", () => {}); child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); if (code !== 0 || size > 16384) reject(new ContractError("IO_ERROR", "无法读取应用或安装结果身份。")); else resolve(text.trim()); });
    }); return result;
  }
  private async target(bundle: string, version: string): Promise<string | null> {
    // Application root must be the Resources directory of this exact bundle.
    if (path.basename(this.root) !== "Resources" || path.basename(path.dirname(this.root)) !== "Contents") return null;
    const target = path.dirname(path.dirname(this.root));
    if (!target.endsWith(".app") || target.startsWith("/Volumes/")) return null;
    await safePath(target, path.parse(target).root);
    if (await this.plist(path.join(target, "Contents", "Info.plist"), "CFBundleIdentifier") !== bundle) return null;
    if (await this.plist(path.join(target, "Contents", "Info.plist"), "DreamSkinGUIVersion") !== version) return null;
    try { await access(path.dirname(target), constants.W_OK); } catch { return null; }
    return target;
  }
  async check(): Promise<UpdateCandidate> {
    let raw: Record<string, unknown>, repo = repository, channel: UpdateCandidate["channel"], mode: UpdateCandidate["installMode"] = "manual";
    let config: Uint8Array | null = null, key: Uint8Array | null = null, target: string | null = null, bundle: string | null = null;
    let reason = "此通道通过发布页手动下载，不自动替换应用。", trust = "请通过发布页选择安装包并确认系统安装提示。";
    if (this.platform === "windows") {
      raw = await this.windows("Check"); channel = "windows-release";
      try {
        const executable = path.join(this.root, "CodexDreamSkinManager.exe"); await safePath(executable, this.root);
        if ((await lstat(executable)).isFile()) { mode = "windows-installer"; reason = "下载校验完成后启动 Windows 安装器；安装时可能关闭当前管理器。"; }
      } catch (error) { if (!record(error) || error.code !== "ENOENT") throw error; }
      trust = "安装包 SHA-256 必须与 update.json、SHA256SUMS.txt 和实际下载内容一致。";
    } else {
      config = await optionalBytes(path.join(this.root, "macos", "updater", "channel.json"), this.root, 65536);
      const parsed = config ? jsonObject(config) : null;
      if (parsed && parsed.enabled !== false) {
        if (typeof parsed.repository !== "string" || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.exec(parsed.repository)?.[0] !== parsed.repository || typeof parsed.bundleIdentifier !== "string" || !/^[A-Za-z0-9.-]{1,120}$/.test(parsed.bundleIdentifier)) throw new ContractError("IO_ERROR", "签名更新源配置无效，未回退普通通道。");
        repo = parsed.repository; bundle = parsed.bundleIdentifier; channel = "macos-gui";
        key = await fileBytes(path.join(this.root, "macos", "updater", "public-key.pem"), this.root, 65536);
        if (typeof parsed.version !== "string") throw new ContractError("IO_ERROR", "GUI 通道当前版本缺失。");
        raw = await this.signed("inspect"); target = await this.target(bundle, stableVersion(parsed.version));
        if (target) { mode = "macos-signed"; reason = "验证签名和应用身份后，正常退出管理器，由外部 helper 替换 app 并保留旧 bundle。"; }
        else reason = "当前应用安装身份与签名通道不匹配，或位于只读/DMG 目录；请前往该签名发布页，请手动安装。";
        trust = "固定公钥 Ed25519 校验清单；包大小/hash、架构、codesign、bundle/GUI 版本、下一版本更新源与公钥均核对。";
        if (typeof raw.manifestDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.manifestDigest) || typeof raw.packageSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.packageSha256) || !Number.isSafeInteger(raw.packageBytes) || (raw.packageBytes as number) < 1 || (raw.packageBytes as number) > 512 * 1048576) throw new ContractError("IO_ERROR", "签名更新检查缺少批准包绑定。");
      } else {
        const script = path.join(this.root, "macos", "scripts", "check-update-macos.sh"); await safePath(script, this.root);
        raw = await transactionProcess("/bin/bash", [script, "--json"], 45000, false,
          { CODEX_DREAM_SKIN_TEST_RESPONSE_FILE: "", CODEX_DREAM_SKIN_TEST_REDIRECT_HEADERS_FILE: "" });
        channel = "macos-release";
      }
    }
    if (typeof raw.currentVersion !== "string" || typeof raw.latestVersion !== "string") throw new ContractError("IO_ERROR", "更新检查返回无效版本。");
    const currentVersion = stableVersion(raw.currentVersion), latestVersion = stableVersion(raw.latestVersion);
    const tag = (channel === "macos-gui" ? "gui-v" : "v") + latestVersion;
    const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
    if (channel !== "macos-release" && raw.releaseUrl !== releaseUrl) throw new ContractError("IO_ERROR", "更新发布页不属于批准通道。");
    const binding = sha256([Buffer.from(JSON.stringify({ currentVersion, latestVersion, channel, mode, repo, target, bundle,
      installerHash: raw.installerSha256 ?? null, manifest: raw.manifestDigest ?? null, packageHash: raw.packageSha256 ?? null })), config ?? new Uint8Array(), key ?? new Uint8Array()]);
    if (this.candidates.size >= 16) this.candidates.delete(this.candidates.keys().next().value!);
    this.candidates.set(binding, { raw, repo, target, bundle });
    return { currentVersion, latestVersion, channel, releaseUrl, installMode: mode, reason, trust, binding };
  }
  private resultFile(id: string): string {
    if (!validOperationId(id)) throw new ContractError("INVALID_REQUEST", "Invalid update result identity.");
    return path.join(this.state, "updates", "manager-" + sha256([Buffer.from(id)]) + ".plist");
  }
  async install(candidate: UpdateCandidate, id: string): Promise<{ managerMustQuit: boolean }> {
    const privateCandidate = this.candidates.get(candidate.binding);
    if (!privateCandidate) throw new ContractError("RESOURCE_EXPIRED", "更新批准绑定已失效。");
    if (candidate.installMode === "windows-installer") {
      const raw = await this.windows("Install", candidate);
      if (raw.installerStarted !== true || typeof raw.installerProcessId !== "number" || raw.installerProcessId <= 0) throw new ContractError("IO_ERROR", "安装器未确认启动。");
      return { managerMustQuit: false };
    }
    if (candidate.installMode !== "macos-signed" || !privateCandidate.bundle || !privateCandidate.target || await this.target(privateCandidate.bundle, candidate.currentVersion) !== privateCandidate.target) throw new ContractError("METHOD_UNSUPPORTED", "当前包不能自动替换。");
    const raw = await this.signed("prepare", candidate), updates = path.join(this.state, "updates");
    if (typeof raw.stage !== "string" || typeof raw.stagedApp !== "string" || path.dirname(raw.stage) !== updates || !path.basename(raw.stage).startsWith("download-") ||
        path.basename(raw.stagedApp) !== "Codex Dream Skin.app" || path.dirname(raw.stagedApp) !== path.join(raw.stage, "payload")) throw new ContractError("IO_ERROR", "签名更新暂存位置无效。");
    await safePath(raw.stage, this.state); await safePath(raw.stagedApp, raw.stage);
    const source = path.join(this.root, "macos", "scripts", "gui-install-update.sh"); await safePath(source, this.root);
    const helper = path.join(raw.stage, "manager-install.sh"); await copyFile(source, helper, constants.COPYFILE_EXCL); await safePath(helper, raw.stage);
    const log = await open(path.join(raw.stage, "manager-install.log"), "wx", 0o600);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("/bin/bash", [helper, raw.stagedApp as string, privateCandidate.target!, String(process.ppid), candidate.latestVersion, this.resultFile(id), privateCandidate.bundle!],
          { shell: false, detached: true, cwd: raw.stage as string, stdio: ["ignore", log.fd, log.fd] });
        child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
      });
    } finally { await log.close(); }
    return { managerMustQuit: true };
  }
  async receipt(id: string): Promise<"installed" | "failed" | null> {
    if (this.platform !== "macos") return null;
    const bytes = await optionalBytes(this.resultFile(id), this.state, 65536); if (!bytes) return null;
    const status = await this.plist(this.resultFile(id), "status");
    return status === "installed" || status === "failed" ? status : null;
  }
}
