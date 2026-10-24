// Shared wire types and validation. This module deliberately has no imports.
export const PROTOCOL = "dreamskin.manager/1";
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const READ_METHODS = ["system.hello", "status.get", "themes.list", "themes.get", "themes.active", "media.activePreview", "media.release"] as const;
export const SESSION_METHODS = ["events.subscribe", "events.unsubscribe", "session.close"] as const;
export type ReadMethod = typeof READ_METHODS[number];
export const MEDIA_METHOD = "media.resolve" as const;
export const OPERATION_METHODS = ["skin.apply", "operations.get", "operations.confirm", "operations.list"] as const;
export const LIBRARY_METHODS = ["themes.update", "themes.copy"] as const;
export type ThemeEditMethod = typeof LIBRARY_METHODS[number];
export const SOURCE_METHODS = ["files.select", "sources.preview", "sources.release", "themes.create", "files.saveOriginal", "files.playOriginal"] as const;
export const PACKAGE_METHODS = ["files.selectPackages", "packages.inspect", "packages.preview", "packages.release", "themes.importPackage", "files.exportPackage"] as const;
export const COMMUNITY_METHODS = ["community.inspect", "community.download", "community.import", "community.apply"] as const;
export const UPDATE_METHODS = ["updates.check", "updates.install", "updates.get", "updates.openRelease", "updates.quit"] as const;
export const DESKTOP_METHODS = ["desktop.get", "desktop.open", "desktop.language", "desktop.login", "desktop.intents", "desktop.notifyUpdate"] as const;
export const MAINTENANCE_METHODS = ["maintenance.inspect", "maintenance.prepare", "maintenance.execute", "maintenance.get"] as const;
export const RECOVERY_METHODS = ["themes.delete", "library.recovery.list", "library.recover"] as const;
export const RUNTIME_METHODS = ["skin.pause", "skin.resume", "skin.reset", "skin.restore", "runtime.repair", "runtime.upgrade"] as const;
export const STARTUP_METHODS = ["startup.get", "startup.update"] as const;
export type RuntimeMethod = typeof RUNTIME_METHODS[number];
export type RuntimeCommand = { method: RuntimeMethod; params: { operationId: string; expectedRuntimeRevision: string } };
export type ManagerMethod = ReadMethod | typeof SESSION_METHODS[number] | typeof MEDIA_METHOD | typeof OPERATION_METHODS[number] | ThemeEditMethod | typeof SOURCE_METHODS[number] | typeof PACKAGE_METHODS[number] | typeof COMMUNITY_METHODS[number] | typeof UPDATE_METHODS[number] | typeof DESKTOP_METHODS[number] | typeof MAINTENANCE_METHODS[number] | typeof RECOVERY_METHODS[number] | RuntimeMethod | typeof STARTUP_METHODS[number];
export const ERROR_CODES = [
  "PROTOCOL_UNSUPPORTED", "INVALID_REQUEST", "METHOD_UNSUPPORTED", "BACKEND_UNAVAILABLE",
  "THEME_NOT_FOUND", "THEME_INVALID", "THEME_CHANGED", "CATALOG_CHANGED", "MEDIA_UNSUPPORTED",
  "RESOURCE_EXPIRED", "BUSY", "CONFIRMATION_EXPIRED", "OPERATION_CONFLICT", "OPERATION_UNKNOWN",
  "RUNTIME_UNAVAILABLE", "RENDERER_UNVERIFIED", "IO_ERROR", "TIMEOUT",
  "THEME_PROTECTED", "RECOVERY_CHANGED", "RUNTIME_CHANGED",
] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export interface ManagerError { code: ErrorCode; message: string; retryable: boolean }
export class ContractError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false) {
    super(message);
    this.name = "ContractError";
  }
}
export interface ThemeRef { source: "preset" | "saved"; id: string }
export interface ApplyRefresh { activeRevision: string; runtimeSessionId: string; opacityOnly?: true }
export interface StartupAnimationSettings { enabled: boolean; theme: ThemeRef | null; themeName: string | null }
export interface StartupAnimationUpdate { enabled?: boolean; theme?: ThemeRef | null; expectedRevision?: string }
export interface Diagnostic { code: string; message: string }
export interface ThemeParameters {
  appearance: "auto" | "light" | "dark" | null;
  focusX: number | null;
  focusY: number | null;
  positionX: number | null;
  positionY: number | null;
  zoom: number | null;
  playbackRate: number | null;
  positionMode: "locked" | "free" | null;
  framingEnabled: boolean | null;
  safeArea: "auto" | "left" | "right" | "center" | "none" | null;
  taskMode: "auto" | "ambient" | "banner" | "full" | "off" | null;
  bubbleOpacity: number | null;
  surfaceOpacity: number | null;
  shellOpacity: number | null;
  accent: string | null;
}
export interface ThemeSummary {
  ref: ThemeRef;
  name: string;
  storageCategory: string;
  displayCategories: string[];
  tags: string[];
  mediaKind: "image" | "animatedImage" | "video";
  catalogOrder: number;
  addedAt: string | null;
  modifiedAt: string | null;
  revision: string;
}
export interface ThemeDetails extends ThemeSummary {
  storedParameters: ThemeParameters;
  previewParameters: ThemeParameters;
  media: { mimeType: string; byteLength: number; width: number | null; height: number | null };
  warnings: Diagnostic[];
  availability: { apply: { allowed: boolean; reasonCode: string | null }; update: { allowed: boolean; reasonCode: string | null };
    copy: { allowed: boolean; reasonCode: string | null }; delete?: { allowed: boolean; reasonCode: string | null } };
}
export const STORAGE_CATEGORIES = ["dream", "nature", "cyber", "minimal", "dark", "warm", "custom", "uncategorized"] as const;
export interface ThemePatch { name?: string; storageCategory?: string; tags?: string[]; parameters?: Partial<ThemeParameters> }
export interface ThemeEditRequest { operationId: string; theme: ThemeRef; expectedRevision: string; patch: ThemePatch }
export type ThemeEditCommand =
  | { method: "themes.update"; params: ThemeEditRequest }
  | { method: "themes.copy"; params: ThemeEditRequest & { name: string } };
export interface ManagerSnapshot {
  backendSessionId: string;
  sequence: number;
  observedAt: string;
  desired: { theme: ThemeRef | null; revision: string | null; paused: boolean | null };
  engine: { health: "healthy" | "stopped" | "stale" | "degraded" | "mismatch" | "unknown"; runtimeSessionId: string | null };
  renderer: {
    status: "applied" | "removed" | "unknown" | "unavailable";
    theme: ThemeRef | null; revision: string | null; runtimeSessionId: string | null; verifiedAt: string | null;
  };
  operationIds: string[];
  runtime?: { revision: string | null; activeRevision: string | null; engineRevision?: string | null; runningEngineRevision?: string | null; upgradeRequired?: boolean };
  availability: { apply: { allowed: boolean; reasonCode: string | null }; pause?: { allowed: boolean; reasonCode: string | null }; resume?: { allowed: boolean; reasonCode: string | null };
    reset?: { allowed: boolean; reasonCode: string | null }; restore?: { allowed: boolean; reasonCode: string | null }; repair?: { allowed: boolean; reasonCode: string | null }; upgrade?: { allowed: boolean; reasonCode: string | null } };
  diagnostics: Diagnostic[];
}
export interface HelloResult {
  backendSessionId: string;
  platform: "windows" | "macos";
  versions: { bridge: typeof PROTOCOL; node: string; application: string | null };
  capabilities: { methods: ManagerMethod[] };
}
export interface MediaResource { resourceId: string; leaseId: string; url: string; mimeType: "image/png"; expiresAt: string }
export type LanguagePreference = "system" | "zh-CN" | "en-US";
export type DesktopTarget = "themes" | "images" | "state" | "website" | "gallery" | "studio";
export interface DesktopInfo { language: LanguagePreference; resolvedLanguage: "zh-CN" | "en-US"; hostVersion: string;
  login: "unsupported" | "enabled" | "disabled" | "requiresApproval" | "unavailable"; }
export interface DesktopIntent { id: string; page: "console" | "import" | "settings"; section: "none" | "updates" | "maintenance"; link: string | null; }
export const MAINTENANCE_ACTIONS = ["engine.install", "engine.uninstall"] as const;
export type MaintenanceAction = typeof MAINTENANCE_ACTIONS[number];
export interface MaintenanceInfo { bundledVersion: string; installedVersion: string | null; actions: MaintenanceAction[]; }
export interface MaintenanceProposal { handle: string; expiresAt: string; action: MaintenanceAction; impact: string; }
export interface MaintenanceOperation { id: string; action: MaintenanceAction; state: "queued" | "running" | "succeeded" | "failed" | "indeterminate";
  stage: string; startedAt: string; updatedAt: string; error: ManagerError | null; }
export interface SourceGrant { handle: string; name: string; extension: string; byteLength: number; expiresAt: string }
export interface CommunityMetadata {
  id: string; themeId: string; name: string; version: string; authorDisplayName: string; license: string;
  packageSha256: string; packageBytes: number; applyCompatible: true;
}
export interface CommunityProposal { handle: string; expiresAt: string; source: "https://api.dreamskin.cc"; metadata: CommunityMetadata }
export interface CommunityDownload { source: SourceGrant; details: PackageDetails }
export interface UpdateCheck {
  handle: string; expiresAt: string; channel: "windows-release" | "macos-release" | "macos-gui";
  currentVersion: string; latestVersion: string; updateAvailable: boolean; releaseUrl: string;
  installMode: "manual" | "windows-installer" | "macos-signed";
  reason: string; trust: string;
}
export interface UpdateOperation {
  id: string; channel: UpdateCheck["channel"]; latestVersion: string;
  state: "queued" | "running" | "handoff" | "installed" | "failed" | "indeterminate";
  stage: string; startedAt: string; updatedAt: string; managerMustQuit: boolean; error: ManagerError | null;
}
export interface SourceSelection { cancelled: boolean; sources: SourceGrant[]; failures: { name: string; error: ManagerError }[] }
export interface ThemeCreateRequest { operationId: string; handle: string; name: string; patch: ThemePatch }
export type ThemeCreateCommand = { method: "themes.create"; params: ThemeCreateRequest };
export type ThemePackageCommand = { method: "themes.importPackage"; params: { operationId: string; handle: string } };
export const RECOVERY_ACTIONS = ["reconcile", "finishImport", "discardStage", "cleanupDeleted"] as const;
export type RecoveryAction = typeof RECOVERY_ACTIONS[number];
export type ThemeDeleteCommand = { method: "themes.delete"; params: { operationId: string; theme: ThemeRef; expectedRevision: string } };
export type LibraryRecoveryCommand = { method: "library.recover"; params: { operationId: string; transactionId: string; expectedRevision: string; action: RecoveryAction } };
export type ConfirmedLibraryCommand = ThemeDeleteCommand | LibraryRecoveryCommand;
export interface RecoveryEntry { transactionId: string; theme: ThemeRef | null; method: string; phase: string; revision: string;
  actions: RecoveryAction[]; message: string }
export interface RecoveryPage { entries: RecoveryEntry[]; warnings: Diagnostic[] }
export interface PackageDetails {
  format: "cdskin" | "official" | "simple"; name: string; storageCategory: string; tags: string[];
  hasCss: boolean; license: string | null; signatureIgnored: boolean; fingerprint: string;
  storedParameters: ThemeParameters; previewParameters: ThemeParameters;
}
export const CONFIRMATION_KINDS = ["applyRestart", "resumeRestart", "resetRestart", "repairRestart", "restoreAppearance", "upgradeRuntime",
  "deletePreset", "deleteSaved", "recoverReconcile", "recoverImport", "recoverDiscard", "recoverPreset", "recoverSaved"] as const;
export interface ConfirmationCopy { kind: typeof CONFIRMATION_KINDS[number]; subject?: string }
// Optional display metadata cannot grant consent or change the operation.
export function confirmationCopy(value: unknown): ConfirmationCopy | undefined {
  if (!record(value) || Object.keys(value).some(key => key !== "kind" && key !== "subject") ||
      !(CONFIRMATION_KINDS as readonly unknown[]).includes(value.kind)) return undefined;
  const subjectAllowed = String(value.kind).startsWith("delete") || String(value.kind).startsWith("recover");
  if (value.subject !== undefined && (!subjectAllowed || typeof value.subject !== "string" || value.subject.length < 1 || value.subject.length > 256)) return undefined;
  if (String(value.kind).startsWith("delete") && value.subject === undefined) return undefined;
  return { kind: value.kind as ConfirmationCopy["kind"], ...(value.subject !== undefined ? { subject: value.subject as string } : {}) };
}
export interface OperationSnapshot {
  id: string; method: "skin.apply" | ThemeEditMethod | "themes.create" | "themes.importPackage" | "themes.delete" | "library.recover" | RuntimeMethod;
  state: "queued" | "running" | "awaitingConfirmation" | "succeeded" | "failed" | "cancelled" | "indeterminate";
  stage: string; theme: ThemeRef; expectedRevision: string; committedRevision: string | null;
  verifiedRendererRevision: string | null; runtimeSessionId: string | null;
  startedAt: string; updatedAt: string;
  confirmation: { id: string; reason: string; impact: string; expiresAt: string; copy?: ConfirmationCopy } | null;
  effects: { themeCommitted: boolean | null; rendererApplied: boolean | null; codexRestarted: boolean | null; libraryChanged?: boolean | null;
    pausedCommitted?: boolean | null; rendererRemoved?: boolean | null; appearanceRestored?: boolean | null; runtimeDetached?: boolean | null; backupArchived?: boolean | null; runtimeUpgraded?: boolean | null; rollbackVerified?: boolean | null };
  recoveryTransaction?: string;
  rendererUnavailable?: boolean;
  requestedActiveRevision?: string | null;
  resultTheme?: ThemeRef | null; resultRevision?: string | null;
  disposition?: "created" | "duplicate" | null;
  deleted?: boolean | null; cleanupPending?: boolean | null; recoveryCompleted?: boolean;
  error: ManagerError | null; snapshot: ManagerSnapshot | null;
}
export interface ThemePage { revision: string; themes: ThemeSummary[]; nextCursor?: string; warnings: Diagnostic[] }
export interface OperationPage { revision: string; operations: OperationSnapshot[]; nextCursor?: string; warnings: Diagnostic[] }
export type ManagerEvent = { protocol: typeof PROTOCOL; kind: "event"; backendSessionId: string; sequence: number } & (
  { event: "status.changed"; snapshot: ManagerSnapshot } | { event: "operation.changed"; operation: OperationSnapshot } | { event: "status.invalidated" } | { event: "session.closing" });
export interface MethodMap {
  "startup.get": { params: Record<string, never>; result: StartupAnimationSettings };
  "startup.update": { params: StartupAnimationUpdate; result: StartupAnimationSettings };
  "desktop.get": { params: Record<string, never>; result: DesktopInfo };
  "desktop.intents": { params: Record<string, never>; result: { intents: DesktopIntent[] } };
  "desktop.open": { params: { target: DesktopTarget }; result: { opened: boolean } };
  "desktop.language": { params: { language: LanguagePreference }; result: DesktopInfo };
  "desktop.login": { params: { enabled: boolean }; result: DesktopInfo };
  "desktop.notifyUpdate": { params: { handle: string }; result: { delivered: boolean } };
  "maintenance.inspect": { params: Record<string, never>; result: MaintenanceInfo };
  "maintenance.prepare": { params: { action: MaintenanceAction }; result: MaintenanceProposal };
  "maintenance.execute": { params: { operationId: string; handle: string; accepted: true }; result: MaintenanceOperation };
  "maintenance.get": { params: { operationId: string }; result: MaintenanceOperation };
  "updates.check": { params: { background: boolean }; result: UpdateCheck };
  "updates.install": { params: { operationId: string; handle: string; accepted: true }; result: UpdateOperation };
  "updates.get": { params: { operationId: string }; result: UpdateOperation };
  "updates.openRelease": { params: { handle: string }; result: { opened: boolean } };
  "updates.quit": { params: { operationId: string }; result: { quitting: true } };
  "community.inspect": { params: { link: string }; result: CommunityProposal };
  "community.download": { params: { handle: string; accepted: true }; result: CommunityDownload };
  "community.import": { params: { operationId: string; handle: string }; result: OperationSnapshot };
  "community.apply": { params: { operationId: string; importOperationId: string }; result: OperationSnapshot };
  "events.subscribe": { params: Record<string, never>; result: { backendSessionId: string; subscribed: boolean } };
  "events.unsubscribe": { params: Record<string, never>; result: { backendSessionId: string; subscribed: boolean } };
  "session.close": { params: Record<string, never>; result: { backendSessionId: string; closing: true } };
  "operations.list": { params: { cursor?: string; limit?: number }; result: OperationPage };
  "runtime.upgrade": { params: RuntimeCommand["params"]; result: OperationSnapshot };
  "skin.reset": { params: RuntimeCommand["params"]; result: OperationSnapshot };
  "skin.restore": { params: RuntimeCommand["params"]; result: OperationSnapshot };
  "runtime.repair": { params: RuntimeCommand["params"]; result: OperationSnapshot };
  "skin.pause": { params: RuntimeCommand["params"]; result: OperationSnapshot };
  "skin.resume": { params: RuntimeCommand["params"]; result: OperationSnapshot };
  "system.hello": { params: Record<string, never>; result: HelloResult };
  "status.get": { params: Record<string, never>; result: ManagerSnapshot };
  "themes.list": { params: { cursor?: string; limit?: number }; result: ThemePage };
  "themes.get": { params: { theme: ThemeRef }; result: ThemeDetails };
  "themes.active": { params: Record<string, never>; result: ThemeDetails | null };
  "media.activePreview": { params: { revision: string }; result: MediaResource };
  "media.release": { params: { leaseId: string }; result: { released: boolean } };
  "media.resolve": { params: { theme: ThemeRef; revision: string; variant: "thumbnail" | "preview" }; result: MediaResource };
  "skin.apply": { params: { operationId: string; theme: ThemeRef; expectedRevision: string; refresh?: ApplyRefresh }; result: OperationSnapshot };
  "themes.update": { params: ThemeEditRequest; result: OperationSnapshot };
  "themes.copy": { params: ThemeEditRequest & { name: string }; result: OperationSnapshot };
  "files.select": { params: { multiple: boolean }; result: SourceSelection };
  "sources.preview": { params: { handle: string }; result: MediaResource };
  "sources.release": { params: { handles: string[] }; result: { released: number } };
  "themes.create": { params: ThemeCreateRequest; result: OperationSnapshot };
  "files.saveOriginal": { params: { theme: ThemeRef; revision: string }; result: { cancelled: boolean; saved: boolean } };
  "files.playOriginal": { params: { theme: ThemeRef; revision: string }; result: { opened: boolean } };
  "files.selectPackages": { params: { multiple: boolean }; result: SourceSelection };
  "packages.inspect": { params: { handle: string }; result: PackageDetails };
  "packages.preview": { params: { handle: string }; result: MediaResource };
  "packages.release": { params: { handles: string[] }; result: { released: number } };
  "themes.importPackage": { params: ThemePackageCommand["params"]; result: OperationSnapshot };
  "files.exportPackage": { params: { theme: ThemeRef; revision: string }; result: { cancelled: boolean; saved: boolean } };
  "themes.delete": { params: ThemeDeleteCommand["params"]; result: OperationSnapshot };
  "library.recovery.list": { params: Record<string, never>; result: RecoveryPage };
  "library.recover": { params: LibraryRecoveryCommand["params"]; result: OperationSnapshot };
  "operations.get": { params: { operationId: string }; result: OperationSnapshot };
  "operations.confirm": { params: { operationId: string; confirmationId: string; accepted: boolean }; result: OperationSnapshot };
}
export type ManagerRequest = {
  [M in ManagerMethod]: { protocol: typeof PROTOCOL; kind: "request"; requestId: string; method: M; params: MethodMap[M]["params"] }
}[ManagerMethod];
export type ManagerResponse =
  | { protocol: typeof PROTOCOL; kind: "response"; requestId: string | null; ok: true; result: MethodMap[ManagerMethod]["result"] }
  | { protocol: typeof PROTOCOL; kind: "response"; requestId: string | null; ok: false; error: ManagerError };

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && Array.from(value).length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new ContractError("INVALID_REQUEST", "Unexpected message field.");
  }
}
export function parseThemePatch(value: unknown): ThemePatch {
  if (!record(value)) throw new ContractError("INVALID_REQUEST", "Invalid theme patch.");
  fields(value, ["name", "storageCategory", "tags", "parameters"]);
  const text = (value: unknown, maximum: number) => boundedText(value, maximum) && value.trim().length > 0 && value.length <= maximum;
  if (("name" in value && !text(value.name, 80)) ||
      ("storageCategory" in value && !(STORAGE_CATEGORIES as readonly unknown[]).includes(value.storageCategory)) ||
      ("tags" in value && (!Array.isArray(value.tags) || value.tags.length > 8 || value.tags.some(tag => !text(tag, 20))))) {
    throw new ContractError("INVALID_REQUEST", "Invalid theme metadata patch.");
  }
  if ("parameters" in value) {
    if (!record(value.parameters)) throw new ContractError("INVALID_REQUEST", "Invalid parameter patch.");
    const parameters = value.parameters;
    const ranges: Record<string, readonly [number, number]> = { focusX: [0, 1], focusY: [0, 1], positionX: [-1, 1], positionY: [-1, 1],
      zoom: [1, 2], playbackRate: [0.25, 2], bubbleOpacity: [0, 1], surfaceOpacity: [0, 1], shellOpacity: [0, 1] };
    const choices: Record<string, readonly string[]> = { appearance: ["auto", "light", "dark"], positionMode: ["locked", "free"],
      safeArea: ["auto", "left", "right", "center", "none"], taskMode: ["auto", "ambient", "banner", "full", "off"] };
    fields(value.parameters, [...Object.keys(ranges), ...Object.keys(choices), "framingEnabled", "accent"]);
    for (const [key, parameter] of Object.entries(value.parameters)) {
      if (parameter === null) continue;
      const range = ranges[key], options = choices[key];
      if (range ? typeof parameter !== "number" || !Number.isFinite(parameter) || parameter < range[0] || parameter > range[1]
        : options ? typeof parameter !== "string" || !options.includes(parameter)
        : key === "framingEnabled" ? typeof parameter !== "boolean"
        : typeof parameter !== "string" || !/^#[0-9a-f]{6}$/i.test(parameter)) {
        throw new ContractError("INVALID_REQUEST", "Invalid theme parameter patch.");
      }
    }
    if (parameters.framingEnabled === false && ["positionX", "positionY", "zoom", "positionMode"].some(key =>
      Object.hasOwn(parameters, key) && parameters[key] !== null)) {
      throw new ContractError("INVALID_REQUEST", "Disabled framing cannot include explicit framing coordinates.");
    }
  }
  return value as ThemePatch;
}
export function parseApplyRefresh(value: unknown): ApplyRefresh {
  if (!record(value)) throw new ContractError("INVALID_REQUEST", "Invalid hot refresh constraint.");
  fields(value, ["activeRevision", "runtimeSessionId", "opacityOnly"]);
  if (typeof value.activeRevision !== "string" || !/^[a-f0-9]{64}$/.test(value.activeRevision) ||
      typeof value.runtimeSessionId !== "string" || !/^[a-f0-9]{64}$/.test(value.runtimeSessionId) ||
      value.opacityOnly !== undefined && value.opacityOnly !== true) throw new ContractError("INVALID_REQUEST", "Invalid hot refresh constraint.");
  return { activeRevision: value.activeRevision, runtimeSessionId: value.runtimeSessionId, ...(value.opacityOnly === true ? { opacityOnly: true } : {}) };
}

export function parseThemeRef(value: unknown): ThemeRef {
  if (!record(value)) throw new ContractError("INVALID_REQUEST", "Invalid theme reference.");
  fields(value, ["source", "id"]);
  if ((value.source !== "preset" && value.source !== "saved") || typeof value.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.id)) {
    throw new ContractError("INVALID_REQUEST", "Invalid theme reference.");
  }
  return { source: value.source, id: value.id };
}
export function responseId(value: unknown): string | null {
  return record(value) && typeof value.requestId === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value.requestId)
    ? value.requestId : null;
}
export function validOperationId(value: unknown): value is string {
  const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
  return typeof value === "string" && new RegExp(`^${uuid}:${uuid}$`).test(value);
}
export function parseRequest(value: unknown): ManagerRequest {
  if (!record(value)) throw new ContractError("INVALID_REQUEST", "Expected a message object.");
  if (value.protocol !== PROTOCOL) throw new ContractError("PROTOCOL_UNSUPPORTED", "Unsupported bridge protocol.");
  fields(value, ["protocol", "kind", "requestId", "method", "params"]);
  if (value.kind !== "request" || responseId(value) === null || !boundedText(value.method, 80) || !record(value.params)) {
    throw new ContractError("INVALID_REQUEST", "Invalid request envelope.");
  }
  if (!([...READ_METHODS, ...SESSION_METHODS, MEDIA_METHOD, ...OPERATION_METHODS, ...LIBRARY_METHODS, ...SOURCE_METHODS, ...PACKAGE_METHODS, ...COMMUNITY_METHODS, ...UPDATE_METHODS, ...DESKTOP_METHODS, ...MAINTENANCE_METHODS, ...RECOVERY_METHODS, ...RUNTIME_METHODS, ...STARTUP_METHODS] as readonly string[]).includes(value.method)) {
    throw new ContractError("METHOD_UNSUPPORTED", "This method is not implemented by this backend.");
  }
  const params = value.params;
  switch (value.method) {
    case "startup.get": fields(params, []); break;
    case "startup.update":
      fields(params, ["enabled", "theme", "expectedRevision"]);
      if ((!Object.hasOwn(params, "enabled") && !Object.hasOwn(params, "theme")) ||
          (Object.hasOwn(params, "enabled") && typeof params.enabled !== "boolean")) throw new ContractError("INVALID_REQUEST", "Invalid startup animation settings.");
      if (Object.hasOwn(params, "theme") && params.theme !== null) {
        parseThemeRef(params.theme);
        if (typeof params.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(params.expectedRevision)) throw new ContractError("INVALID_REQUEST", "A saved video theme revision is required.");
      } else if (Object.hasOwn(params, "expectedRevision")) throw new ContractError("INVALID_REQUEST", "A video theme is required for its revision.");
      break;
    case "media.release":
      fields(params, ["leaseId"]);
      if (typeof params.leaseId !== "string" || !/^[a-f0-9]{48}$/.test(params.leaseId)) throw new ContractError("INVALID_REQUEST", "Invalid preview lease.");
      break;
    case "updates.check":
      fields(params, ["background"]);
      if (typeof params.background !== "boolean") throw new ContractError("INVALID_REQUEST", "Invalid update check.");
      break;
    case "updates.install":
      fields(params, ["operationId", "handle", "accepted"]);
      if (!validOperationId(params.operationId) || typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle) || params.accepted !== true) throw new ContractError("INVALID_REQUEST", "Explicit update approval is required.");
      break;
    case "updates.openRelease":
      fields(params, ["handle"]);
      if (typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle)) throw new ContractError("INVALID_REQUEST", "Invalid update proposal.");
      break;
    case "updates.quit": case "updates.get":
      fields(params, ["operationId"]);
      if (!validOperationId(params.operationId)) throw new ContractError("INVALID_REQUEST", "Invalid update identity.");
      break;
    case "community.inspect":
      fields(params, ["link"]);
      if (typeof params.link !== "string" || /^dreamskin:\/\/apply\?version=ver_[a-z0-9]{8,64}$/.exec(params.link)?.[0] !== params.link) throw new ContractError("INVALID_REQUEST", "Invalid community theme link.");
      break;
    case "community.download":
      fields(params, ["handle", "accepted"]);
      if (typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle) || params.accepted !== true) throw new ContractError("INVALID_REQUEST", "Explicit community download approval is required.");
      break;
    case "community.apply":
      fields(params, ["operationId", "importOperationId"]);
      if (!validOperationId(params.operationId) || !validOperationId(params.importOperationId) || params.operationId === params.importOperationId) throw new ContractError("INVALID_REQUEST", "Invalid community application identity.");
      break;
    case "skin.pause": case "skin.resume": case "skin.reset": case "skin.restore": case "runtime.repair": case "runtime.upgrade":
      fields(params, ["operationId", "expectedRuntimeRevision"]);
      if (!validOperationId(params.operationId) || typeof params.expectedRuntimeRevision !== "string" || !/^[a-f0-9]{64}$/.test(params.expectedRuntimeRevision)) throw new ContractError("INVALID_REQUEST", "Invalid runtime command.");
      break;
    case "files.select": case "files.selectPackages":
      fields(params, ["multiple"]);
      if (typeof params.multiple !== "boolean") throw new ContractError("INVALID_REQUEST", "Invalid file selection request.");
      break;
    case "sources.preview": case "packages.inspect": case "packages.preview":
      fields(params, ["handle"]);
      if (typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle)) throw new ContractError("INVALID_REQUEST", "Invalid source handle.");
      break;
    case "sources.release": case "packages.release":
      fields(params, ["handles"]);
      if (!Array.isArray(params.handles) || params.handles.length > 32 || params.handles.some(handle => typeof handle !== "string" || !/^[a-f0-9]{48}$/.test(handle))) throw new ContractError("INVALID_REQUEST", "Invalid source handles.");
      break;
    case "themes.create": {
      fields(params, ["operationId", "handle", "name", "patch"]);
      const patch = parseThemePatch(params.patch);
      if (!validOperationId(params.operationId) || typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle) ||
          !boundedText(params.name, 80) || params.name.length > 80 || !params.name.trim() || "name" in patch) throw new ContractError("INVALID_REQUEST", "Invalid theme creation request.");
      break;
    }
    case "themes.importPackage": case "community.import":
      fields(params, ["operationId", "handle"]);
      if (!validOperationId(params.operationId) || typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle)) throw new ContractError("INVALID_REQUEST", "Invalid package import request.");
      break;
    case "files.saveOriginal": case "files.playOriginal": case "files.exportPackage":
      fields(params, ["theme", "revision"]); parseThemeRef(params.theme);
      if (typeof params.revision !== "string" || !/^[a-f0-9]{64}$/.test(params.revision)) throw new ContractError("INVALID_REQUEST", "Invalid original media request.");
      break;
    case "desktop.get": case "desktop.intents": case "maintenance.inspect": fields(params, []); break;
    case "desktop.open":
      fields(params, ["target"]);
      if (!["themes", "images", "state", "website", "gallery", "studio"].includes(String(params.target))) throw new ContractError("INVALID_REQUEST", "Invalid fixed desktop target.");
      break;
    case "desktop.language":
      fields(params, ["language"]);
      if (!["system", "zh-CN", "en-US"].includes(String(params.language))) throw new ContractError("INVALID_REQUEST", "Invalid language preference.");
      break;
    case "desktop.login":
      fields(params, ["enabled"]);
      if (typeof params.enabled !== "boolean") throw new ContractError("INVALID_REQUEST", "Invalid login setting.");
      break;
    case "desktop.notifyUpdate":
      fields(params, ["handle"]);
      if (typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle)) throw new ContractError("INVALID_REQUEST", "Invalid update notification.");
      break;
    case "maintenance.prepare":
      fields(params, ["action"]);
      if (!(MAINTENANCE_ACTIONS as readonly unknown[]).includes(params.action)) throw new ContractError("INVALID_REQUEST", "Invalid maintenance action.");
      break;
    case "maintenance.execute":
      fields(params, ["operationId", "handle", "accepted"]);
      if (!validOperationId(params.operationId) || typeof params.handle !== "string" || !/^[a-f0-9]{48}$/.test(params.handle) || params.accepted !== true) throw new ContractError("INVALID_REQUEST", "Invalid maintenance approval.");
      break;
    case "maintenance.get":
      fields(params, ["operationId"]);
      if (!validOperationId(params.operationId)) throw new ContractError("INVALID_REQUEST", "Invalid maintenance identity.");
      break;
    case "system.hello": case "status.get": case "library.recovery.list": case "events.subscribe": case "events.unsubscribe": case "session.close": fields(params, []); break;
    case "library.recover":
      fields(params, ["operationId", "transactionId", "expectedRevision", "action"]);
      if (!validOperationId(params.operationId) || !validOperationId(params.transactionId) || params.operationId === params.transactionId ||
          typeof params.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(params.expectedRevision) || !(RECOVERY_ACTIONS as readonly unknown[]).includes(params.action)) throw new ContractError("INVALID_REQUEST", "Invalid recovery request.");
      break;
    case "themes.list": case "operations.list":
      fields(params, ["cursor", "limit"]);
      if (("limit" in params && (!Number.isInteger(params.limit) || (params.limit as number) < 1 || (params.limit as number) > 200)) ||
          ("cursor" in params && (typeof params.cursor !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(params.cursor)))) {
        throw new ContractError("INVALID_REQUEST", "Invalid pagination parameters.");
      }
      break;
    case "themes.active": fields(params, []); break;
    case "media.activePreview":
      fields(params, ["revision"]);
      if (typeof params.revision !== "string" || !/^[a-f0-9]{64}$/.test(params.revision)) throw new ContractError("INVALID_REQUEST", "Invalid active preview revision.");
      break;
    case "themes.get": fields(params, ["theme"]); parseThemeRef(params.theme); break;
    case "media.resolve":
      fields(params, ["theme", "revision", "variant"]); parseThemeRef(params.theme);
      if (typeof params.revision !== "string" || !/^[a-f0-9]{64}$/.test(params.revision) ||
          (params.variant !== "thumbnail" && params.variant !== "preview")) {
        throw new ContractError("INVALID_REQUEST", "Invalid media parameters.");
      }
      break;
    case "skin.apply": case "themes.delete":
      fields(params, ["operationId", "theme", "expectedRevision", ...(value.method === "skin.apply" ? ["refresh"] : [])]); parseThemeRef(params.theme);
      if (!validOperationId(params.operationId) || typeof params.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(params.expectedRevision)) {
        throw new ContractError("INVALID_REQUEST", "Invalid apply parameters.");
      }
      if (params.refresh !== undefined) parseApplyRefresh(params.refresh);
      break;
    case "themes.update": case "themes.copy": {
      fields(params, ["operationId", "theme", "expectedRevision", "patch", ...(value.method === "themes.copy" ? ["name"] : [])]);
      parseThemeRef(params.theme);
      const patch = parseThemePatch(params.patch);
      if (!validOperationId(params.operationId) || typeof params.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(params.expectedRevision) ||
          (value.method === "themes.copy" && (!boundedText(params.name, 80) || params.name.length > 80 || !params.name.trim() || "name" in patch)) ||
          (value.method === "themes.update" && !Object.keys(patch).some(key => key !== "parameters" || Object.keys(patch.parameters ?? {}).length > 0))) {
        throw new ContractError("INVALID_REQUEST", "Invalid theme edit request.");
      }
      break;
    }
    case "operations.get":
      fields(params, ["operationId"]);
      if (!validOperationId(params.operationId)) throw new ContractError("INVALID_REQUEST", "Invalid operation identity.");
      break;
    case "operations.confirm":
      fields(params, ["operationId", "confirmationId", "accepted"]);
      if (!validOperationId(params.operationId) || typeof params.confirmationId !== "string" ||
          !/^[a-f0-9-]{36}$/.test(params.confirmationId) || typeof params.accepted !== "boolean") {
        throw new ContractError("INVALID_REQUEST", "Invalid confirmation parameters.");
      }
      break;
  }
  return value as unknown as ManagerRequest;
}
export function failure(requestId: string | null, error: unknown): ManagerResponse {
  const known = error instanceof ContractError ? error : new ContractError("IO_ERROR", "The local backend could not complete the request.", true);
  return { protocol: PROTOCOL, kind: "response", requestId, ok: false,
    error: { code: known.code, message: known.message, retryable: known.retryable } };
}
