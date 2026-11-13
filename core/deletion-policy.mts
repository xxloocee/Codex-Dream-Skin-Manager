import path from "node:path";
import { readdir } from "node:fs/promises";
import { boundedText, ContractError, record } from "../contracts/manager.mjs";
import type { ThemeRef } from "../contracts/manager.mjs";
import type { PlatformPort, ThemeInventory } from "./ports/platform.mjs";
import { fileBytes, jsonObject, optionalBytes, safePath } from "./local-files.mjs";
import { OperationStore } from "./operation-store.mjs";
import type { LibraryTransactions } from "./library-transactions.mjs";

export interface DeleteContext { protectedIds: string[]; pendingIds: string[]; presets: string[]; paused: boolean | null; health: string }
export function defaultRecoveryThemeIds(platform: PlatformPort["name"]): string[] {
  return platform === "windows" ? ["preset-paper-light"] : ["preset-gothic-void-crusade", "gothic-void-crusade"];
}
export async function deletionContext(state: string, adapter: PlatformPort, operationId: string, inventory: ThemeInventory, journals: LibraryTransactions, recoveringId?: string): Promise<DeleteContext> {
  const status = await adapter.status();
  if (status.health === "unknown" || status.health === "mismatch" || status.busy) throw new ContractError("THEME_PROTECTED", "Current runtime state cannot safely authorize deletion; resolve the active operation or runtime uncertainty first.");
  const ids = new Set<string>(defaultRecoveryThemeIds(adapter.name)), pendingIds: string[] = [];
  const add = (value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (!boundedText(value, 80)) throw new ContractError("THEME_PROTECTED", "The active theme identity cannot be read safely."); ids.add(value.toLowerCase());
  };
  add(status.activeId); add(status.appliedId);
  for (const name of ["theme/theme.json", "state.json"]) {
    const bytes = await optionalBytes(path.join(state, ...name.split("/")), state, 1024 * 1024); if (!bytes) continue;
    const config = jsonObject(bytes); for (const key of ["id", "themeId", "activeThemeId", "appliedThemeId"]) add(config[key]);
  }
  const ledger = path.join(state, "manager-operations", "ledger"); let names: string[] = [];
  try { await safePath(ledger, state); names = await readdir(ledger); } catch (error) { if (!record(error) || error.code !== "ENOENT") throw error; }
  const store = new OperationStore(state);
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const raw = jsonObject(await fileBytes(path.join(ledger, name), ledger, 65536));
    if (!record(raw.operation) || typeof raw.operation.id !== "string") throw new ContractError("THEME_PROTECTED", "An operation record is unreadable.");
    if (raw.operation.id === operationId) continue;
    const value = await store.read(raw.operation.id); if (!value) throw new ContractError("THEME_PROTECTED", "A pending operation changed while reading.");
    if (value.operation.state === "awaitingConfirmation" && value.operation.confirmation && Date.parse(value.operation.confirmation.expiresAt) <= Date.now()) continue;
    // Explicit recovery owns the writer lock. Its original library job cannot
    // protect itself forever, but an unrelated apply must still protect its target.
    if (raw.operation.id === recoveringId && value.operation.method !== "skin.apply" && value.operation.method !== "library.recover") continue;
    if (value.operation.method !== "skin.apply") {
      const receipt = await journals.read(raw.operation.id);
      if (receipt?.phase === "discarded" || receipt?.phase === "final" && receipt.outcome && !receipt.outcome.error || receipt?.phase === "removed" && receipt.outcome?.deleted === true && !receipt.outcome.error) continue;
    }
    if (["queued", "running", "awaitingConfirmation", "indeterminate"].includes(value.operation.state)) {
      add(value.operation.theme.id); pendingIds.push(value.operation.id);
    }
  }
  return { protectedIds: [...ids].sort(), pendingIds: pendingIds.sort(), presets: inventory.themes.filter(theme => theme.ref.source === "preset").map(theme => theme.ref.id).sort(), paused: status.paused, health: status.health };
}
export function assertDeletionAllowed(ref: ThemeRef, context: DeleteContext, alreadyRemoved = false): void {
  if (context.protectedIds.includes(ref.id.toLowerCase())) throw new ContractError("THEME_PROTECTED", "The active, applied, pending or default recovery theme cannot be deleted.");
  if (ref.source === "preset" && context.presets.length < (alreadyRemoved ? 1 : 2)) throw new ContractError("THEME_PROTECTED", "At least one built-in recovery theme must remain available.");
}
