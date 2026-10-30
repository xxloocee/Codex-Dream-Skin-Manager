import type { UpdateCheck } from "../../contracts/manager.mjs";
import { ContractError } from "../../contracts/manager.mjs";

// Only a platform's explicit pre-launch failure may release the retry guard.
// Missing responses and timeouts must continue to be treated as uncertain.
export class UpdateNotStartedError extends ContractError {
  constructor(message: string) { super("IO_ERROR", message, true); }
}

// Private approval binding includes channel/key/package identity; never a URL
// or installation path supplied by the page.
export interface UpdateCandidate extends Omit<UpdateCheck, "handle" | "expiresAt" | "updateAvailable"> { binding: string }
export interface UpdatePort {
  check(): Promise<UpdateCandidate>;
  install(candidate: UpdateCandidate, operationId: string): Promise<{ managerMustQuit: boolean }>;
  receipt(id: string): Promise<"installed" | "failed" | null>;
}
