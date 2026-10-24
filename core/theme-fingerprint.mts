import { parameters } from "./theme-model.mjs";
import { canonicalJson } from "./theme-edit.mjs";
import { sha256 } from "./local-files.mjs";

// Labels and original conversion sources do not change rendering. Automatic
// Focus and shell opacity defaults remain distinct from explicitly fixed values.
export function themeFingerprint(config: Record<string, unknown>, media: Uint8Array, css: Uint8Array | null): string {
  const { stored, preview } = parameters(config);
  const render = { ...preview, focusX: stored.focusX, focusY: stored.focusY, shellOpacity: stored.shellOpacity, accent: stored.accent?.toUpperCase() ?? null };
  return sha256([new TextEncoder().encode(canonicalJson(render)), media, css ?? new Uint8Array()]);
}
