import path from "node:path";
import { createHash } from "node:crypto";
import { readdir, rm, unlink } from "node:fs/promises";
import { parseApplyRefresh, record, validOperationId } from "../contracts/manager.mjs";
import { jsonObject, optionalBytes, safePath } from "../core/local-files.mjs";
import { durableJson, privateDirectory } from "../core/write-files.mjs";

// Invoked by the platform worker before releasing the one operation lock.
// Only a verified success can mark its snapshot reclaimable. No age-based
// inference is made about interrupted requests or uncertain recovery data.
export async function finishPublication(state: string, request: string, outcome: Record<string, unknown>): Promise<void> {
  const root = path.join(state, "manager-operations"), requests = path.join(root, "requests");
  const id = path.basename(request, ".json");
  if (!/^[a-f0-9-]{36}$/.test(id) || path.dirname(request) !== requests) throw new Error("Invalid publication request.");
  const bytes = await optionalBytes(request, requests, 16384);
  if (!bytes) throw new Error("Missing publication request.");
  const value = jsonObject(bytes);
  if (!record(outcome.effects) || outcome.effects.themeCommitted !== true || outcome.effects.rendererApplied !== true || outcome.committedRevision !== value.expectedRevision || !outcome.verifiedRendererRevision || !outcome.runtimeSessionId) throw new Error("Publication was not verified.");
  if (value.refresh !== undefined) {
    const refresh = parseApplyRefresh(value.refresh);
    if (outcome.effects.codexRestarted !== false || outcome.runtimeSessionId !== refresh.runtimeSessionId) {
      throw new Error("Hot refresh publication did not preserve the confirmed runtime session.");
    }
  }
  if (record(value.community) && typeof value.community.recoveryTransaction === "string") outcome = { ...outcome, recoveryTransaction: value.community.recoveryTransaction };
  const command = record(value.runtimeCommand) ? value.runtimeCommand : null;
  const operationId = command && record(command.params) ? command.params.operationId : value.operationId;
  if (validOperationId(operationId)) {
    const directory = path.join(root, command ? "runtime-results" : "apply-results"); await privateDirectory(directory);
    await durableJson(path.join(directory, createHash("sha256").update(operationId).digest("hex") + ".json"), state,
      command ? { schemaVersion: 1, operationId, method: command.method, expectedRuntimeRevision: (command.params as Record<string, unknown>).expectedRuntimeRevision, outcome } :
      { schemaVersion: 1, operationId, method: "skin.apply", theme: value.theme, expectedRevision: value.expectedRevision, outcome });
  }
  await durableJson(path.join(root, "current.json"), state, { schemaVersion: 1, requestFile: path.basename(request), theme: value.theme, revision: value.expectedRevision });
  await durableJson(path.join(requests, id + ".settled"), requests, { schemaVersion: 1 });
  // Inspect reads the active payload directly; it does not retain references
  // to historical request snapshots. Keep only the current settled snapshot.
  for (const name of await readdir(requests)) {
    if (!/^[a-f0-9-]{36}\.settled$/.test(name)) continue;
    const previous = name.slice(0, -8); if (previous === id) continue;
    const snapshot = path.join(root, "snapshots", previous);
    await safePath(path.dirname(snapshot), root);
    await rm(snapshot, { recursive: true, force: true });
    await unlink(path.join(requests, previous + ".json")).catch(() => {});
    await unlink(path.join(requests, name)).catch(() => {});
  }
}
