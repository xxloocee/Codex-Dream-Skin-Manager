import type { CommunityCompatibility, HelloResult } from "../../../contracts/manager.mjs";
import { uiMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";

export const mergeCommunityCompatibility = (metadata?: CommunityCompatibility, manifest?: CommunityCompatibility): CommunityCompatibility => ({ ...metadata, ...manifest });
export const communityPlatformName = (platform: string) => platform === "windows" ? "Windows" : platform === "macos" ? "macOS" : platform;

function versionParts(value: string | null) {
  const match = value && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value.trim());
  return match ? match.slice(1, 4).map(part => BigInt(part)) : null;
}

// Community declarations explain possible differences; they never decide whether an action is allowed.
export function communityCompatibilityMessages(declaration: CommunityCompatibility | undefined, platform: HelloResult["platform"], engineVersion: string | null): UiMessage[] {
  if (!declaration) return [];
  const result: UiMessage[] = [];
  if (declaration.platforms?.length && !declaration.platforms.includes(platform)) result.push(uiMessage(
    "主题声明支持 {platforms}，未列出当前平台 {platform}。", { platforms: declaration.platforms.map(communityPlatformName).join(" / "), platform: communityPlatformName(platform) }));
  if (declaration.applyCompatible === false) result.push(uiMessage("社区将此主题标记为可能存在兼容性差异。"));
  if (declaration.minClientVersion) {
    const minimum = versionParts(declaration.minClientVersion), current = versionParts(engineVersion);
    const difference = minimum && current ? minimum.findIndex((part, index) => part !== current[index]) : -1;
    if (!minimum || !current || difference >= 0 && minimum[difference]! > current[difference]!) {
      result.push(!minimum || !current ? uiMessage("主题声明最低引擎版本 {minimum}，当前包内引擎版本无法比较。", { minimum: declaration.minClientVersion }) : uiMessage(
        "主题声明最低引擎版本 {minimum}，当前包内引擎为 {current}。", { minimum: declaration.minClientVersion, current: engineVersion ?? "" }));
      result.push(uiMessage("此处比较的是包内皮肤引擎版本，Codex 客户端和正在运行的已部署引擎版本可能不同。"));
    }
  }
  if (declaration.skinApiVersion !== undefined && declaration.skinApiVersion !== 1) result.push(uiMessage("主题声明皮肤 API {version}，当前支持 API 1。", { version: declaration.skinApiVersion }));
  const unknown = declaration.capabilities?.filter(value => !["background", "tokens", "safe-css"].includes(value));
  if (unknown?.length) result.push(uiMessage("主题声明了当前未识别的能力：{capabilities}。", { capabilities: unknown.join(", ") }));
  if (result.length) result.push(uiMessage("仍可尝试应用，部分样式可能有差异；以实际应用结果为准。"));
  return result;
}
