// Fixed lock-owning platform wrapper calls this helper; never exposed as a
// public path/shell command. The platform lock also protects paused active edits.
import path from "node:path";
import { lstat, mkdir, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ContractError, failure, parseRequest, PROTOCOL, record } from "../contracts/manager.mjs";
import type { ThemeEditCommand, ThemeRef } from "../contracts/manager.mjs";
import { fileBytes, jsonObject, leaf, MAX_CONFIG_BYTES, MAX_MEDIA_BYTES, optionalBytes, safePath, sha256 } from "./local-files.mjs";
import type { RevisionFile } from "./ports/platform.mjs";
import { durableBytes, durableJson, privateDirectory, syncDirectory } from "./write-files.mjs";
import { editTheme, validateEdit } from "./theme-edit.mjs";
import { themeDetails } from "./theme-model.mjs";
import { dataRoot, readAdapter } from "../platforms/factory.mjs";
import { activeTheme } from "./active-theme.mjs";
import { mediaInspector } from "../platforms/media-metadata.mjs";
import { createTheme } from "./theme-import.mjs";
import { validateImportMedia } from "../platforms/import-validation.mjs";
import { importPackage } from "./package-import.mjs";
import { packageValidation } from "../platforms/package-validation.mjs";
import { LibraryTransactions } from "./library-transactions.mjs";
import { OperationStore } from "./operation-store.mjs";
import { deleteTheme, prepareDeletion } from "./theme-delete.mjs";
import { prepareRecovery, recoverLibrary, recoveryPage } from "./library-recovery.mjs";
import { recycleTransaction } from "../platforms/library-trash.mjs";
import type { LibraryOutcome } from "./ports/library.mjs";

let libraryChanged: boolean | null = false;
let resultTheme: ThemeRef | null = null;
let journals: LibraryTransactions | undefined, transactionId: string | undefined;
let intentCreated = false;
let reportedOutcome: LibraryOutcome | undefined;
async function emit(outcome: LibraryOutcome): Promise<void> {
  libraryChanged = outcome.libraryChanged; resultTheme = outcome.resultTheme;
  reportedOutcome = outcome;
  if (journals && transactionId && intentCreated) await journals.finish(transactionId, outcome);
  process.stdout.write(JSON.stringify(outcome) + "\n");
}
try {
  const [applicationRoot, requestFile, extra] = process.argv.slice(2);
  if (!applicationRoot || !requestFile || extra || !path.isAbsolute(applicationRoot) || !path.isAbsolute(requestFile) ||
      process.env.CODEX_MANAGER_LIBRARY_LOCK_HELD !== "1") throw new ContractError("INVALID_REQUEST", "Invalid locked library worker invocation.");
  const state = dataRoot(), requestRoot = path.join(state, "manager-operations", "library-requests");
  if (path.dirname(path.resolve(requestFile)) !== requestRoot || !/^[a-f0-9-]{36}\.json$/.test(path.basename(requestFile))) {
    throw new ContractError("INVALID_REQUEST", "Invalid internal library request.");
  }
  const request = jsonObject(await fileBytes(requestFile, requestRoot, 16384));
  if (request.schemaVersion !== 1) throw new ContractError("INVALID_REQUEST", "Invalid library request schema.");
  const workerAdapter = readAdapter(applicationRoot); journals = new LibraryTransactions(state, applicationRoot, workerAdapter.name);
  if (request.action === "recoveries") {
    process.stdout.write(JSON.stringify(await recoveryPage(journals)) + "\n");
  } else if (request.action === "receipt") {
    if (typeof request.transactionId !== "string") throw new ContractError("INVALID_REQUEST", "Invalid receipt request.");
    let receipt = await journals.read(request.transactionId);
    if (!request.expectedRevision || receipt?.expectedRevision !== request.expectedRevision || receipt?.method !== request.method) receipt = null;
    process.stdout.write(JSON.stringify({ outcome: receipt && (receipt.phase === "final" || receipt.phase === "removed" && receipt.outcome?.deleted === true && !receipt.outcome.error) ? receipt.outcome : null }) + "\n");
  } else {
  if (!record(request.command)) throw new ContractError("INVALID_REQUEST", "Invalid library command.");
  const command = parseRequest({ protocol: PROTOCOL, kind: "request", requestId: "library-worker", ...request.command });
  if (!["themes.update", "themes.copy", "themes.create", "themes.importPackage", "themes.delete", "library.recover"].includes(command.method)) throw new ContractError("INVALID_REQUEST", "Invalid shared library method.");
  if (request.action === "propose") {
    if (command.method !== "themes.delete" && command.method !== "library.recover") throw new ContractError("INVALID_REQUEST", "This library method does not support confirmation.");
    const prepared = command.method === "themes.delete" ? await prepareDeletion(journals, workerAdapter, command) : await prepareRecovery(journals, workerAdapter, command);
    process.stdout.write(JSON.stringify({ challenge: prepared.challenge }) + "\n");
  } else {
  if (!("operationId" in command.params)) throw new ContractError("INVALID_REQUEST", "Missing library operation identity.");
  transactionId = command.params.operationId;
  const intent = await new OperationStore(state).read(transactionId);
  if (!intent || intent.operation.method !== command.method || intent.operation.state !== "running") throw new ContractError("OPERATION_UNKNOWN", "A current durable operation intent is required.");
  await journals.begin(transactionId, command.method, "theme" in command.params ? command.params.theme : null, intent.operation.expectedRevision);
  intentCreated = true;
  if (command.method === "themes.create") {
    const adapter = readAdapter(applicationRoot);
    await emit(await createTheme(state, command, request.source, adapter, mediaInspector(applicationRoot, adapter.name), journals));
  } else if (command.method === "themes.importPackage") {
    const adapter = readAdapter(applicationRoot);
    await emit(await importPackage(state, command, request.source, adapter,
      packageValidation(applicationRoot, adapter.name, () => adapter.applicationVersion()), file => validateImportMedia(applicationRoot, file), journals));
  } else if (command.method === "themes.delete" || command.method === "library.recover") {
    if (typeof request.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(request.fingerprint)) throw new ContractError("INVALID_REQUEST", "Missing confirmed library preflight.");
    const recycle = (value: import("./library-transactions.mjs").LibraryTransaction) => recycleTransaction(journals!, value);
    await emit(command.method === "themes.delete" ? await deleteTheme(journals, workerAdapter, command, request.fingerprint, recycle) :
      await recoverLibrary(journals, workerAdapter, command, request.fingerprint,
        packageValidation(applicationRoot, workerAdapter.name, () => workerAdapter.applicationVersion()), file => validateImportMedia(applicationRoot, file), recycle));
  } else {
  if (command.method !== "themes.update" && command.method !== "themes.copy") throw new ContractError("INVALID_REQUEST", "Invalid library command.");
  const edit: ThemeEditCommand = command, adapter = readAdapter(applicationRoot);
  const inventory = await adapter.inventory();
  const local = inventory.themes.find(value => value.ref.source === edit.params.theme.source && value.ref.id === edit.params.theme.id);
  if (!local) throw new ContractError("THEME_NOT_FOUND", "The selected library theme is no longer available.");
  validateEdit(edit, local.ref);
  if ((await themeDetails(local)).revision !== edit.params.expectedRevision) throw new ContractError("THEME_CHANGED", "The theme changed before saving; refresh without losing your draft.");
  const config = editTheme(local.config, edit.params.patch, adapter.name);
  const libraryRoot = path.join(state, "themes");
  const readResult = async (ref: ThemeRef) => {
    const result = (await adapter.inventory()).themes.find(value => value.ref.source === ref.source && value.ref.id === ref.id);
    if (!result) throw new ContractError("IO_ERROR", "The saved library entry could not be read back.");
    return themeDetails(result);
  };
  if (edit.method === "themes.update") {
    let file: string, value: Record<string, unknown>;
    if (adapter.name === "windows" && local.ref.source === "preset") {
      file = path.join(state, "preset-settings", local.ref.id + ".json");
      const old = await optionalBytes(file, state, 16384);
      const previous = old ? jsonObject(old) : {};
      const previousArt = record(previous.art) ? { ...previous.art } : {};
      for (const key of ["focusX", "focusY", "safeArea", "taskMode", "bubbleOpacity", "surfaceOpacity", "shellOpacity", "positionX", "positionY", "zoom", "positionMode", "framingEnabled", "playbackRate"]) delete previousArt[key];
      // Keep the replacement semantics for art, including omissions.
      value = { ...previous, schemaVersion: 1, appearance: config.appearance ?? "auto", art: { ...previousArt, ...(record(config.art) ? config.art : {}) },
        accent: record(config.palette) ? config.palette.accent ?? "" : "" };
    } else {
      if (path.resolve(local.mediaRoot) !== path.join(libraryRoot, local.ref.id)) throw new ContractError("THEME_INVALID", "The theme is not in the editable library.");
      file = path.join(local.mediaRoot, "theme.json"); value = config;
    }
    const limit = local.ref.source === "preset" && adapter.name === "windows" ? 16384 : MAX_CONFIG_BYTES;
    if (Buffer.byteLength(JSON.stringify(value) + "\n") > limit) throw new ContractError("THEME_INVALID", "The edited configuration exceeds its existing size limit.");
    await privateDirectory(path.dirname(file));
    if ((await themeDetails(local)).revision !== edit.params.expectedRevision) throw new ContractError("THEME_CHANGED", "The theme changed before the configuration commit.");
    const stateBytes = await optionalBytes(path.join(state, "state.json"), state, 65536);
    const paused = adapter.name === "windows" ? (await optionalBytes(path.join(state, "paused"), state, 16384)) !== null
      : stateBytes !== null && jsonObject(stateBytes).session === "paused";
    const active = paused ? await activeTheme(state, adapter.name) : null;
    const syncActive = active?.ref.id === local.ref.id && active.ref.source === local.ref.source ? {
      file: path.join(active.mediaRoot, "theme.json"), config: editTheme(active.config, edit.params.patch, adapter.name),
    } : undefined;
    // Both writes belong to one journal. A partial save cannot later be
    // reconciled as complete while resume would still read the old parameters.
    resultTheme = local.ref; libraryChanged = null;
    await journals.config(transactionId, file, value, resultTheme, syncActive);
    libraryChanged = true;
  } else {
    const id = "custom-" + edit.params.operationId.split(":")[1];
    resultTheme = { source: "saved", id };
    const stage = path.join(libraryRoot, ".manager-copy-" + id.slice(7)), destination = path.join(libraryRoot, id);
    await privateDirectory(libraryRoot);
    try { await lstat(destination); throw new ContractError("OPERATION_CONFLICT", "This copy identity already exists; it will not be overwritten."); }
    catch (error) { if (!record(error) || error.code !== "ENOENT") throw error; }
    const media = await fileBytes(local.mediaPath, local.mediaRoot, MAX_MEDIA_BYTES);
    const css = local.cssPath ? await optionalBytes(local.cssPath, local.mediaRoot, 256 * 1024) : null;
    const license = await optionalBytes(path.join(local.mediaRoot, "LICENSE.txt"), local.mediaRoot, 65536);
    const originalName = config.originalImage === undefined ? null : leaf(config.originalImage);
    const original = originalName ? await fileBytes(path.join(local.mediaRoot, originalName), local.mediaRoot, MAX_MEDIA_BYTES) : null;
    await mediaInspector(applicationRoot, adapter.name)(media, path.extname(local.mediaPath).toLowerCase());
    if (css) {
      const validatorFile = path.join(applicationRoot, adapter.name === "windows" ? "windows" : "macos", "assets", "safe-css-validator.mjs");
      await safePath(validatorFile, applicationRoot);
      const validator = await import(pathToFileURL(validatorFile).href); validator.decodeAndValidateSafeCss(css);
    }
    const name = "background" + path.extname(local.mediaPath).toLowerCase();
    if (originalName && [name, "theme.json", "theme.css", "license.txt"].includes(originalName.toLowerCase())) {
      throw new ContractError("THEME_INVALID", "The original media name conflicts with the copy's resources.");
    }
    config.id = id; config.name = edit.params.name.trim(); config.image = name;
    if (Buffer.byteLength(JSON.stringify(config) + "\n") > MAX_CONFIG_BYTES) throw new ContractError("THEME_INVALID", "The copied configuration exceeds its size limit.");
    await mkdir(stage, { mode: 0o700 }); await safePath(stage, libraryRoot);
    await durableBytes(path.join(stage, name), stage, media);
    if (css) await durableBytes(path.join(stage, "theme.css"), stage, css);
    if (license) await durableBytes(path.join(stage, "LICENSE.txt"), stage, license);
    if (originalName && original) await durableBytes(path.join(stage, originalName), stage, original);
    await durableJson(path.join(stage, "theme.json"), stage, config, true);
    // Compare copied bytes too, preventing an ABA library change from creating
    // a mixed snapshot even when the final source revision matches again.
    const checks: RevisionFile[] = [...local.revisionFiles, { file: local.mediaPath, root: local.mediaRoot, bytes: media, maximum: MAX_MEDIA_BYTES },
      { file: path.join(local.mediaRoot, "LICENSE.txt"), root: local.mediaRoot, bytes: license, maximum: 65536 },
      ...(local.cssPath ? [{ file: local.cssPath, root: local.mediaRoot, bytes: css, maximum: 256 * 1024 }] : []),
      ...(originalName ? [{ file: path.join(local.mediaRoot, originalName), root: local.mediaRoot, bytes: original, maximum: MAX_MEDIA_BYTES }] : [])];
    for (const check of checks) {
      const bytes = await optionalBytes(check.file, check.root, check.maximum);
      const current = check.digest && bytes ? new TextEncoder().encode(sha256([bytes])) : bytes;
      if ((current === null) !== (check.bytes === null) || (current && check.bytes && !Buffer.from(current).equals(check.bytes))) {
        throw new ContractError("THEME_CHANGED", "The source changed while copying; no theme was published.");
      }
    }
    if ((await themeDetails(local)).revision !== edit.params.expectedRevision) throw new ContractError("THEME_CHANGED", "The source revision changed during copying.");
    await safePath(stage, libraryRoot); await safePath(libraryRoot, state); await syncDirectory(stage);
    libraryChanged = null;
    await journals.publish(transactionId, stage, resultTheme);
    libraryChanged = true;
    await syncDirectory(libraryRoot);
  }
  const details = await readResult(resultTheme!);
  await emit({ libraryChanged, resultTheme, resultRevision: details.revision, error: null });
  }
  }
  }
} catch (error) {
  const response = failure(null, error);
  const outcome: LibraryOutcome = { libraryChanged, resultTheme: libraryChanged === false ? null : resultTheme, resultRevision: null, disposition: null,
    ...(reportedOutcome?.deleted !== undefined ? { deleted: reportedOutcome.deleted } : {}),
    ...(reportedOutcome?.cleanupPending !== undefined ? { cleanupPending: reportedOutcome.cleanupPending } : {}),
    ...(reportedOutcome?.recoveryCompleted !== undefined ? { recoveryCompleted: reportedOutcome.recoveryCompleted } : {}),
    error: response.ok ? null : response.error };
  // A failed journal write cannot erase a known filesystem effect.
  if (journals && transactionId && intentCreated) { try { await journals.finish(transactionId, outcome); } catch { } }
  process.stdout.write(JSON.stringify(outcome) + "\n");
}
