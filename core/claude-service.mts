import path from "node:path";
import { ContractError, APPEARANCE_PARAMETER_KEYS, failure, parseAppearanceParameters, parseThemeRef, record, validOperationId } from "../contracts/manager.mjs";
import type { AppearanceMutationMethod, AppearanceOperation, AppearanceParameters, AppearanceSnapshot, AppearanceTarget, Diagnostic, MethodMap, StartupAnimationSettings, StartupAnimationUpdate, ThemeRef } from "../contracts/manager.mjs";
import type { AppearanceMediaInspector, AppearanceMediaMetadata, AppearanceRuntimeObservation, AppearanceRuntimePort, AppearanceStartupPayload } from "./ports/claude.mjs";
import type { LocalTheme } from "./ports/platform.mjs";
import { fileBytes, jsonObject, MAX_MEDIA_BYTES, optionalBytes, sha256 } from "./local-files.mjs";
import { durableBytes, durableJson, privateDirectory } from "./write-files.mjs";
import { readThemeContent } from "./theme-model.mjs";
import { canonicalJson } from "./theme-edit.mjs";
import { startupAnimationSettings, saveStartupAnimationSettings } from "./startup-animation.mjs";

interface ActiveCopy {
  schemaVersion: 1; theme: ThemeRef; themeRevision: string; revision: string;
  mediaDigest: string; mimeType: string; mediaKind: AppearanceMediaMetadata["mediaKind"]; parameters: AppearanceParameters; paused: boolean;
}
interface Receipt<T extends AppearanceTarget> { schemaVersion: 1; requestDigest: string; operation: AppearanceOperation<T> }
const digest = (value: unknown): string => sha256([Buffer.from(canonicalJson(value))]);
const revision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const parameterSubset = (parameters: Partial<AppearanceParameters>): AppearanceParameters => Object.fromEntries(APPEARANCE_PARAMETER_KEYS.map(key => [key, parameters[key] ?? null])) as AppearanceParameters;
function mergeParameters(base: Partial<AppearanceParameters>, patch: Partial<AppearanceParameters>): Partial<AppearanceParameters> {
  const parameters = { ...base, ...patch };
  if (parameters.framingEnabled === false) {
    parameters.positionX = null; parameters.positionY = null; parameters.zoom = null; parameters.positionMode = null;
  }
  return parseAppearanceParameters(parameters);
}

const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/apng": ".apng", "video/mp4": ".mp4" };

export class AppearanceService<T extends AppearanceTarget> {
  private readonly directory: string;
  private locked = false;
  private capturingSource = false;
  private closing = false;
  private stateGeneration = 0;
  private readonly jobs = new Set<Promise<unknown>>();
  private readonly live = new Map<string, Receipt<T>>();
  private startupConfigured: Promise<void> | undefined;
  private startupDiagnostics: Diagnostic[] = [];
  constructor(private readonly target: T, root: string, private readonly session: string, private readonly find: (theme: ThemeRef) => Promise<LocalTheme>,
    private readonly runtime?: AppearanceRuntimePort, private readonly libraryBusy: () => boolean = () => false,
    private readonly defaultTheme?: () => Promise<LocalTheme | null>, private readonly inspectMedia?: AppearanceMediaInspector) {
    this.directory = path.join(root, target === "claude" ? "claude-desktop" : target);
  }
  private get label(): string { return this.target === "claude" ? "Claude Desktop" : this.target === "dsh" ? "DSH rc" : "DSH Next"; }
  private get diagnosticPrefix(): string { return this.target === "claude" ? "CLAUDE" : this.target === "dsh" ? "DSH" : "DSH_NEXT"; }
  get busy(): boolean { return this.locked; }
  get capturing(): boolean { return this.capturingSource; }
  private async capture<R>(action: () => Promise<R>): Promise<R> {
    if (this.libraryBusy()) throw new ContractError("BUSY", "Another theme write is in progress.", true);
    this.capturingSource = true;
    try { return await action(); }
    finally { this.capturingSource = false; }
  }
  private async read(file: string, maximum = 64 * 1024): Promise<Record<string, unknown> | null> {
    const bytes = await optionalBytes(file, this.directory, maximum);
    return bytes ? jsonObject(bytes) : null;
  }
  private async active(): Promise<ActiveCopy | null> {
    const value = await this.read(path.join(this.directory, "active.json"));
    if (!value || value.active === null) return null;
    if (value.schemaVersion !== 1 || !revision(value.themeRevision) || !revision(value.revision) || !revision(value.mediaDigest) ||
        !Object.hasOwn(extensions, String(value.mimeType)) || typeof value.paused !== "boolean" ||
        (value.mediaKind !== undefined && !["image", "animatedImage", "video"].includes(String(value.mediaKind))) ||
        (value.mediaKind === undefined && !["image/jpeg", "image/png", "image/webp"].includes(String(value.mimeType))) ||
        !record(value.parameters) || APPEARANCE_PARAMETER_KEYS.some(key => key !== "playbackRate" && !Object.hasOwn(value.parameters as object, key))) throw new ContractError("IO_ERROR", `The ${this.label} active snapshot is invalid.`);
    parseThemeRef(value.theme); parseAppearanceParameters(value.parameters);
    return { ...value, mediaKind: value.mediaKind ?? "image", parameters: parameterSubset({ playbackRate: 1, ...value.parameters }) } as unknown as ActiveCopy;
  }
  private async saveActive(active: ActiveCopy | null): Promise<void> {
    await privateDirectory(this.directory);
    await durableJson(path.join(this.directory, "active.json"), this.directory, active ?? { schemaVersion: 1, active: null });
  }
  private snapshot(active: ActiveCopy | null, observed?: AppearanceRuntimeObservation): AppearanceSnapshot<T> {
    const mismatch = observed?.renderer === "applied" && (!active || active.paused || observed.revision !== active.revision);
    return { target: this.target, supported: !!this.runtime,
      connection: observed?.connection ?? (this.runtime ? "awaiting-debugger" : "unavailable"),
      renderer: mismatch ? "unknown" : observed?.renderer ?? (this.runtime ? "unknown" : "unavailable"),
      theme: active?.theme ?? null, themeRevision: active?.themeRevision ?? null,
      parameters: active?.parameters ?? null, paused: active?.paused ?? false, diagnostics: [...this.startupDiagnostics, ...observed?.diagnostics ?? [], ...(mismatch ? [{ code: `${this.diagnosticPrefix}_REVISION_MISMATCH`, message: `The ${this.label} renderer does not match the selected background snapshot.` }] : [])] };
  }
  async status(): Promise<AppearanceSnapshot<T>> {
    const generation = this.stateGeneration;
    const active = await this.active();
    if (!this.runtime) return this.snapshot(active);
    try { return await this.observedSnapshot(active, generation, await this.runtime.inspect()); }
    catch (error) {
      const result = failure(null, error);
      return this.observedSnapshot(active, generation, { connection: "unavailable", renderer: "unknown", revision: null, diagnostics: [{ code: result.ok ? "IO_ERROR" : result.error.code, message: result.ok ? `${this.label} status is unavailable.` : result.error.message }] });
    }
  }
  private async observedSnapshot(active: ActiveCopy | null, generation: number, observed: AppearanceRuntimeObservation): Promise<AppearanceSnapshot<T>> {
    if (generation === this.stateGeneration && !this.locked) return this.snapshot(active, observed);
    // A probe that crossed a write cannot prove the renderer for the selection
    // it read earlier. Keep the latest desired state and let the next poll prove
    // its renderer, without delaying writes or repeating the external probe.
    return this.snapshot(await this.active(), { ...observed, renderer: "unknown", revision: null,
      diagnostics: [...observed.diagnostics, { code: `${this.diagnosticPrefix}_STATUS_CHANGED`, message: `The ${this.label} selection changed during this status probe; refresh its renderer status.` }] });
  }
  private parameterFile(theme: ThemeRef): string { return path.join(this.directory, "parameters", digest(theme) + ".json"); }
  async parameters(theme: ThemeRef): Promise<{ parameters: Partial<AppearanceParameters> }> {
    const value = await this.read(this.parameterFile(theme));
    if (!value) return { parameters: {} };
    if (value.schemaVersion !== 1 || canonicalJson(value.theme) !== canonicalJson(theme)) throw new ContractError("IO_ERROR", `The ${this.label} parameter record is invalid.`);
    return { parameters: parseAppearanceParameters(value.parameters) };
  }
  private exclusive<R>(action: () => Promise<R>): Promise<R> {
    if (this.closing) throw new ContractError("BACKEND_UNAVAILABLE", `The ${this.label} service is closing.`);
    if (!this.runtime) throw new ContractError("METHOD_UNSUPPORTED", `${this.label} controls are available in the Windows manager only.`);
    if (this.locked) throw new ContractError("BUSY", "Another theme write is in progress.", true);
    this.locked = true;
    this.stateGeneration++;
    const job = action().finally(() => { this.stateGeneration++; this.locked = false; this.jobs.delete(job); });
    this.jobs.add(job); return job;
  }
  updateParameters(params: MethodMap["claude.parameters.update"]["params"]): Promise<{ parameters: Partial<AppearanceParameters>; snapshot: AppearanceSnapshot<T> | null; refreshError: AppearanceOperation<T>["error"] }> {
    return this.exclusive(async () => {
      parseThemeRef(params.theme);
      const parameters = mergeParameters((await this.parameters(params.theme)).parameters, parseAppearanceParameters(params.parameters));
      const file = this.parameterFile(params.theme); await privateDirectory(path.dirname(file));
      await durableJson(file, this.directory, { schemaVersion: 1, theme: params.theme, parameters });
      let snapshot: AppearanceSnapshot<T> | null = null;
      try {
        const active = await this.active();
        if (active && canonicalJson(active.theme) === canonicalJson(params.theme)) {
          const updated = { ...active, parameters: parameterSubset(mergeParameters(active.parameters, parameters)) };
          updated.revision = digest({ themeRevision: updated.themeRevision, mediaDigest: updated.mediaDigest, parameters: updated.parameters });
          await this.saveActive(updated);
          snapshot = this.snapshot(updated);
          if (!updated.paused) {
            await this.ensureStartupForBackground();
            snapshot = this.snapshot(updated);
            const observed = await this.runtime!.apply(await this.payload(updated));
            snapshot = this.snapshot(updated, observed);
            if (observed.connection !== "connected" || snapshot.renderer !== "applied") throw new ContractError(observed.connection === "connected" ? "RENDERER_UNVERIFIED" : "RUNTIME_UNAVAILABLE", `The saved ${this.label} parameters could not be confirmed in its renderer.`);
          }
        }
        return { parameters, snapshot, refreshError: null };
      } catch (error) {
        const result = failure(null, error);
        return { parameters, snapshot, refreshError: result.ok ? null : result.error };
      }
    });
  }
  private async metadata(bytes: Uint8Array, extension: string): Promise<AppearanceMediaMetadata> {
    if (!this.inspectMedia) throw new ContractError("MEDIA_UNSUPPORTED", `${this.label} media validation is unavailable.`);
    if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new ContractError("MEDIA_UNSUPPORTED", `${this.label} media exceeds the supported size limit.`);
    const metadata = await this.inspectMedia(bytes, extension);
    if (!Object.hasOwn(extensions, metadata.mimeType)) throw new ContractError("MEDIA_UNSUPPORTED", `${this.label} supports JPEG, PNG, WebP, GIF, APNG and MP4 media.`);
    return metadata;
  }
  private async payload(active: ActiveCopy): Promise<Parameters<AppearanceRuntimePort["apply"]>[0]> {
    const bytes = await fileBytes(path.join(this.directory, "media", active.mediaDigest), this.directory, MAX_MEDIA_BYTES);
    if (sha256([bytes]) !== active.mediaDigest) throw new ContractError("IO_ERROR", `The ${this.label} media snapshot changed.`);
    const metadata = await this.metadata(bytes, extensions[active.mimeType]!);
    if (metadata.mimeType !== active.mimeType || metadata.mediaKind !== active.mediaKind) throw new ContractError("IO_ERROR", `The ${this.label} media snapshot type changed.`);
    return { revision: active.revision, mimeType: active.mimeType, mediaKind: active.mediaKind,
      mediaBase64: Buffer.from(bytes).toString("base64"), parameters: active.parameters };
  }
  startupSettings(): Promise<StartupAnimationSettings> { return startupAnimationSettings(this.directory); }
  private async startupVideo(theme: ThemeRef, expectedRevision?: string): Promise<{ video: NonNullable<AppearanceStartupPayload["video"]>; name: string }> {
    return this.capture(async () => {
      const local = await this.find(theme), content = await readThemeContent(local);
      if (expectedRevision !== undefined && content.details.revision !== expectedRevision) throw new ContractError("THEME_CHANGED", `Refresh the theme before selecting its ${this.label} startup video.`);
      const metadata = await this.metadata(content.media, path.extname(local.mediaPath).toLowerCase());
      if (metadata.mediaKind !== "video" || metadata.mimeType !== "video/mp4") throw new ContractError("MEDIA_UNSUPPORTED", "Only MP4 video themes can be used as startup animations.");
      return { video: { mimeType: "video/mp4" as const, mediaBase64: Buffer.from(content.media).toString("base64") }, name: content.details.name };
    });
  }
  private async configureStartup(settings: StartupAnimationSettings): Promise<void> {
    let video: AppearanceStartupPayload["video"] = null;
    this.startupDiagnostics = [];
    if (settings.enabled && settings.theme) {
      try { video = (await this.startupVideo(settings.theme)).video; }
      catch (error) {
        // Missing or no longer supported selections retain their setting while
        // the built-in animation remains usable. Other I/O failures stay visible.
        if (!(error instanceof ContractError && ["THEME_NOT_FOUND", "MEDIA_UNSUPPORTED", "THEME_INVALID"].includes(error.code)) && !(record(error) && error.code === "ENOENT")) throw error;
        this.startupDiagnostics = [{ code: `${this.diagnosticPrefix}_STARTUP_FALLBACK`, message: `The selected ${this.label} startup video is unavailable; the built-in animation will be used.` }];
      }
    }
    await this.runtime!.configureStartup({ enabled: settings.enabled, video });
  }
  private ensureStartup(): Promise<void> {
    if (!this.startupConfigured) {
      const job = this.startupSettings().then(settings => this.configureStartup(settings));
      this.startupConfigured = job;
      void job.catch(() => { if (this.startupConfigured === job) this.startupConfigured = undefined; });
    }
    return this.startupConfigured;
  }
  private async ensureStartupForBackground(): Promise<void> {
    try { await this.ensureStartup(); }
    catch (error) {
      const result = failure(null, error);
      this.startupDiagnostics = [{ code: `${this.diagnosticPrefix}_STARTUP_FAILED`, message: result.ok ? `${this.label} startup animation could not be configured.` : result.error.message }];
    }
  }
  updateStartup(params: StartupAnimationUpdate): Promise<StartupAnimationSettings> {
    return this.exclusive(async () => {
      const settings = await this.startupSettings();
      if (params.enabled !== undefined) settings.enabled = params.enabled;
      let selected: Awaited<ReturnType<AppearanceService<T>["startupVideo"]>> | undefined;
      if (params.theme === null) { settings.theme = null; settings.themeName = null; }
      else if (params.theme) {
        selected = await this.startupVideo(params.theme, params.expectedRevision);
        settings.theme = params.theme; settings.themeName = selected.name;
      }
      await saveStartupAnimationSettings(this.directory, settings);
      this.startupConfigured = undefined;
      if (selected) {
        this.startupDiagnostics = [];
        await this.runtime!.configureStartup({ enabled: settings.enabled, video: settings.enabled ? selected.video : null });
      } else await this.configureStartup(settings);
      this.startupConfigured = Promise.resolve();
      return settings;
    });
  }
  private receiptFile(id: string): string {
    if (!validOperationId(id)) throw new ContractError("INVALID_REQUEST", `Invalid ${this.label} operation identity.`);
    return path.join(this.directory, "operations", digest(id) + ".json");
  }
  private async receipt(id: string): Promise<Receipt<T> | null> {
    const value = this.live.get(id) ?? await this.read(this.receiptFile(id));
    if (!value) return null;
    if (value.schemaVersion !== 1 || !revision(value.requestDigest) || !record(value.operation) || value.operation.id !== id || value.operation.target !== this.target ||
        !["apply", "pause", "resume", "reset", "restore"].map(action => `${this.target}.${action}`).includes(String(value.operation.method)) ||
        !["running", "succeeded", "failed", "indeterminate"].includes(String(value.operation.state)) || !record(value.operation.snapshot)) throw new ContractError("IO_ERROR", `The ${this.label} operation receipt is invalid.`);
    return value as unknown as Receipt<T>;
  }
  async get(id: string): Promise<AppearanceOperation<T>> {
    const receipt = await this.receipt(id);
    if (!receipt) throw new ContractError("OPERATION_UNKNOWN", `This ${this.label} operation is unknown.`);
    const operation = structuredClone(receipt.operation);
    if (operation.state === "running" && !this.live.has(id)) {
      operation.state = "indeterminate";
      operation.error = { code: "OPERATION_UNKNOWN", message: "The previous manager connection ended before a final receipt. This operation will not be replayed.", retryable: false };
    }
    return operation;
  }
  async command(method: AppearanceMutationMethod<T>, params: MethodMap["claude.apply"]["params"] | { operationId: string }): Promise<AppearanceOperation<T>> {
    const requestDigest = digest({ method, params }), known = await this.receipt(params.operationId);
    if (known) {
      if (known.requestDigest !== requestDigest) throw new ContractError("OPERATION_CONFLICT", `This ${this.label} operation identity was already used for another request.`);
      return this.get(params.operationId);
    }
    if (!params.operationId.startsWith(this.session + ":")) throw new ContractError("OPERATION_UNKNOWN", `A new ${this.label} operation requires the current manager connection.`);
    return this.exclusive(async () => {
      const receipt: Receipt<T> = { schemaVersion: 1, requestDigest, operation: {
        id: params.operationId, target: this.target, method, state: "running", snapshot: this.snapshot(null), error: null,
      } };
      const file = this.receiptFile(params.operationId); await privateDirectory(path.dirname(file));
      await durableJson(file, this.directory, receipt, true); this.live.set(params.operationId, receipt);
      let invoked = false;
      try {
        let active: ActiveCopy | null = null;
        let payload: Parameters<AppearanceRuntimePort["apply"]>[0] | null = null;
        if (method === `${this.target}.apply` || method === `${this.target}.reset`) {
          const request = method === `${this.target}.apply` ? params as MethodMap["claude.apply"]["params"] : null;
          const { local, content, metadata } = await this.capture(async () => {
            const local = request ? await this.find(request.theme) : await this.defaultTheme?.();
            if (!local) throw new ContractError("THEME_NOT_FOUND", `The default ${this.label} background is unavailable.`);
            const content = await readThemeContent(local);
            if (request && content.details.revision !== request.expectedRevision) throw new ContractError("THEME_CHANGED", `Refresh the theme before applying it to ${this.label}.`);
            const metadata = await this.metadata(content.media, path.extname(local.mediaPath).toLowerCase());
            return { local, content, metadata };
          });
          // Codex-specific CSS is intentionally excluded from appearance payloads.
          const inherited = request ? mergeParameters(parameterSubset({}), (await this.parameters(request.theme)).parameters) : parameterSubset({});
          const parameters = parameterSubset(mergeParameters(inherited, request?.parameters ?? {}));
          const mediaDigest = sha256([content.media]), mediaFile = path.join(this.directory, "media", mediaDigest);
          await privateDirectory(path.dirname(mediaFile));
          const existing = await optionalBytes(mediaFile, this.directory, MAX_MEDIA_BYTES);
          if (existing) { if (sha256([existing]) !== mediaDigest) throw new ContractError("IO_ERROR", `The ${this.label} media snapshot is damaged.`); }
          else await durableBytes(mediaFile, this.directory, content.media);
          active = { schemaVersion: 1, theme: local.ref, themeRevision: content.details.revision,
            revision: digest({ themeRevision: content.details.revision, mediaDigest, parameters }), mediaDigest,
            mimeType: metadata.mimeType, mediaKind: metadata.mediaKind, parameters, paused: false };
          payload = { revision: active.revision, mimeType: active.mimeType, mediaKind: active.mediaKind, parameters,
            mediaBase64: Buffer.from(content.media).toString("base64") };
        } else if (method === `${this.target}.resume`) {
          active = await this.active();
          if (!active) throw new ContractError("THEME_NOT_FOUND", `Select a ${this.label} background before resuming.`);
          active = { ...active, paused: false };
        } else if (method === `${this.target}.pause`) {
          active = await this.active();
          if (active) active = { ...active, paused: true };
        }
        if (method === `${this.target}.resume`) payload = await this.payload(active!);
        await this.saveActive(active);
        receipt.operation.snapshot = this.snapshot(active);
        invoked = true;
        if (payload) {
          if (await this.runtime!.prepareApply?.()) this.startupConfigured = undefined;
          await this.ensureStartupForBackground();
          receipt.operation.snapshot = this.snapshot(active);
        }
        else this.startupConfigured = undefined;
        const observed = payload ? await this.runtime!.apply(payload) : await this.runtime!.remove();
        receipt.operation.snapshot = this.snapshot(active, observed);
        const expected = payload ? "applied" : "removed";
        const succeeded = observed.connection === "connected" && receipt.operation.snapshot.renderer === expected;
        receipt.operation.state = succeeded ? "succeeded" : observed.connection === "connected" ? "indeterminate" : "failed";
        if (!succeeded) receipt.operation.error = { code: observed.connection === "connected" ? "RENDERER_UNVERIFIED" : "RUNTIME_UNAVAILABLE", message: `The requested ${this.label} renderer state could not be confirmed.`, retryable: false };
      } catch (error) {
        const result = failure(null, error);
        receipt.operation.state = invoked ? "indeterminate" : "failed";
        receipt.operation.error = result.ok ? null : result.error;
      }
      try { await durableJson(file, this.directory, receipt); }
      catch (error) {
        receipt.operation.state = "indeterminate";
        const result = failure(null, error); receipt.operation.error = result.ok ? null : result.error;
        throw error;
      }
      return structuredClone(receipt.operation);
    });
  }
  async close(): Promise<void> {
    this.closing = true; await Promise.allSettled([...this.jobs]); await this.runtime?.close();
  }
}

// Retain the existing constructor and types for Claude callers.
export class ClaudeService extends AppearanceService<"claude"> {
  constructor(root: string, session: string, find: (theme: ThemeRef) => Promise<LocalTheme>,
    runtime?: AppearanceRuntimePort, libraryBusy?: () => boolean, defaultTheme?: () => Promise<LocalTheme | null>, inspectMedia?: AppearanceMediaInspector) {
    super("claude", root, session, find, runtime, libraryBusy, defaultTheme, inspectMedia);
  }
}
