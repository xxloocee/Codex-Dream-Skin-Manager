import { record } from "../contracts/manager.mjs";
import type { CommunityCompatibility, CommunityOrigin } from "../contracts/manager.mjs";

// Declarations are hints, not admission rules. Ignore malformed descriptive
// fields without rejecting an otherwise usable theme or its local copy.
export function communityCompatibility(value: unknown): CommunityCompatibility {
  if (!record(value)) return {};
  const result: CommunityCompatibility = {};
  if (typeof value.applyCompatible === "boolean") result.applyCompatible = value.applyCompatible;
  for (const key of ["platforms", "capabilities"] as const) {
    const items = value[key];
    if (Array.isArray(items)) result[key] = [...new Set(items.filter((item): item is string => typeof item === "string" && !!item.trim()).map(item => item.trim()))];
  }
  if (typeof value.minClientVersion === "string" && value.minClientVersion.trim()) result.minClientVersion = value.minClientVersion.trim();
  if (typeof value.skinApiVersion === "number" && Number.isFinite(value.skinApiVersion)) result.skinApiVersion = value.skinApiVersion;
  return result;
}

// Manager-owned provenance, never accepted from a portable package manifest.
export function communityOrigin(value: unknown): CommunityOrigin | null {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.version !== "string" ||
      /^ver_[a-z0-9]{8,64}$/.exec(value.version)?.[0] !== value.version || typeof value.packageSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.packageSha256) || value.packageSha256.length !== 64) return null;
  return { version: value.version, packageSha256: value.packageSha256 };
}
