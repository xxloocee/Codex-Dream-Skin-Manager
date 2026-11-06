import type { RuntimeCommand, ThemeRef } from "../../contracts/manager.mjs";
import type { ApplyOutcome, ApplyPreflight } from "./apply.mjs";

export interface RuntimeState {
  revision: string; activeTheme: ThemeRef | null; activeRevision: string | null; paused: boolean;
  fingerprint: string; startRequired: boolean; recoveryRequired: boolean; processRunning: boolean;
  runtimeSessionId: string | null; rendererRemoved: boolean | null; rendererUnavailable: boolean;
  watcherVerified?: boolean;
  defaultTheme: ThemeRef | null; defaultRevision: string | null; appearanceRevision: string; restoreAvailable: boolean;
  engineRevision: string | null; runningEngineRevision: string | null; upgradeRequired: boolean;
  watcherIdentity: string | null;
}
export interface RuntimePreflight extends ApplyPreflight { runtime: RuntimeState; targetTheme: ThemeRef | null; targetRevision: string | null }
export interface RuntimeOutcome extends ApplyOutcome { rendererUnavailable: boolean }
export interface RuntimePort {
  inspect(): Promise<RuntimeState>;
  preflight(command: RuntimeCommand): Promise<RuntimePreflight>;
  execute(command: RuntimeCommand, preflight: RuntimePreflight, confirmed: boolean): Promise<RuntimeOutcome>;
  receipt(id: string, method?: RuntimeCommand["method"], expectedRevision?: string): Promise<RuntimeOutcome | null>;
}
