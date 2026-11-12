import type { Diagnostic, ManagerSnapshot, ThemeRef } from "../../contracts/manager.mjs";

// Filesystem paths remain internal to the platform/core boundary, never the wire.
export interface RevisionFile { file: string; root: string; bytes: Uint8Array | null; maximum?: number }
export interface LocalTheme {
  ref: ThemeRef;
  config: Record<string, unknown>;
  revisionInputs: Uint8Array[];
  revisionFiles: RevisionFile[];
  mediaPath: string;
  mediaRoot: string;
  cssPath: string | null;
  catalogOrder: number;
  modifiedAt: string | null;
}
export interface ThemeInventory { themes: LocalTheme[]; warnings: Diagnostic[] }
export interface PlatformStatus {
  activeId: string | null;
  paused: boolean | null;
  health: ManagerSnapshot["engine"]["health"];
  diagnostics: Diagnostic[];
  appliedId?: string | null;
  busy?: boolean;
}
export interface PlatformPort {
  readonly name: "windows" | "macos";
  applicationVersion(): Promise<string | null>;
  inventory(): Promise<ThemeInventory>;
  defaultTheme?(): Promise<LocalTheme | null>;
  status(): Promise<PlatformStatus>;
  resolveActive(id: string): Promise<ThemeRef | null>;
}
