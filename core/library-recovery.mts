import path from "node:path";
import { lstat } from "node:fs/promises";
import { ContractError, failure, record } from "../contracts/manager.mjs";
import type { LibraryRecoveryCommand, RecoveryAction, RecoveryEntry, RecoveryPage } from "../contracts/manager.mjs";
import type { LibraryOutcome, LibraryChallenge } from "./ports/library.mjs";
import type { PlatformPort } from "./ports/platform.mjs";
import type { PackageValidation } from "./theme-package.mjs";
import { LibraryTransactions } from "./library-transactions.mjs";
import type { LibraryTransaction } from "./library-transactions.mjs";
import { assertTree, removeTree, treeRevision, treeSnapshot } from "./managed-tree.mjs";
import { fileBytes, jsonObject, optionalBytes, safePath, sha256 } from "./local-files.mjs";
import { canonicalJson } from "./theme-edit.mjs";
import { byteHash } from "./source-snapshots.mjs";
import { themeDetails } from "./theme-model.mjs";
import { assertDeletionAllowed, deletionContext } from "./deletion-policy.mjs";
import { finishRemovalMetadata } from "./theme-delete.mjs";

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if (record(error) && error.code === "ENOENT") return false; throw error; }
}
export async function recoveryEntry(journals: LibraryTransactions, value: LibraryTransaction): Promise<RecoveryEntry | null> {
  const actions: RecoveryAction[] = []; let stageRevision: string | null = null, targetRevision: string | null = null, activeRevision: string | null = null;
  if (value.stage && await exists(journals.stage(value))) {
    await safePath(journals.stage(value), journals.root(value.stage.location));
    const current = await treeSnapshot(journals.stage(value)); stageRevision = treeRevision(current);
    if (!value.deletion) {
      actions.push("discardStage");
      if (value.phase !== "final" && value.outcome?.disposition !== "duplicate" && value.tree && treeRevision(value.tree) === stageRevision && value.theme && value.stage.location === "library" && !await exists(path.join(journals.root("library"), value.theme.id))) actions.push("finishImport");
    } else if (value.tree && ["committing", "removed"].includes(value.phase)) {
      await assertTree(journals.stage(value), value.tree, true);
      const original = value.deletion.kind === "catalog" ? path.join(journals.root("presets"), value.deletion.originalName) : path.join(value.stage.location === "presets" ? journals.root("presets") : journals.root("library"), value.deletion.originalName);
      if (!await exists(original)) actions.push("cleanupDeleted");
    }
  }
  if (value.theme && value.tree && !value.deletion) {
    const target = path.join(journals.root("library"), value.theme.id);
    if (await exists(target)) {
      targetRevision = treeRevision(await treeSnapshot(target));
      if (targetRevision === treeRevision(value.tree)) actions.push("reconcile");
    }
  }
  if (value.targetFile) {
    const file = path.join(journals.root(value.targetFile.location), ...value.targetFile.name.split("/"));
    const bytes = await optionalBytes(file, journals.root(value.targetFile.location), 1024 * 1024);
    targetRevision = bytes ? byteHash(bytes) : null;
    if (value.activeConfig) {
      const active = await optionalBytes(path.join(journals.state, ...value.activeConfig.name.split("/")), journals.state, 1024 * 1024);
      activeRevision = active ? byteHash(active) : null;
    }
    if (targetRevision === value.targetFile.hash && (!value.activeConfig || activeRevision === value.activeConfig.hash)) actions.push("reconcile");
  }
  if (value.deletion && !stageRevision && ["removed", "final"].includes(value.phase)) {
    const original = value.deletion.kind === "catalog" ? path.join(journals.root("presets"), value.deletion.originalName) : path.join(value.stage?.location === "presets" ? journals.root("presets") : journals.root("library"), value.deletion.originalName);
    if (!await exists(original)) actions.push("reconcile");
  }
  if (value.deletion?.kind === "catalog") {
    const bytes = await fileBytes(path.join(journals.root("presets"), "catalog.json"), journals.root("presets"));
    targetRevision = byteHash(bytes);
    if (targetRevision !== value.deletion.catalogHash && canonicalJson(jsonObject(bytes)) !== canonicalJson(value.deletion.catalogAfter)) throw new ContractError("RECOVERY_CHANGED", "The preset catalog changed; retain this transaction for manual resolution.");
  }
  if (value.phase === "discarded" || value.phase === "final" && !stageRevision) return null;
  if (!stageRevision && !targetRevision && !value.deletion && value.outcome?.libraryChanged === false) return null;
  const revision = sha256([Buffer.from(canonicalJson({ transaction: value, stageRevision, targetRevision, activeRevision }))]);
  return { transactionId: value.operationId, theme: value.theme, method: value.method, phase: value.phase, revision,
    actions: [...new Set(actions)], message: actions.length ? "已保留事务来源与内容摘要，请选择单项恢复动作。" : "没有可安全自动完成的动作；保留素材及记录，需人工处理。" };
}
export async function recoveryPage(journals: LibraryTransactions): Promise<RecoveryPage> {
  const result: RecoveryPage = { entries: [], warnings: [] };
  for (const value of await journals.all()) {
    try { const item = await recoveryEntry(journals, value); if (item) result.entries.push(item); }
    catch { if (result.warnings.length < 128) result.warnings.push({ code: "RECOVERY_CHANGED", message: "A transaction or its files cannot be inspected safely; it was retained for manual resolution." }); }
  }
  result.entries.sort((a, b) => Number(b.actions.length > 0) - Number(a.actions.length > 0) || a.transactionId.localeCompare(b.transactionId));
  if (result.entries.length > 128) { result.entries = result.entries.slice(0, 128); result.warnings.push({ code: "BUSY", message: "Only the first 128 retained transactions are shown; resolve these and refresh for the remainder." }); }
  return result;
}
export async function prepareRecovery(journals: LibraryTransactions, adapter: PlatformPort, command: LibraryRecoveryCommand) {
  const value = await journals.read(command.params.transactionId); if (!value) throw new ContractError("OPERATION_UNKNOWN", "The recovery transaction is unknown.");
  const item = await recoveryEntry(journals, value);
  if (!item || item.revision !== command.params.expectedRevision || !item.actions.includes(command.params.action)) throw new ContractError("RECOVERY_CHANGED", "Refresh the recovery list; this transaction no longer matches the selected action.");
  const context = command.params.action === "reconcile" && !value.deletion ? null
    : await deletionContext(journals.state, adapter, command.params.operationId, await adapter.inventory(), journals, value.operationId);
  if (value.theme && context) assertDeletionAllowed(value.theme, context, !!value.deletion);
  const fingerprint = sha256([Buffer.from(canonicalJson({ item, action: command.params.action, context }))]);
  const impact: Record<RecoveryAction, string> = { reconcile: "仅核对已发布内容并记录可确认结果，不重放原操作。", finishImport: "重新校验完整暂存后发布到主题库；不会应用或启动 Codex。", discardStage: "永久删除这一事务保留的暂存素材，不修改已发布主题。", cleanupDeleted: value.theme?.source === "preset" ? "完成已移除内置主题的系统回收站或废纸篓处理。" : "永久清理这一已移除主题的隔离素材。" };
  const challenge: LibraryChallenge = { fingerprint, theme: value.theme ?? { source: "saved", id: "recovery-" + command.params.transactionId.split(":")[1] }, revision: item.revision,
    reason: `处理 ${value.theme?.id ?? "未完成事务"}？`, impact: impact[command.params.action],
    copy: { kind: command.params.action === "reconcile" ? "recoverReconcile" : command.params.action === "finishImport" ? "recoverImport" : command.params.action === "discardStage" ? "recoverDiscard" : value.theme?.source === "preset" ? "recoverPreset" : "recoverSaved", ...(value.theme ? { subject: value.theme.id } : {}) } };
  return { value, challenge };
}
export async function recoverLibrary(journals: LibraryTransactions, adapter: PlatformPort, command: LibraryRecoveryCommand, fingerprint: string,
  validation: PackageValidation, validateMedia: (file: string) => Promise<void>, recycle: (value: LibraryTransaction) => Promise<void>): Promise<LibraryOutcome> {
  let changed: boolean | null = false;
  try {
    const prepared = await prepareRecovery(journals, adapter, command);
    if (fingerprint !== prepared.challenge.fingerprint) throw new ContractError("RECOVERY_CHANGED", "Recovery conditions changed after confirmation.");
    const value = prepared.value;
    if (command.params.action === "finishImport") {
      const stage = journals.stage(value); if (!value.tree || !value.theme) throw new ContractError("IO_ERROR", "The prepared import is incomplete.");
      await assertTree(stage, value.tree);
      const config = jsonObject(await fileBytes(path.join(stage, "theme.json"), stage));
      if (config.schemaVersion !== 1 || config.id !== value.theme.id || typeof config.image !== "string" || !/^background\.(png|apng|jpe?g|webp|gif|mp4)$/.test(config.image)) throw new ContractError("THEME_INVALID", "The staged theme identity or background is invalid.");
      const media = path.join(stage, config.image); await validation.inspect(await fileBytes(media, stage, 128 * 1024 * 1024), path.extname(media));
      const css = await optionalBytes(path.join(stage, "theme.css"), stage, 256 * 1024); if (css) await validation.css(css);
      await validateMedia(media); if (journals.platform === "macos") await validation.payload(stage);
      // Decode can take time: refresh both content and protected state again.
      if ((await prepareRecovery(journals, adapter, command)).challenge.fingerprint !== fingerprint) throw new ContractError("RECOVERY_CHANGED", "Recovery conditions changed during validation.");
      changed = null; await journals.publishRecorded(value); changed = true;
    } else if (command.params.action === "discardStage") {
      if (!value.stage || value.deletion) throw new ContractError("THEME_INVALID", "This is not an import stage.");
      const stage = journals.stage(value), tree = await treeSnapshot(stage);
      await removeTree(stage, tree); value.phase = value.outcome && !value.outcome.error ? "final" : "discarded"; await journals.write(value);
      return { libraryChanged: false, resultTheme: value.outcome?.resultTheme ?? value.theme, resultRevision: null, recoveryCompleted: true, error: null };
    } else if (command.params.action === "cleanupDeleted") {
      if (!value.tree || !value.deletion || !value.theme) throw new ContractError("IO_ERROR", "Deletion provenance is incomplete.");
      changed = null; await finishRemovalMetadata(journals, value); changed = true;
      const stage = journals.stage(value); await assertTree(stage, value.tree, true);
      if (value.theme.source === "preset") await recycle(value); else await removeTree(stage, value.tree, true);
      value.phase = "removed"; await journals.write(value);
    }
    if (value.deletion) {
      changed = null; await finishRemovalMetadata(journals, value); changed = true;
      const result: LibraryOutcome = { libraryChanged: true, resultTheme: value.theme, resultRevision: value.outcome?.resultRevision ?? null, deleted: true, cleanupPending: false, error: null };
      await journals.finish(value.operationId, result);
      return { ...result, libraryChanged: changed, recoveryCompleted: true };
    }
    if (!value.theme) throw new ContractError("IO_ERROR", "The recovered target identity is unknown.");
    const local = (await adapter.inventory()).themes.find(local => local.ref.id === value.theme!.id && local.ref.source === value.theme!.source);
    if (!local) throw new ContractError("THEME_NOT_FOUND", "The recovered target could not be read.");
    const result: LibraryOutcome = { libraryChanged: true, resultTheme: local.ref, resultRevision: (await themeDetails(local)).revision,
      ...(value.method === "themes.create" || value.method === "themes.importPackage" ? { disposition: "created" as const } : {}), error: null };
    await journals.finish(value.operationId, result); return { ...result, libraryChanged: changed, recoveryCompleted: true };
  } catch (error) { const response = failure(null, error); return { libraryChanged: changed, resultTheme: null, resultRevision: null, recoveryCompleted: false, error: response.ok ? null : response.error }; }
}
