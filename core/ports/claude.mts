import type { ClaudeParameters, ClaudeSnapshot, Diagnostic } from "../../contracts/manager.mjs";

export interface ClaudeRuntimeObservation {
  connection: ClaudeSnapshot["connection"];
  renderer: ClaudeSnapshot["renderer"];
  diagnostics: Diagnostic[];
  revision: string | null;
}
export interface ClaudeMediaMetadata { mediaKind: "image" | "animatedImage" | "video"; mimeType: string }
export type ClaudeMediaInspector = (bytes: Uint8Array, extension: string) => Promise<ClaudeMediaMetadata>;
export interface ClaudeStartupPayload { enabled: boolean; video: { mimeType: "video/mp4"; mediaBase64: string } | null }
// The adapter owns only its Claude Desktop connection and renderer. Library
// selection, immutable media copies and operation receipts belong to core.
export interface ClaudeRuntimePort {
  inspect(): Promise<ClaudeRuntimeObservation>;
  apply(payload: { revision: string; mimeType: string; mediaBase64: string; mediaKind: ClaudeMediaMetadata["mediaKind"]; parameters: ClaudeParameters }): Promise<ClaudeRuntimeObservation>;
  configureStartup(payload: ClaudeStartupPayload): Promise<void>;
  remove(): Promise<ClaudeRuntimeObservation>;
  close(): Promise<void>;
}
