import type { ApplyRefresh, ConfirmationCopy, OperationSnapshot, ThemeRef } from "../../contracts/manager.mjs";

export interface ApplyPreflight {
  fingerprint: string;
  requiresConfirmation: boolean;
  reason: string;
  impact: string;
  copy?: ConfirmationCopy;
}
export interface ApplyOutcome {
  effects: OperationSnapshot["effects"];
  committedRevision: string | null;
  verifiedRendererRevision: string | null;
  runtimeSessionId: string | null;
  recoveryTransaction?: string;
}
export interface ApplyPort {
  receipt?(id: string, theme: ThemeRef, revision: string): Promise<ApplyOutcome | null>;
  inspect?(theme: ThemeRef | null): Promise<ApplyOutcome | null>;
  preflight(theme: ThemeRef, revision: string, refresh?: ApplyRefresh): Promise<ApplyPreflight>;
  apply(theme: ThemeRef, revision: string, preflight: ApplyPreflight, confirmed: boolean, operationId?: string, refresh?: ApplyRefresh): Promise<ApplyOutcome>;
}
