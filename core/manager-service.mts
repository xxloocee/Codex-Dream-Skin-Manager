import { randomUUID } from "node:crypto";
import path from "node:path";
import { ContractError, LIBRARY_METHODS, OPERATION_METHODS, PACKAGE_METHODS, parseRequest, PROTOCOL, READ_METHODS, record, RECOVERY_METHODS, RUNTIME_METHODS, SOURCE_METHODS } from "../contracts/manager.mjs";
import type { CommunityLocalTheme, HelloResult, ManagerRequest, ManagerSnapshot, MethodMap, ThemeDetails, ThemePage, ThemeRef, ThemeSummary } from "../contracts/manager.mjs";
import { sha256 } from "./local-files.mjs";
import type { LocalTheme, PlatformPort } from "./ports/platform.mjs";
import { themeDetails, themeListStamp } from "./theme-model.mjs";
import { defaultRecoveryThemeIds } from "./deletion-policy.mjs";
import { activeTheme } from "./active-theme.mjs";
import type { MediaResources } from "./media-resources.mjs";
import type { ApplyPort } from "./ports/apply.mjs";
import { Operations } from "./operations.mjs";
import { OperationStore } from "./operation-store.mjs";
import type { LibraryPort } from "./ports/library.mjs";
import { editTheme, validateEdit } from "./theme-edit.mjs";
import type { SourceSnapshots } from "./source-snapshots.mjs";
import type { NativeFiles } from "./native-files.mjs";
import type { PackageSources } from "./package-sources.mjs";
import type { PackageValidation } from "./theme-package.mjs";
import { describePackage } from "./theme-package.mjs";
import type { RuntimePort } from "./ports/runtime.mjs";
import { SessionEvents } from "./session-events.mjs";
import { SESSION_METHODS } from "../contracts/manager.mjs";
import type { ManagerEvent, OperationSnapshot } from "../contracts/manager.mjs";
import { COMMUNITY_METHODS } from "../contracts/manager.mjs";
import { Community } from "./community.mjs";
import type { CommunityHTTP } from "./community.mjs";
import { UPDATE_METHODS } from "../contracts/manager.mjs";
import { Updates } from "./updates.mjs";
import type { UpdatePort } from "./ports/updates.mjs";
import { DESKTOP_METHODS, MAINTENANCE_METHODS } from "../contracts/manager.mjs";
import { Maintenance } from "./maintenance.mjs";
import type { MaintenancePort } from "./maintenance.mjs";
import { STARTUP_METHODS } from "../contracts/manager.mjs";
import { startupAnimationSettings, saveStartupAnimationSettings } from "./startup-animation.mjs";
import { communityCompatibility, communityOrigin } from "./community-origin.mjs";

function summary(theme: ThemeDetails): ThemeSummary {
  const { ref, name, storageCategory, displayCategories, tags, mediaKind, catalogOrder, addedAt, modifiedAt, revision } = theme;
  return { ref, name, storageCategory, displayCategories, tags, mediaKind, catalogOrder, addedAt, modifiedAt, revision };
}
export class ManagerService {
  readonly sessionId = randomUUID();
  private sequence = 0;
  private readonly operations: Operations | undefined;
  private readonly community: Community | undefined;
  private readonly updates: Updates | undefined;
  private readonly maintenance: Maintenance | undefined;
  private readonly events = new SessionEvents(this.sessionId, () => this.snapshot(), () => !!this.operations?.activeIds.length);
  private closing = false;
  private closeJob: Promise<void> | undefined;
  // Preview-only metadata from the last validated list. Content dependencies
  // are still rechecked by MediaResources; writes always use a fresh inventory.
  private previewThemes = new Map<string, { local: LocalTheme; revision: string }>();
  private listSummaries = new Map<string, { stamp: string; summary: ThemeSummary }>();
  private rendererResult: { operation: OperationSnapshot; activeRevision: string | null } | null = null;
  get isClosing(): boolean { return this.closing; }
  stopAccepting(): void { this.closing = true; void this.community?.close(); }
  attachEvents(sink: (event: ManagerEvent) => Promise<void>): void { this.events.attach(sink); }
  constructor(private readonly platform: PlatformPort, private readonly resources?: MediaResources,
    private readonly applyPort?: ApplyPort, private readonly stateRoot?: string, private readonly library?: LibraryPort,
    private readonly sources?: SourceSnapshots, private readonly nativeFiles?: NativeFiles,
    private readonly packages?: PackageSources, private readonly packageValidation?: PackageValidation, private readonly runtimePort?: RuntimePort,
    communityHTTP?: CommunityHTTP, private readonly communityApply?: ApplyPort, updatePort?: UpdatePort, maintenancePort?: MaintenancePort) {
    if (applyPort && stateRoot) this.operations = new Operations(this.sessionId, new OperationStore(stateRoot), applyPort, () => this.snapshot(), async (theme, revision) => {
      if ((await themeDetails(await this.find(theme))).revision !== revision) {
        throw new ContractError("THEME_CHANGED", "The selected theme changed; refresh before applying.");
      }
    }, library, async command => {
      const local = await this.find(command.params.theme);
      validateEdit(command, local.ref); editTheme(local.config, command.params.patch, this.platform.name);
      if ((await themeDetails(local)).revision !== command.params.expectedRevision) throw new ContractError("THEME_CHANGED", "The theme changed; refresh while retaining your draft.");
    }, runtimePort);
    if (this.operations) this.operations.onChanged = operation => {
      if (operation.method === "skin.apply" || (RUNTIME_METHODS as readonly string[]).includes(operation.method)) {
        const result = operation.state === "succeeded" ? { operation, activeRevision: null as string | null } : null;
        this.rendererResult = result;
        // Library revisions differ from the serialized active copy. Bind the
        // completed proof to that copy without delaying the completion event.
        if (result && operation.effects.rendererApplied === true && this.stateRoot) {
          void activeTheme(this.stateRoot, this.platform.name).then(async local => local ? themeDetails(local) : null).then(details => {
            if (this.rendererResult === result && details?.ref.id === operation.theme.id && details.ref.source === operation.theme.source) result.activeRevision = details.revision;
          }).catch(() => {});
        }
      }
      this.events.operation(operation);
      if (["succeeded", "failed", "cancelled"].includes(operation.state)) {
        void this.sources?.finish(operation.id).catch(() => {});
        void this.packages?.finish(operation.id).catch(() => {});
      }
    };
    if (this.operations && library && packages && communityHTTP && communityApply) this.community = new Community(communityHTTP, packages);
    if (this.operations && stateRoot && updatePort) this.updates = new Updates(this.sessionId, stateRoot, updatePort, () => !!this.operations?.activeIds.length || !!this.maintenance?.busy);
    if (this.operations && stateRoot && maintenancePort) this.maintenance = new Maintenance(this.sessionId, stateRoot, maintenancePort, () => !!this.operations?.activeIds.length || !!this.updates?.busy);
  }

  async execute(request: ManagerRequest): Promise<MethodMap[typeof request.method]["result"]> {
    if (this.closing) throw new ContractError("BACKEND_UNAVAILABLE", "This manager session is closing; accepted operations will finish without replay.");
    if ((this.updates?.busy || this.maintenance?.busy) && ["skin.apply", ...RUNTIME_METHODS, ...LIBRARY_METHODS, "themes.create", "themes.importPackage", "themes.delete", "library.recover", "community.import", "community.apply"].includes(request.method)) throw new ContractError("BUSY", "更新或维护正在准备，暂时不能修改主题或运行时。");
    switch (request.method) {
      case "startup.get":
        if (!this.stateRoot) throw new ContractError("METHOD_UNSUPPORTED", "Startup animation settings are unavailable.");
        return startupAnimationSettings(this.stateRoot);
      case "startup.update": {
        if (!this.stateRoot || !this.operations) throw new ContractError("METHOD_UNSUPPORTED", "Startup animation settings are unavailable.");
        const params = request.params, settings = await startupAnimationSettings(this.stateRoot);
        if (params.enabled !== undefined) settings.enabled = params.enabled;
        if (params.theme === null) { settings.theme = null; settings.themeName = null; }
        else if (params.theme) {
          const theme = await themeDetails(await this.find(params.theme));
          if (theme.revision !== params.expectedRevision) throw new ContractError("THEME_CHANGED", "The selected theme changed; refresh before selecting its startup video.");
          if (theme.mediaKind !== "video") throw new ContractError("MEDIA_UNSUPPORTED", "Only video themes can be used as startup animations.");
          settings.theme = theme.ref; settings.themeName = theme.name;
        }
        return saveStartupAnimationSettings(this.stateRoot, settings);
      }
      case "maintenance.inspect":
        if (!this.maintenance) throw new ContractError("METHOD_UNSUPPORTED", "Maintenance is unavailable.");
        return (await this.maintenance.inspect()).info;
      case "maintenance.prepare":
        if (!this.maintenance) throw new ContractError("METHOD_UNSUPPORTED", "Maintenance is unavailable.");
        return this.maintenance.prepare(request.params.action);
      case "maintenance.execute":
        if (!this.maintenance) throw new ContractError("METHOD_UNSUPPORTED", "Maintenance is unavailable.");
        return this.maintenance.execute(request.params);
      case "maintenance.get":
        if (!this.maintenance) throw new ContractError("METHOD_UNSUPPORTED", "Maintenance is unavailable.");
        return this.maintenance.get(request.params.operationId);
      case "desktop.get": case "desktop.intents": case "desktop.open": case "desktop.language": case "desktop.login": case "desktop.notifyUpdate":
        throw new ContractError("METHOD_UNSUPPORTED", "Desktop actions must be consumed by the native host.");
      case "updates.check":
        if (!this.updates) throw new ContractError("METHOD_UNSUPPORTED", "Updates are unavailable.");
        return this.updates.check();
      case "updates.install":
        if (!this.updates) throw new ContractError("METHOD_UNSUPPORTED", "Updates are unavailable.");
        return this.updates.install(request.params);
      case "updates.get":
        if (!this.updates) throw new ContractError("METHOD_UNSUPPORTED", "Updates are unavailable.");
        return this.updates.get(request.params.operationId);
      case "updates.openRelease": case "updates.quit":
        throw new ContractError("METHOD_UNSUPPORTED", "This action must be consumed by the native host.");
      case "events.subscribe": this.events.subscribe(); return { backendSessionId: this.sessionId, subscribed: true };
      case "events.unsubscribe": this.events.unsubscribe(); return { backendSessionId: this.sessionId, subscribed: false };
      case "session.close": this.closing = true; return { backendSessionId: this.sessionId, closing: true };
      case "operations.list":
        if (!this.operations) throw new ContractError("METHOD_UNSUPPORTED", "Operation history is unavailable.");
        return this.operations.list(request.params);
      case "skin.pause": case "skin.resume": case "skin.reset": case "skin.restore": case "runtime.repair": case "runtime.upgrade":
        if (!this.operations || !this.runtimePort) throw new ContractError("METHOD_UNSUPPORTED", "Runtime controls are unavailable.");
        return this.operations.controlRuntime({ method: request.method, params: request.params });
      case "library.recovery.list":
        if (!this.library || !this.operations) throw new ContractError("METHOD_UNSUPPORTED", "Recovery inspection is unavailable.");
        return this.library.recoveries();
      case "themes.delete": case "library.recover":
        if (!this.operations || !this.library) throw new ContractError("METHOD_UNSUPPORTED", "Confirmed library operations are unavailable.");
        return this.operations.proposeLibrary(request.method === "themes.delete" ? { method: request.method, params: request.params } : { method: request.method, params: request.params });
      case "files.select": case "files.saveOriginal": case "files.playOriginal": case "files.selectPackages": case "files.exportPackage":
        throw new ContractError("METHOD_UNSUPPORTED", "This method must be handled by the native host.");
      case "community.list": {
        if (!this.community) throw new ContractError("METHOD_UNSUPPORTED", "Community themes are unavailable.");
        const page = await this.community.list(request.params);
        const local = await this.communityDownloads(new Set(page.items.map(theme => theme.id)));
        return { ...page, items: page.items.map(theme => ({ ...theme, downloaded: local.find(value => value.version === theme.id) ?? null })) };
      }
      case "community.local":
        if (!this.community) throw new ContractError("METHOD_UNSUPPORTED", "Community themes are unavailable.");
        return (await this.communityDownloads(new Set([request.params.version])))[0] ?? null;
      case "community.preview": {
        if (!this.community || !this.resources) throw new ContractError("METHOD_UNSUPPORTED", "Community previews are unavailable.");
        const { version, variant } = request.params;
        const cached = this.resources.cachedCommunity(version, variant, this.sessionId);
        if (cached) return cached;
        const image = await this.community.image(version, variant);
        if (this.closing) throw new ContractError("BACKEND_UNAVAILABLE", "社区会话已关闭。");
        return this.resources.resolveBytes(image.bytes, image.extension, `community:${version}:${variant}`, variant, this.sessionId);
      }
      case "community.inspect":
        if (!this.community) throw new ContractError("METHOD_UNSUPPORTED", "Community themes are unavailable.");
        return this.community.inspect(request.params.link);
      case "community.download":
        if (!this.community) throw new ContractError("METHOD_UNSUPPORTED", "Community themes are unavailable.");
        return this.community.download(request.params.handle);
      case "community.import":
        if (!this.community || !this.operations || !this.packages) throw new ContractError("METHOD_UNSUPPORTED", "Community importing is unavailable.");
        return this.operations.importPackage(request.params, async () => {
          const source = this.packages!.get(request.params.handle);
          if (!source.fileName.endsWith(".community.zip")) throw new ContractError("INVALID_REQUEST", "A verified community download is required.");
          await this.packages!.decode(source); return { source, revision: this.packages!.revision(source) };
        }, () => this.packages!.pin(request.params.handle, request.params.operationId), () => this.packages!.finish(request.params.operationId));
      case "community.apply": {
        if (!this.community || !this.operations || !this.communityApply) throw new ContractError("METHOD_UNSUPPORTED", "Community application is unavailable.");
        const imported = await this.operations.get(request.params.importOperationId);
        if (imported.method !== "themes.importPackage" || imported.state !== "succeeded" || !imported.resultTheme || !imported.resultRevision) throw new ContractError("OPERATION_UNKNOWN", "先核对已成功的主题包导入记录，再明确应用。");
        return this.operations.apply({ operationId: request.params.operationId, theme: imported.resultTheme, expectedRevision: imported.resultRevision },
          { context: "community:" + imported.id, port: this.communityApply });
      }
      case "packages.release": {
        if (!this.packages) throw new ContractError("METHOD_UNSUPPORTED", "Package authorization is unavailable.");
        return { released: await this.packages.release(request.params.handles) };
      }
      case "packages.inspect": case "packages.preview": {
        if (!this.packages) throw new ContractError("METHOD_UNSUPPORTED", "Package authorization is unavailable.");
        const payload = await this.packages.decode(this.packages.get(request.params.handle));
        if (request.method === "packages.inspect") return describePackage(payload);
        if (!this.resources) throw new ContractError("METHOD_UNSUPPORTED", "Package previews are unavailable.");
        return this.resources.resolveBytes(payload.media, payload.extension, "package:" + request.params.handle, "preview", this.sessionId);
      }
      case "themes.importPackage": {
        if (!this.operations || !this.packages || !this.library) throw new ContractError("METHOD_UNSUPPORTED", "Package importing is unavailable.");
        return this.operations.importPackage(request.params, async () => {
          const source = this.packages!.get(request.params.handle); await this.packages!.decode(source);
          return { source, revision: this.packages!.revision(source) };
        }, () => this.packages!.pin(request.params.handle, request.params.operationId), () => this.packages!.finish(request.params.operationId));
      }
      case "sources.release": {
        if (!this.sources) throw new ContractError("METHOD_UNSUPPORTED", "Native source authorization is unavailable.");
        return { released: await this.sources.release(request.params.handles) };
      }
      case "sources.preview": {
        if (!this.sources || !this.resources) throw new ContractError("METHOD_UNSUPPORTED", "Source previews are unavailable.");
        const source = this.sources.get(request.params.handle);
        return this.resources.resolveBytes(await this.sources.read(source.media), path.extname(source.media.fileName),
          "source:" + request.params.handle, "preview", this.sessionId);
      }
      case "themes.create": {
        if (!this.operations || !this.sources || !this.library) throw new ContractError("METHOD_UNSUPPORTED", "Source importing is unavailable.");
        return this.operations.create(request.params, async () => {
          const source = this.sources!.get(request.params.handle);
          await this.sources!.read(source.media); if (source.original) await this.sources!.read(source.original);
          editTheme({ schemaVersion: 1, category: "custom", tags: [] }, request.params.patch, this.platform.name);
          return { source, revision: this.sources!.revision(source) };
        }, () => this.sources!.pin(request.params.handle, request.params.operationId), () => this.sources!.finish(request.params.operationId));
      }
      case "system.hello": return this.hello();
      case "status.get": return this.snapshot();
      case "themes.list": return this.list(request.params);
      case "themes.get": return this.get(request.params.theme);
      case "themes.active": {
        const active = this.stateRoot ? await activeTheme(this.stateRoot, this.platform.name) : null;
        return active ? themeDetails(active) : null;
      }
      case "media.release":
        return this.resources?.release(request.params.leaseId, this.sessionId) ?? { released: false };
      case "media.activePreview": {
        if (!this.resources || !this.stateRoot) throw new ContractError("METHOD_UNSUPPORTED", "Active previews are unavailable.");
        const active = await activeTheme(this.stateRoot, this.platform.name);
        if (!active) throw new ContractError("THEME_NOT_FOUND", "No active skin is available.");
        return this.resources.resolve(active, { theme: active.ref, revision: request.params.revision, variant: "preview" }, this.sessionId);
      }
      case "media.resolve": {
        if (!this.resources) throw new ContractError("METHOD_UNSUPPORTED", "Native preview resources are unavailable.");
        const ref = request.params.theme;
        const cached = this.previewThemes.get(`${ref.source}:${ref.id}`);
        const local = cached?.revision === request.params.revision ? cached.local : await this.find(ref);
        return this.resources.resolve(local, request.params, this.sessionId);
      }
      case "skin.apply": {
        if (!this.operations) throw new ContractError("METHOD_UNSUPPORTED", "Theme application is unavailable.");
        return this.operations.apply(request.params);
      }
      case "themes.update": case "themes.copy": {
        if (!this.operations || !this.library) throw new ContractError("METHOD_UNSUPPORTED", "Library editing is unavailable.");
        return this.operations.edit(request.method === "themes.copy" ? { method: request.method, params: request.params } : { method: request.method, params: request.params });
      }
      case "operations.get": {
        if (!this.operations) throw new ContractError("METHOD_UNSUPPORTED", "Operation tracking is unavailable.");
        return this.operations.get(request.params.operationId);
      }
      case "operations.confirm": {
        if (!this.operations) throw new ContractError("METHOD_UNSUPPORTED", "Operation tracking is unavailable.");
        return this.operations.confirm(request.params);
      }
    }
  }
  private async hello(): Promise<HelloResult> {
    return { backendSessionId: this.sessionId, platform: this.platform.name,
      versions: { bridge: PROTOCOL, node: process.versions.node, application: await this.platform.applicationVersion() },
      capabilities: { methods: [...READ_METHODS.filter(method => method === "themes.active" ? !!this.stateRoot : method === "media.activePreview" ? !!this.stateRoot && !!this.resources : method === "media.release" ? !!this.resources : true), ...SESSION_METHODS, ...(this.resources ? ["media.resolve" as const] : []), ...(this.operations ? OPERATION_METHODS : []),
        ...(this.operations && this.runtimePort ? RUNTIME_METHODS : []), ...(this.stateRoot && this.operations ? STARTUP_METHODS : []),
        ...(this.operations && this.library ? [...LIBRARY_METHODS, ...RECOVERY_METHODS] : []), ...(this.sources && this.nativeFiles && this.resources && this.operations && this.library ? SOURCE_METHODS : []),
        ...(this.packages && this.packageValidation && this.nativeFiles && this.resources && this.operations && this.library ? PACKAGE_METHODS : []),
        ...(this.community ? COMMUNITY_METHODS : []), ...(this.updates && this.nativeFiles ? UPDATE_METHODS : []),
        ...(this.nativeFiles ? DESKTOP_METHODS : []), ...(this.maintenance ? MAINTENANCE_METHODS : [])] } };
  }
  async executeNative(value: unknown): Promise<unknown> {
    if (this.closing) throw new ContractError("BACKEND_UNAVAILABLE", "This manager session is closing.");
    if (!this.sources || !this.nativeFiles || !record(value) || value.protocol !== PROTOCOL || value.kind !== "native.request" ||
        Object.keys(value).some(key => !["protocol", "kind", "requestId", "method", "params"].includes(key)) || !record(value.params)) {
      throw new ContractError("METHOD_UNSUPPORTED", "Native file handling is unavailable.");
    }
    if (value.method === "updates.authorizeOpen" || value.method === "updates.authorizeQuit") {
      if (!this.updates) throw new ContractError("METHOD_UNSUPPORTED", "Native update handling is unavailable.");
      const quit = value.method === "updates.authorizeQuit";
      const request = parseRequest({ protocol: PROTOCOL, kind: "request", requestId: value.requestId,
        method: quit ? "updates.quit" : "updates.openRelease", params: value.params });
      if (request.method === "updates.quit") {
        const result = await this.updates.quit(request.params.operationId);
        this.stopAccepting(); return result;
      }
      if (request.method === "updates.openRelease") return this.updates.open(request.params.handle);
    }
    if (value.method === "desktop.authorize") {
      if (Object.keys(value.params).length !== 2 || typeof value.params.method !== "string") throw new ContractError("INVALID_REQUEST", "Invalid desktop authorization.");
      const request = parseRequest({ protocol: PROTOCOL, kind: "request", requestId: value.requestId, method: value.params.method, params: value.params.parameters });
      if (!(DESKTOP_METHODS as readonly string[]).includes(request.method)) throw new ContractError("METHOD_UNSUPPORTED", "Unknown desktop action.");
      if (request.method === "desktop.notifyUpdate") {
        if (!this.updates) throw new ContractError("METHOD_UNSUPPORTED", "Updates are unavailable.");
        const proposal = this.updates.notification(request.params.handle); return { authorized: true, ...proposal };
      }
      if (request.method === "desktop.login" && (this.operations?.activeIds.length || this.updates?.busy || this.maintenance?.busy)) throw new ContractError("BUSY", "请等待当前操作结束。");
      return { authorized: true };
    }
    if (value.method === "sources.register" || value.method === "packages.register") {
      const paths = value.params.paths;
      if (Object.keys(value.params).length !== 1 || !Array.isArray(paths) || paths.length > 32 ||
          paths.some(file => typeof file !== "string" || file.length > 32768 || file.includes("\0"))) throw new ContractError("INVALID_REQUEST", "Invalid native selection.");
      if (value.method === "packages.register") {
        if (!this.packages) throw new ContractError("METHOD_UNSUPPORTED", "Package authorization is unavailable.");
        return this.packages.register(paths as string[]);
      }
      return this.sources.register(paths as string[]);
    }
    if (value.method === "files.release") {
      if (Object.keys(value.params).length !== 1) throw new ContractError("INVALID_REQUEST", "Invalid native output release.");
      return { released: await this.nativeFiles.release(value.params.fileName) };
    }
    if (value.method === "media.original") {
      const request = parseRequest({ ...value, kind: "request", method: "files.saveOriginal" });
      if (request.method !== "files.saveOriginal") throw new ContractError("INVALID_REQUEST", "Invalid native media request.");
      return this.nativeFiles.original(await this.find(request.params.theme), request.params.revision);
    }
    if (value.method === "packages.export") {
      if (!this.packageValidation) throw new ContractError("METHOD_UNSUPPORTED", "Package exporting is unavailable.");
      const request = parseRequest({ ...value, kind: "request", method: "files.exportPackage" });
      if (request.method !== "files.exportPackage") throw new ContractError("INVALID_REQUEST", "Invalid package export request.");
      return this.nativeFiles.exportPackage(await this.find(request.params.theme), request.params.revision, this.packageValidation);
    }
    throw new ContractError("METHOD_UNSUPPORTED", "Unknown native file action.");
  }
  private snapshotJob: Promise<ManagerSnapshot> | null = null;
  private snapshot(): Promise<ManagerSnapshot> {
    return this.snapshotJob ??= this.captureSnapshot().finally(() => { this.snapshotJob = null; });
  }
  private async captureSnapshot(): Promise<ManagerSnapshot> {
    const sequence = ++this.sequence, observedAt = new Date().toISOString();
    const diagnostics: ManagerSnapshot["diagnostics"] = [];
    const runtime = this.runtimePort ? await this.runtimePort.inspect().catch(() => { diagnostics.push({ code: "RUNTIME_UNAVAILABLE", message: "Runtime state is temporarily unavailable." }); return null; }) : null;
    // One runtime observation supplies the daily status. Renderer verification
    // belongs to the write itself, never to the background status poll.
    const value = runtime ? { activeId: null, paused: runtime.paused, diagnostics: [],
      health: (runtime.recoveryRequired ? "degraded" : runtime.runtimeSessionId ? "healthy" : runtime.processRunning ? "degraded" : "stopped") as ManagerSnapshot["engine"]["health"] } : await this.platform.status();
    diagnostics.push(...value.diagnostics);
    let theme: ThemeRef | null = runtime?.activeTheme ?? null;
    if (!runtime && value.activeId) {
      try { theme = await this.platform.resolveActive(value.activeId); } catch { /* retain desired identity uncertainty */ }
      if (!theme) diagnostics.push({ code: "ACTIVE_THEME_UNRESOLVED", message: "The active theme cannot be associated with a current library entry." });
    }
    if (runtime?.activeTheme) { theme = runtime.activeTheme; const index = diagnostics.findIndex(item => item.code === "ACTIVE_THEME_UNRESOLVED"); if (index >= 0) diagnostics.splice(index, 1); }
    const paused = runtime?.paused ?? value.paused;
    const observation = this.rendererResult?.operation;
    const sameSession = !!runtime?.runtimeSessionId && observation?.runtimeSessionId === runtime.runtimeSessionId;
    const inspected = sameSession && paused === false && observation?.effects.rendererApplied === true && this.rendererResult?.activeRevision === runtime?.activeRevision ? observation : null;
    const removed = sameSession && paused === true && observation?.effects.rendererRemoved === true;
    const writerBusy = !!this.operations?.activeIds.length || !!this.updates?.busy || !!this.maintenance?.busy;
    const controlReason = !this.operations || !this.runtimePort ? "METHOD_UNSUPPORTED" : writerBusy ? "BUSY" : !runtime || runtime.recoveryRequired ? "RUNTIME_UNAVAILABLE" : null;
    const recoveryReason = !this.operations || !this.runtimePort ? "METHOD_UNSUPPORTED" : writerBusy ? "BUSY" : !runtime ? "RUNTIME_UNAVAILABLE" : null;
    return { backendSessionId: this.sessionId, sequence, observedAt,
      desired: { theme, revision: runtime?.activeRevision ?? null, paused },
      engine: { health: value.health, runtimeSessionId: inspected?.runtimeSessionId ?? runtime?.runtimeSessionId ?? null },
      runtime: { revision: runtime?.revision ?? null, activeRevision: runtime?.activeRevision ?? null, engineRevision: runtime?.engineRevision ?? null, runningEngineRevision: runtime?.runningEngineRevision ?? null, upgradeRequired: runtime?.upgradeRequired ?? false },
      renderer: { status: removed ? "removed" : inspected?.effects.rendererApplied ? "applied" : runtime?.rendererUnavailable ? "unavailable" : "unknown", theme: inspected?.effects.rendererApplied ? theme : null,
        revision: inspected?.effects.rendererApplied ? runtime?.activeRevision ?? null : null, runtimeSessionId: inspected?.runtimeSessionId ?? runtime?.runtimeSessionId ?? null,
        verifiedAt: removed || inspected ? observation!.updatedAt : null },
      operationIds: [...(this.operations?.activeIds ?? []), ...(this.updates?.activeIds ?? []), ...(this.maintenance?.activeIds ?? [])], availability: { apply: { allowed: !!this.operations && !writerBusy,
        reasonCode: !this.operations ? "METHOD_UNSUPPORTED" : writerBusy ? "BUSY" : null },
        pause: { allowed: controlReason === null, reasonCode: controlReason }, resume: { allowed: controlReason === null && !!runtime?.activeTheme, reasonCode: controlReason ?? (runtime?.activeTheme ? null : "THEME_NOT_FOUND") },
        reset: { allowed: controlReason === null && !!runtime?.defaultTheme, reasonCode: controlReason ?? (runtime?.defaultTheme ? null : "THEME_NOT_FOUND") },
        restore: { allowed: recoveryReason === null && runtime?.restoreAvailable === true, reasonCode: recoveryReason ?? (runtime?.restoreAvailable ? null : "RUNTIME_UNAVAILABLE") },
        repair: { allowed: recoveryReason === null && !!runtime?.activeTheme && runtime.paused === false, reasonCode: recoveryReason ?? (!runtime?.activeTheme ? "THEME_NOT_FOUND" : runtime.paused ? "RUNTIME_UNAVAILABLE" : null) },
        upgrade: { allowed: controlReason === null && !!runtime?.activeTheme && !!runtime?.engineRevision && runtime.upgradeRequired && runtime.paused === false, reasonCode: controlReason ?? (!runtime?.activeTheme ? "THEME_NOT_FOUND" : !runtime.engineRevision || !runtime.upgradeRequired || runtime.paused ? "RUNTIME_UNAVAILABLE" : null) } },
      diagnostics: removed || inspected ? diagnostics.filter(item => item.code !== "RENDERER_UNVERIFIED") : diagnostics };
  }
  private async list(params: MethodMap["themes.list"]["params"]): Promise<ThemePage> {
    const inventory = await this.platform.inventory();
    const themes: ThemeSummary[] = [];
    const previewThemes = new Map<string, { local: LocalTheme; revision: string }>();
    const summaries = new Map<string, { stamp: string; summary: ThemeSummary }>();
    const warnings = [...inventory.warnings];
    for (const local of inventory.themes) {
      if (communityOrigin(local.config.managerCommunity)) continue;
      try {
        const key = `${local.ref.source}:${local.ref.id}`, stamp = await themeListStamp(local);
        const cached = this.listSummaries.get(key);
        const item = cached?.stamp === stamp ? cached.summary : summary(await themeDetails(local));
        if (cached?.stamp !== stamp && await themeListStamp(local) !== stamp) throw new ContractError("THEME_CHANGED", "The theme changed while reading its list summary.", true);
        summaries.set(key, { stamp, summary: item });
        themes.push(item);
        if (previewThemes.size < 256) previewThemes.set(key, { local, revision: item.revision });
      }
      catch (error) {
        warnings.push({ code: error instanceof ContractError ? error.code : "IO_ERROR", message: "A theme could not be read consistently and was omitted." });
      }
    }
    themes.sort((a, b) => a.catalogOrder - b.catalogOrder || a.ref.id.localeCompare(b.ref.id, "en"));
    this.listSummaries = summaries;
    const revision = sha256([new TextEncoder().encode(JSON.stringify({ themes, warnings }))]);
    let offset = 0;
    if (params.cursor) {
      let cursor: unknown;
      try { cursor = JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8")); }
      catch { throw new ContractError("INVALID_REQUEST", "Invalid pagination cursor."); }
      if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== this.sessionId || cursor[1] !== revision) {
        throw new ContractError("CATALOG_CHANGED", "The catalog or backend session changed; restart pagination.", true);
      }
      if (!Number.isSafeInteger(cursor[2]) || cursor[2] < 0 || cursor[2] >= themes.length) {
        throw new ContractError("INVALID_REQUEST", "Invalid pagination offset.");
      }
      offset = cursor[2] as number;
    }
    const limit = params.limit ?? 100;
    const result: ThemePage = { revision, themes: themes.slice(offset, offset + limit), warnings };
    this.previewThemes = previewThemes;
    if (offset + limit < themes.length) result.nextCursor = Buffer.from(JSON.stringify([this.sessionId, revision, offset + limit])).toString("base64url");
    return result;
  }
  private async get(ref: MethodMap["themes.get"]["params"]["theme"]): Promise<ThemeDetails> {
    const details = await themeDetails(await this.find(ref));
    const writerBusy = !!this.operations?.activeIds.length || !!this.updates?.busy || !!this.maintenance?.busy;
    details.availability.apply = { allowed: !!this.operations && !writerBusy, reasonCode: !this.operations ? "METHOD_UNSUPPORTED" : writerBusy ? "BUSY" : null };
    details.availability.update = details.availability.copy = { allowed: !!this.operations && !!this.library && !writerBusy,
      reasonCode: !this.operations || !this.library ? "METHOD_UNSUPPORTED" : writerBusy ? "BUSY" : null };
    // This affordance permits requesting deletion checks, not deletion itself.
    // Full runtime/tree protection and confirmation belong to proposeLibrary;
    // running that preflight for every selection would block the preview queue.
    const deleteReason = !this.operations || !this.library ? "METHOD_UNSUPPORTED" : writerBusy ? "BUSY"
      : defaultRecoveryThemeIds(this.platform.name).includes(ref.id.toLowerCase()) ? "THEME_PROTECTED" : null;
    details.availability.delete = { allowed: deleteReason === null, reasonCode: deleteReason };
    return details;
  }
  private async communityDownloads(versions: Set<string>): Promise<CommunityLocalTheme[]> {
    const result: CommunityLocalTheme[] = [];
    if (!versions.size) return result;
    for (const local of (await this.platform.inventory()).themes) {
      const origin = communityOrigin(local.config.managerCommunity);
      if (local.ref.source !== "saved" || !origin || !versions.has(origin.version)) continue;
      try { result.push({ ...origin, theme: local.ref, revision: (await themeDetails(local)).revision,
        compatibility: communityCompatibility(record(local.config.packageOrigin) ? local.config.packageOrigin.manifest : undefined) }); }
      catch { /* Missing or damaged files must not leave a downloaded badge. */ }
    }
    return result;
  }
  private async find(ref: ThemeRef) {
    const inventory = await this.platform.inventory();
    const local = inventory.themes.find(theme => theme.ref.id === ref.id && theme.ref.source === ref.source);
    if (!local) {
      if (inventory.warnings.length) throw new ContractError("THEME_INVALID", "The theme is missing or its library could not be read reliably.", true);
      throw new ContractError("THEME_NOT_FOUND", "The requested theme is not in this library.");
    }
    return local;
  }
  close(): Promise<void> {
    this.closing = true;
    return this.closeJob ??= (async () => {
      const events = this.events.close();
      try { await this.community?.close(); await this.maintenance?.close(); await this.updates?.close(); await this.operations?.close(); }
      finally { await events; await this.nativeFiles?.close(); await this.sources?.close(); await this.packages?.close(); }
    })();
  }
}
