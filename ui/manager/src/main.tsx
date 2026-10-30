import { errorMessage, uiMessage, UiMessageError, renderMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApplyRefresh, HelloResult, ManagerSnapshot, OperationSnapshot, RuntimeMethod, ThemeDetails, ThemePatch, ThemeRef, ThemeSummary } from "../../../contracts/manager.mjs";
import { BridgeError, ManagerClient, reconnectManager } from "./client";
import { ThemeEditor } from "./ThemeEditor";
import { ImportPanel } from "./ImportPanel";
import { QuickImport } from "./QuickImport";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { CommunityPanel } from "./CommunityPanel";
import { UpdatePanel } from "./UpdatePanel";
import { SystemPanel } from "./SystemPanel";
import { LanguageContext, copy } from "./desktop";
import { translateText } from "./ui-copy";
import { confirmationText } from "./confirmation-copy";
import type { DesktopInfo, DesktopIntent } from "../../../contracts/manager.mjs";
import { ThemeLibrary } from "./ThemeLibrary";
import { Select } from "./Select";
import { ThemeDetailsPanel } from "./ThemeDetailsPanel";
import "./style.css";

const message = (error: unknown) => errorMessage(error, "操作失败，请稍后重试。");
const identity = (theme: ThemeSummary) => `${theme.ref.source}:${theme.ref.id}`;
const health = { healthy: "运行中", stopped: "未运行", stale: "需要重新连接", degraded: "需要重新连接", mismatch: "需要重新连接", unknown: "状态暂不可用" };
const renderer = { applied: "已核验显示", removed: "已核验移除", unknown: "尚未核验", unavailable: "无法核验" };
const pages = { console: "控制台", import: "导入图片", settings: "主题设置" } as const;
type Page = keyof typeof pages;
const operationLabels: Record<OperationSnapshot["state"], string> = { queued: "已排队", running: "正在处理", awaitingConfirmation: "等待确认", succeeded: "已完成", failed: "操作未完成", cancelled: "已取消", indeterminate: "结果待核对" };
const pendingOperation = (value: OperationSnapshot | null) => !!value && ["queued", "running", "awaitingConfirmation"].includes(value.state);
const storageKey = "dreamskin.manager.operation";
const operationTitles: Record<OperationSnapshot["method"], string> = { "skin.apply": "应用", "skin.pause": "暂停皮肤", "skin.resume": "继续当前皮肤", "skin.reset": "重置默认主题", "skin.restore": "恢复原始外观", "runtime.repair": "修复皮肤连接", "runtime.upgrade": "升级皮肤运行时", "themes.update": "保存修改", "themes.copy": "另存副本", "themes.create": "素材导入", "themes.importPackage": "主题包导入", "themes.delete": "删除主题", "library.recover": "库操作恢复" };
async function readLibrary(client: ManagerClient) {
  const themes = new Map<string, ThemeSummary>(), warnings = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.call("themes.list", { limit: 100, ...(cursor ? { cursor } : {}) });
    for (const theme of page.themes) themes.set(identity(theme), theme);
    for (const warning of page.warnings) warnings.add(warning.message);
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new UiMessageError(uiMessage("主题库读取未完成，请刷新后重试。"));
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { themes: [...themes.values()], warnings: [...warnings] };
}
function operationFeedback(operation: OperationSnapshot): UiMessage {
  if (operation.state === "awaitingConfirmation") return "";
  if (operation.effects.rollbackVerified) return uiMessage("应用未完成，已恢复原主题；导入的主题仍在库中。");
  if (operation.state === "indeterminate") return uiMessage("结果暂不确定，请刷新状态后核对；不会重复执行。");
  if (operation.error) return operation.error.message;
  if (operation.state === "succeeded" && ["skin.apply", "skin.resume", "skin.reset", "runtime.repair", "runtime.upgrade"].includes(operation.method) && operation.effects.rendererApplied !== true)
    return uiMessage("操作已完成，请刷新确认当前外观。");
  return uiMessage("{action}：{result}", { action: { key: operationTitles[operation.method] }, result: { key: operationLabels[operation.state] } });
}

function App() {
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null), [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [incomingLinks, setIncomingLinks] = useState<DesktopIntent[]>([]);
  const onMaintenanceBusy = useCallback((value: boolean) => setMaintenanceBusy(value), []);
  const onDesktopInfo = useCallback((value: DesktopInfo) => setDesktopInfo(value), []);
  const consumeLink = useCallback((id: string) => setIncomingLinks(previous => previous.filter(value => value.id !== id)), []);
  const language = desktopInfo?.resolvedLanguage ?? "zh-CN";
  const tr = (value: string, values?: Record<string, string | number>) => translateText(language, value, values);
  const msg = (value: UiMessage) => renderMessage(language, value);
  const t = (key: keyof typeof copy) => copy[key][language === "zh-CN" ? 0 : 1];
  const [updateBusy, setUpdateBusy] = useState(false), [updateAvailable, setUpdateAvailable] = useState(false);
  const onUpdateBusy = useCallback((value: boolean) => setUpdateBusy(value), []), onUpdateAvailable = useCallback((value: boolean) => setUpdateAvailable(value), []);
  const [client, setClient] = useState<ManagerClient | null>(null), [hello, setHello] = useState<HelloResult | null>(null);
  const [snapshot, setSnapshot] = useState<ManagerSnapshot | null>(null), [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [details, setDetails] = useState<ThemeDetails | null>(null), [selected, setSelected] = useState("");
  const [activeSkin, setActiveSkin] = useState<ThemeDetails | null>(null), [activeRead, setActiveRead] = useState(0);
  const [utility, setUtility] = useState<"updates" | "system" | null>(null), [updateCheck, setUpdateCheck] = useState(0);
  const utilityDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = utilityDialog.current;
    if (!dialog) return;
    if (utility && !dialog.open) dialog.showModal();
    else if (!utility && dialog.open) dialog.close();
  }, [utility]);
  const [quickImport, setQuickImport] = useState({ sequence: 0, packages: false });
  const [feedback, setFeedback] = useState<UiMessage>("");
  const onNotice = useCallback((value: UiMessage) => setFeedback(value), []);
  const [page, setPage] = useState<Page>("console"), [error, setError] = useState<UiMessage>("");
  const focusPage = useRef(false);
  const [nativeSection, setNativeSection] = useState("none");
  useEffect(() => {
    if (!client || !hello?.capabilities.methods.includes("desktop.get")) return;
    let active = true, requesting = false;
    const refreshInfo = () => { void client.call("desktop.get", {}).then(value => { if (active) setDesktopInfo(value); }).catch(() => {}); };
    refreshInfo();
    const receive = async () => {
      if (!active || requesting || document.hidden) return; requesting = true;
      try {
        const value = await client.call("desktop.intents", {});
        if (!active) return;
        for (const intent of value.intents) {
          if (intent.link) setIncomingLinks(previous => [...previous.filter(item => item.id !== intent.id), intent].slice(-8));
          else { setPage(intent.page); setNativeSection(intent.section); }
        }
      } catch { /* A busy native dialog keeps its queued intents for a later read. */ }
      finally { requesting = false; }
    };
    void receive(); const timer = window.setInterval(() => void receive(), 5000);
    const focus = () => { refreshInfo(); void receive(); };
    window.addEventListener("focus", focus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [client, hello]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Dream Skin · ${t(page)}`;
    if (page === "settings" && nativeSection !== "none") {
      setUtility(nativeSection === "updates" ? "updates" : "system");
      if (nativeSection === "updates") setUpdateCheck(value => value + 1);
      setNativeSection("none");
    }
  }, [page, nativeSection, language]);
  function goPage(next: Page) {
    if (next === page) { document.getElementById(`page-${next}-title`)?.focus(); return; }
    focusPage.current = true; setPage(next);
  }
  useEffect(() => { if (focusPage.current) { focusPage.current = false; document.getElementById(`page-${page}-title`)?.focus(); } }, [page]);
  const [loading, setLoading] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const [statusError, setStatusError] = useState<UiMessage>(""), [loadingDetails, setLoadingDetails] = useState(false);
  const [operation, setOperation] = useState<OperationSnapshot | null>(null), [operationId, setOperationId] = useState<string | null>(null);
  const [operationRead, setOperationRead] = useState(0);
  const [operationBusy, setOperationBusy] = useState(false), [operationError, setOperationError] = useState<UiMessage>("");
  const [draftDirty, setDraftDirty] = useState(false), [pendingSelection, setPendingSelection] = useState<ThemeSummary | "refresh" | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<UiMessage>("");
  const [libraryRead, setLibraryRead] = useState(0), [editorVersion, setEditorVersion] = useState(0);
  const handledLibraryRead = useRef(0);
  const [importBusy, setImportBusy] = useState(false), [fileBusy, setFileBusy] = useState(false);
  const onDirty = useCallback((value: boolean) => setDraftDirty(value), []);
  const onImportBusy = useCallback((value: boolean) => setImportBusy(value), []);
  const onImportOperation = useCallback((value: OperationSnapshot) => { setOperation(value); setOperationId(value.id); }, []);
  const onImportIntent = useCallback((id: string) => { setOperation(previous => previous?.id === id ? previous : null); setOperationId(id); }, []);
  const onImported = useCallback(() => { setLibraryRead(value => value + 1); }, []);
  const mounted = useRef(true), connected = useRef(true);
  const applicationContext = useRef({ client, hello, snapshot, statusError, draftDirty, operationBusy, fileBusy, updateBusy, maintenanceBusy });
  applicationContext.current = { client, hello, snapshot, statusError, draftDirty, operationBusy, fileBusy, updateBusy, maintenanceBusy };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loadSequence = useRef(0), selectionSequence = useRef(0), loadingList = useRef(false);
  useEffect(() => {
    let value: ManagerClient;
    try { value = new ManagerClient(); } catch (error) { setError(message(error)); setDisconnected(true); setLoading(false); return; }
    let active = true; setClient(value);
    const disconnected = value.onDisconnected(() => { connected.current = false; if (active) { setDisconnected(true); setHello(null); setSnapshot(null); setStatusError(uiMessage("管理器连接已关闭，请重新连接；已接受的操作不会自动重试。")); } });
    const events = value.onEvent(event => {
      if (!active) return;
      if (event.event === "status.changed") {
        setSnapshot(previous => !previous || previous.sequence <= event.snapshot.sequence ? event.snapshot : previous); setStatusError("");
      } else if (event.event === "status.invalidated") { setSnapshot(null); setStatusError(uiMessage("状态观察失败，请刷新后再操作。")); }
    });
    void value.hello().then(hello => { if (active && connected.current) setHello(hello); }).catch(error => { if (active) { setError(message(error)); setDisconnected(true); setLoading(false); } });
    let refreshing = false, subscribed = false;
    const refresh = async () => {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try { const current = await value.call("status.get", {}); if (active && connected.current) { setSnapshot(previous => !previous || previous.backendSessionId !== current.backendSessionId || previous.sequence <= current.sequence ? current : previous); setStatusError(""); } }
      catch (error) { if (active) { setSnapshot(null); setStatusError(message(error)); } }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!subscribed) void refresh(); }, 15000);
    void value.hello().then(async hello => { if (active && hello.capabilities.methods.includes("events.subscribe")) { await value.call("events.subscribe", {}); subscribed = true; } }).catch(() => { /* read-only refresh remains available */ });
    const visibility = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", visibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", visibility); disconnected(); events(); value.close(); };
  }, []);
  async function load(reset: boolean, discard = false) {
    if (!client || loadingList.current) return;
    if (updateBusy || maintenanceBusy || operationBusy || importBusy || fileBusy || pendingOperation(operation)) return;
    if (reset && draftDirty && !discard) { setPendingSelection("refresh"); return; }
    const sequence = ++loadSequence.current; loadingList.current = true; setLoading(true); setError("");
    const selection = selectionSequence.current, selectedTheme = details;
    if (discard) { setEditorVersion(value => value + 1); setDraftDirty(false); }
    try {
      const library = await readLibrary(client);
      if (sequence !== loadSequence.current || !mounted.current) return;
      setThemes(library.themes);
      if (library.warnings.length) setLibraryNotice(uiMessage("部分主题无法读取，请刷新主题库后重试。"));
      if (reset && selectedTheme) {
        try {
          const current = await client.call("themes.get", { theme: selectedTheme.ref });
          if (sequence === loadSequence.current && selection === selectionSequence.current && !applicationContext.current.draftDirty) {
            setDetails(current);
            setThemes(previous => previous.some(theme => identity(theme) === identity(current)) ? previous : [...previous, current]);
          }
        } catch (error) {
          if (selection === selectionSequence.current && !applicationContext.current.draftDirty) {
            if (error instanceof BridgeError && error.detail.code === "THEME_NOT_FOUND") { setSelected(""); setDetails(null); }
            else setError(message(error));
          }
        }
      }
    } catch (error) {
      if (sequence === loadSequence.current) { setError(message(error));
        if (error instanceof BridgeError && error.detail.code === "CATALOG_CHANGED") { setThemes([]); } }
    } finally { if (sequence === loadSequence.current) setLoading(false); loadingList.current = false; }
  }
  useEffect(() => { if (hello && client) void load(true); }, [hello, client]);
  useEffect(() => {
    let current = true;
    setActiveSkin(null);
    if (client && hello?.capabilities.methods.includes("themes.active") && snapshot && !statusError) {
      void client.call("themes.active", {}).then(value => { if (current) setActiveSkin(value); }).catch(() => {});
    }
    return () => { current = false; };
  }, [client, hello, snapshot?.runtime?.activeRevision, activeRead, !!statusError, !!snapshot]);
  useEffect(() => {
    if (page === "settings" && !selected && themes.length && !loading && !operationBusy && !fileBusy && !importBusy && !updateBusy && !maintenanceBusy && !pendingOperation(operation)) {
      const active = snapshot?.desired.theme;
      const initial = themes.find(theme => theme.ref.source === active?.source && theme.ref.id === active?.id) ?? themes[0];
      if (initial) void choose(initial);
    }
  }, [page, selected, themes, loading, hello, operationBusy, fileBusy, importBusy, updateBusy, maintenanceBusy, operation]);
  useEffect(() => {
    if (!hello || !client || !hello.capabilities.methods.includes("operations.get")) return;
    try { const saved = sessionStorage.getItem(storageKey); if (saved) setOperationId(saved); }
    catch { setOperationError(uiMessage("无法恢复之前的操作记录；请先核对运行状态。")); }
  }, [hello, client]);
  useEffect(() => {
    if (!client || !hello || !operationId) return;
    let active = true, timer: number | undefined;
    const poll = async () => {
      try {
        const value = await client.call("operations.get", { operationId });
        if (!active || !connected.current) return;
        setOperation(previous => previous?.id === value.id && (!pendingOperation(previous) && pendingOperation(value) || previous.updatedAt > value.updatedAt) ? previous : value); setOperationError("");
        if (value.snapshot?.backendSessionId === hello.backendSessionId) setSnapshot(previous => !previous || previous.backendSessionId !== value.snapshot!.backendSessionId || previous.sequence <= value.snapshot!.sequence ? value.snapshot : previous);
        if (pendingOperation(value)) timer = window.setTimeout(() => void poll(), 1500);
      } catch (error) {
        if (!active) return; setOperationError(previous => previous || message(error));
        // Queries may be repeated. A failed query never repeats skin.apply.
        if (!(error instanceof BridgeError && error.detail.code === "OPERATION_UNKNOWN")) timer = window.setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, hello, operationId, operationRead]);
  useEffect(() => {
    if (!client || !hello || !operationId) return;
    return client.onEvent(event => {
      if (event.event !== "operation.changed" || event.operation.id !== operationId) return;
      setOperation(event.operation); setOperationError("");
      const current = event.operation.snapshot;
      if (current?.backendSessionId === hello.backendSessionId) setSnapshot(previous => !previous || previous.sequence <= current.sequence ? current : previous);
    });
  }, [client, hello, operationId]);
  useEffect(() => {
    if (!operation || operation.method !== "skin.apply" || pendingOperation(operation) || typeof libraryNotice === "string" ||
        !["主题已保存，正在准备应用；启动或重启时仍须确认。", "主题已保存，正在刷新当前皮肤。"].includes(libraryNotice.key)) return;
    if (operation.state === "succeeded" && operation.effects.rendererApplied === true) {
      setLibraryNotice(uiMessage("主题已保存，并已核验应用。"));
    } else if (operation.state === "indeterminate") {
      setLibraryNotice(uiMessage("主题已保存。", undefined, {
        after: uiMessage("结果暂不确定，请刷新状态后核对；不会重复执行。", undefined, {
          before: " ", after: operation.error?.message ? ` ${operation.error.message}` : "",
        }),
      }));
    } else {
      setLibraryNotice(uiMessage("主题已保存，后续应用未完成：", undefined, {
        after: operation.error?.message ?? operationFeedback(operation),
      }));
    }
  }, [operation, libraryNotice]);
  async function startApply(theme: ThemeRef, revision: string, refresh?: ApplyRefresh) {
    const context = applicationContext.current, manager = context.client, session = context.hello;
    if (!mounted.current || !manager || !session || !connected.current) throw new UiMessageError(uiMessage("管理器连接已关闭，请重新连接；已接受的操作不会自动重试。"));
    const id = `${session.backendSessionId}:${crypto.randomUUID()}`;
    try {
      // Persist intent before sending. Retrying this screen never creates an implicit second apply.
      sessionStorage.setItem(storageKey, id); setOperationId(null); setOperation(null);
      const value = await manager.call("skin.apply", { operationId: id, theme, expectedRevision: revision, ...(refresh ? { refresh } : {}) });
      setOperation(value);
    } finally { if (mounted.current) setOperationId(id); }
  }
  async function applyImported(result: OperationSnapshot) {
    try { await prepareImportedApply(result); }
    catch (error) {
      if (mounted.current) { setOperationError(uiMessage("主题已保存，后续应用未完成：", undefined, { after: message(error) })); setLibraryNotice(uiMessage("主题已保存，请核对应用结果；不会自动重试。")); }
      throw error;
    }
  }
  async function prepareImportedApply(result: OperationSnapshot) {
    const context = applicationContext.current, manager = context.client, session = context.hello;
    if (!mounted.current || !connected.current || !manager || !session || context.draftDirty || context.updateBusy || context.maintenanceBusy || context.operationBusy || context.fileBusy) throw new UiMessageError(uiMessage("请先处理主题设置草稿或当前操作，再从主题库应用已保存主题。"));
    if (result.method !== "themes.create" || result.state !== "succeeded" || !result.resultTheme || !result.resultRevision || !session.capabilities.methods.includes("skin.apply")) throw new UiMessageError(uiMessage("已保存主题或应用能力尚未确认，未继续应用。"));
    const current = await manager.call("themes.get", { theme: result.resultTheme });
    if (current.revision !== result.resultRevision) throw new UiMessageError(uiMessage("主题版本已变化或不可应用，请刷新主题库核对。"));
    const latest = applicationContext.current;
    if (!mounted.current || !connected.current || latest.client !== manager || latest.hello?.backendSessionId !== session.backendSessionId || latest.draftDirty || latest.updateBusy || latest.maintenanceBusy || latest.operationBusy || latest.fileBusy) throw new UiMessageError(uiMessage("请先处理主题设置草稿或当前操作，再从主题库应用已保存主题。"));
    setOperationBusy(true); setOperationError(""); setLibraryNotice(uiMessage("主题已保存，正在准备应用；启动或重启时仍须确认。"));
    try { await startApply(current.ref, current.revision); }
    catch (error) { if (mounted.current) setOperationError(uiMessage("主题已保存，应用提交未确认：", undefined, { after: message(error) })); throw error; }
    finally { if (mounted.current) setOperationBusy(false); }
  }
  async function apply() {
    if (!details || updateBusy || maintenanceBusy || operationBusy || importBusy || fileBusy || draftDirty || pendingOperation(operation)) return;
    setOperationBusy(true); setOperationError("");
    try { await startApply(details.ref, details.revision); }
    catch (error) { setOperationError(message(error)); }
    finally { setOperationBusy(false); }
  }
  async function saveTheme(patch: ThemePatch, copyName: string | null, applyAfter: boolean) {
    if (!client || !hello || !details || updateBusy || maintenanceBusy || operationBusy || importBusy || fileBusy || pendingOperation(operation)) throw new UiMessageError(uiMessage("请等待当前操作结束。"));
    const source = details, selection = selectionSequence.current, id = `${hello.backendSessionId}:${crypto.randomUUID()}`;
    setOperationBusy(true); setOperationError(""); setLibraryNotice("");
    let saved = false;
    try {
      let refresh: ApplyRefresh | undefined;
      if (copyName === null && !applyAfter) {
        const current = snapshot;
        if (current?.runtime?.activeRevision && current.engine.runtimeSessionId && current.desired.paused === false && current.engine.health === "healthy" &&
            current.desired.theme?.source === source.ref.source && current.desired.theme.id === source.ref.id) {
          const editedParameters = Object.keys(patch.parameters ?? {});
          const opacityOnly = source.mediaKind === "video" && Object.keys(patch).every(key => key === "parameters") && editedParameters.length > 0 &&
            editedParameters.every(key => key === "bubbleOpacity" || key === "surfaceOpacity" || key === "shellOpacity");
          refresh = { activeRevision: current.runtime.activeRevision, runtimeSessionId: current.engine.runtimeSessionId, ...(opacityOnly ? { opacityOnly: true as const } : {}) };
        }
      }
      if (!mounted.current) return;
      sessionStorage.setItem(storageKey, id); setOperationId(null); setOperation(null);
      let value: OperationSnapshot;
      try { value = copyName !== null ? await client.call("themes.copy", { operationId: id, theme: source.ref, expectedRevision: source.revision, patch, name: copyName })
        : await client.call("themes.update", { operationId: id, theme: source.ref, expectedRevision: source.revision, patch }); }
      finally { if (mounted.current) setOperationId(id); }
      setOperation(value);
      const deadline = Date.now() + 180000;
      while (pendingOperation(value)) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 1000));
        if (!mounted.current) return; // Closing the window must not later start an apply.
        if (Date.now() >= deadline) throw new UiMessageError(uiMessage("保存仍在处理，请先查询操作结果；不会自动继续应用。"));
        value = await client.call("operations.get", { operationId: id }); setOperation(value);
      }
      if (!mounted.current) return;
      if (value.state !== "succeeded" || !value.resultTheme || !value.resultRevision) throw new UiMessageError(value.error?.message ?? uiMessage("保存结果待核对，草稿已保留。"));
      saved = true;
      setLibraryNotice(uiMessage(applyAfter ? "主题已保存，正在准备应用；启动或重启时仍须确认。" : "主题已保存到主题库，当前 Codex 外观未切换。"));
      const current = await client.call("themes.get", { theme: value.resultTheme });
      if (!mounted.current || selectionSequence.current !== selection) return;
      if (current.revision !== value.resultRevision) throw new UiMessageError(uiMessage("主题保存后又被修改；请刷新核对，未继续应用。"));
      setSelected(identity(current)); setDetails(current); setDraftDirty(false);
      setThemes(previous => {
        const values = previous.map(theme => identity(theme) === identity(current) ? current : theme);
        return values.some(theme => identity(theme) === identity(current)) ? values : [...values, current];
      });
      if ((applyAfter || refresh) && mounted.current) {
        // The backend validates this refresh binding against the live session.
        await startApply(value.resultTheme, value.resultRevision, applyAfter ? undefined : refresh);
        setLibraryNotice(uiMessage(applyAfter ? "主题已保存，正在准备应用；启动或重启时仍须确认。" : "主题已保存，正在刷新当前皮肤。"));
      }
    } catch (error) {
      const reason = saved ? uiMessage("主题已保存，后续操作未完成：", undefined, { after: message(error) }) : message(error);
      if (mounted.current) setOperationError(reason);
      throw new UiMessageError(reason);
    } finally { if (mounted.current) setOperationBusy(false); }
  }
  async function confirm(accepted: boolean) {
    if (!client || !operation?.confirmation || operationBusy) return;
    setOperationBusy(true); setOperationError("");
    try {
      const value = await client.call("operations.confirm", { operationId: operation.id, confirmationId: operation.confirmation.id, accepted });
      setOperation(value);
    } catch (error) { setOperationError(message(error)); }
    finally { setOperationBusy(false); }
  }
  async function refreshRuntime() {
    if (!client) return;
    setStatusError("");
    try { const current = await client.call("status.get", {}); if (mounted.current && connected.current) { setSnapshot(previous => !previous || previous.backendSessionId !== current.backendSessionId || previous.sequence <= current.sequence ? current : previous); setActiveRead(value => value + 1); } }
    catch (error) { if (mounted.current) { setSnapshot(null); setStatusError(message(error)); } }
  }
  async function controlRuntime(method: RuntimeMethod) {
    if (!client || !hello || method !== "skin.pause" && (!snapshot?.runtime?.revision || draftDirty) || updateBusy || maintenanceBusy || operationBusy || fileBusy || importBusy || pendingOperation(operation)) return;
    // Pause is bound to the live connection by the backend, not a status snapshot.
    const id = `${hello.backendSessionId}:${crypto.randomUUID()}`;
    let expectedRuntimeRevision = snapshot?.runtime?.revision ?? "0".repeat(64), submitted = false;
    setOperationBusy(true); setOperationError("");
    try {
      if (method === "runtime.upgrade") {
        const current = await client.call("status.get", {});
        setSnapshot(previous => !previous || previous.backendSessionId !== current.backendSessionId || previous.sequence <= current.sequence ? current : previous);
        if (!current.runtime?.revision) throw new UiMessageError(uiMessage("运行状态暂不可用，请刷新后重试。"));
        if (!current.runtime.upgradeRequired) { setFeedback(uiMessage("当前未检测到需要升级的皮肤运行时。")); return; }
        if (!current.availability.upgrade?.allowed) throw new UiMessageError(uiMessage("当前无法升级皮肤运行时，请核对运行状态。"));
        expectedRuntimeRevision = current.runtime.revision;
      }
      sessionStorage.setItem(storageKey, id); setOperationId(null); setOperation(null);
      submitted = true;
      setOperation(await client.call(method, { operationId: id, expectedRuntimeRevision }));
    } catch (error) {
      if (submitted && error instanceof BridgeError) { submitted = false; sessionStorage.removeItem(storageKey); }
      if (error instanceof BridgeError && error.detail.code === "RUNTIME_CHANGED") {
        await refreshRuntime();
        if (mounted.current) setOperationError(uiMessage("运行状态已变化，请核对刷新后的状态再操作。"));
      } else if (mounted.current) setOperationError(message(error));
    }
    finally { if (mounted.current) { if (submitted) setOperationId(id); setOperationBusy(false); } }
  }
  async function deleteSelected() {
    if (!client || !hello || !details || updateBusy || maintenanceBusy || operationBusy || importBusy || fileBusy || draftDirty || pendingOperation(operation)) return;
    const id = `${hello.backendSessionId}:${crypto.randomUUID()}`; setOperationBusy(true); setOperationError("");
    try {
      sessionStorage.setItem(storageKey, id); setOperationId(null); setOperation(null);
      setOperation(await client.call("themes.delete", { operationId: id, theme: details.ref, expectedRevision: details.revision }));
    } catch (error) { setOperationError(message(error)); } finally { if (mounted.current) { setOperationId(id); setOperationBusy(false); } }
  }
  async function original(action: "files.saveOriginal" | "files.playOriginal" | "files.exportPackage") {
    if (!client || !details || updateBusy || maintenanceBusy || fileBusy || importBusy || operationBusy || pendingOperation(operation)) return;
    const selectedTheme = details; setFileBusy(true); setLibraryNotice("");
    try {
      if (action === "files.saveOriginal" || action === "files.exportPackage") {
        const result = await client.call(action, { theme: selectedTheme.ref, revision: selectedTheme.revision });
        if (mounted.current) setLibraryNotice(uiMessage(result.saved ? action === "files.exportPackage" ? "主题包已导出。" : "原始素材已保存。" : "已取消保存。"));
      } else {
        const result = await client.call(action, { theme: selectedTheme.ref, revision: selectedTheme.revision });
        if (mounted.current) setLibraryNotice(uiMessage(result.opened ? "已在系统媒体应用中打开原始素材。" : "未能打开原始素材。"));
      }
    } catch (error) { if (mounted.current) setLibraryNotice(message(error)); }
    finally { if (mounted.current) setFileBusy(false); }
  }
  async function choose(theme: ThemeSummary, discard = false) {
    if (!client || operationBusy || fileBusy || importBusy || (selected === identity(theme) && details)) return;
    if (draftDirty && !discard) { setPendingSelection(theme); return; }
    const sequence = ++selectionSequence.current;
    setSelected(identity(theme)); setDetails(null); setLoadingDetails(true); setError("");
    setLibraryNotice("");
    try { const value = await client.call("themes.get", { theme: theme.ref }); if (sequence === selectionSequence.current) setDetails(value); }
    catch (error) { if (sequence === selectionSequence.current) setError(message(error)); }
    finally { if (sequence === selectionSequence.current) setLoadingDetails(false); }
  }
  const busy = operationBusy || fileBusy || importBusy || updateBusy || maintenanceBusy || pendingOperation(operation);
  useEffect(() => {
    if (!hello || !client || busy || loading || loadingList.current || draftDirty || libraryRead <= handledLibraryRead.current) return;
    handledLibraryRead.current = libraryRead; void load(true);
  }, [hello, client, busy, loading, draftDirty, libraryRead]);
  const canApply = !!hello?.capabilities.methods.includes("skin.apply") && !!details;
  const confirmation = operation ? confirmationText(language, operation) : null;
  const detailProps = { client, hello, theme: details, loading: loadingDetails, busy, draftDirty, canApply,
    onApply: () => { void apply(); }, onOriginal: (action: "files.saveOriginal" | "files.playOriginal" | "files.exportPackage") => { void original(action); } };
  useEffect(() => { if (error) setFeedback(error); }, [error]);
  useEffect(() => { if (statusError) setFeedback(statusError); }, [statusError]);
  useEffect(() => { if (libraryNotice) setFeedback(libraryNotice); }, [libraryNotice]);
  useEffect(() => { if (operationError) setFeedback(operationError); }, [operationError]);
  useEffect(() => { if (operation) { const value = operationFeedback(operation); if (value) setFeedback(value); } }, [operation?.id, operation?.state, operation?.error?.message]);
  useEffect(() => {
    if (operation?.state === "succeeded" && ["themes.delete", "library.recover"].includes(operation.method)) setLibraryRead(value => value + 1);
  }, [operation?.id, operation?.state]);
  const openUpdates = () => { setUtility("updates"); if (!busy) setUpdateCheck(value => value + 1); };
  const runtimeLabel = disconnected ? tr("需要重新连接") : !hello ? tr("正在连接本地管理器…") : statusError || !snapshot ? tr("状态暂不可用") : snapshot.desired.paused ? tr("已暂停") : tr(health[snapshot.engine.health]);
  const activeSelection = details && (snapshot?.desired.theme?.source === details.ref.source && snapshot.desired.theme.id === details.ref.id || snapshot?.renderer.theme?.source === details.ref.source && snapshot.renderer.theme.id === details.ref.id);
  return <LanguageContext.Provider value={language}><div className="app"><main>
    <header className="desktop-header">
      <nav className="page-navigation" aria-label={tr("管理器页面")}>{(Object.keys(pages) as Page[]).map(id => <button key={id} aria-current={page === id ? "page" : undefined} aria-controls={`page-${id}`} onClick={() => goPage(id)}>{t(id)}</button>)}</nav>
      <div className="header-actions"><span className={`runtime-indicator ${snapshot?.engine.health === "healthy" && !snapshot.desired.paused && !statusError ? "healthy" : ""}`} title={snapshot ? [runtimeLabel, tr(renderer[snapshot.renderer.status]), ...snapshot.diagnostics.map(item => item.message)].join("\n") : runtimeLabel}><span aria-hidden="true" />{runtimeLabel}</span>
        <button disabled={!hello} onClick={openUpdates}>{tr("检查更新")}{updateAvailable ? " ·" : ""}</button></div>
    </header>
    {pendingSelection && <ConfirmationDialog title={tr("未保存主题设置")} onCancel={() => setPendingSelection(null)}>
      <p>{tr("主题设置有未保存修改，是否丢弃草稿并")}{pendingSelection === "refresh" ? tr("刷新主题库") : tr("切换主题")}？</p><div className="editor-actions">
        <button disabled={busy} onClick={() => setPendingSelection(null)}>{tr("保留草稿")}</button><button disabled={busy} onClick={() => {
          const next = pendingSelection; setPendingSelection(null); setDraftDirty(false);
          if (next === "refresh") void load(true, true); else void choose(next, true);
        }}>{tr("丢弃并继续")}</button></div>
    </ConfirmationDialog>}
    {operation?.state === "awaitingConfirmation" && operation.confirmation && <ConfirmationDialog title={tr("确认所选操作")} onCancel={() => void confirm(false)}>
      <p>{confirmation?.reason ?? operation.confirmation.reason}</p><p>{confirmation?.impact ?? operation.confirmation.impact}</p>
      {operationError && <p className="field-error" role="alert">{msg(operationError)}</p>}
      <div className="editor-actions"><button disabled={!hello || operationBusy} onClick={() => void confirm(false)}>{tr("取消")}</button><button className="confirm-accept" disabled={!hello || operationBusy} onClick={() => void confirm(true)}>{tr(operation.method === "themes.delete" ? "确认删除" : "继续")}</button></div>
    </ConfirmationDialog>}
    <section id="page-import" className="manager-page" aria-labelledby="page-import-title" hidden={page !== "import"}>
      <h2 id="page-import-title" className="visually-hidden" tabIndex={-1}>{tr("导入图片")}</h2>
      {client && hello?.capabilities.methods.includes("themes.create") && <ImportPanel client={client} hello={hello} busy={busy} visible={page === "import"} operation={operation}
        canApply={!draftDirty && hello.capabilities.methods.includes("skin.apply")}
        onApplySaved={applyImported} onBusy={onImportBusy} onOperation={onImportOperation} onIntent={onImportIntent} onSaved={onImported} onNotice={onNotice} />}
    </section>
    <section id="page-console" className="manager-page" aria-labelledby="page-console-title" hidden={page !== "console"}>
      <h2 id="page-console-title" className="visually-hidden" tabIndex={-1}>{tr("控制台")}</h2>
      <div className="content"><ThemeLibrary client={client} platform={hello?.platform} visible={page === "console"} themes={themes} selected={selected} loading={loading} busy={operationBusy || fileBusy || importBusy || !hello}
        onChoose={theme => { void choose(theme); }} commands={<>
          <button disabled={!hello?.capabilities.methods.includes("themes.create") || busy} onClick={() => setQuickImport(value => ({ sequence: value.sequence + 1, packages: false }))}>{tr("添加图片")}</button>
          <button disabled={!hello?.capabilities.methods.includes("themes.importPackage") || busy} onClick={() => setQuickImport(value => ({ sequence: value.sequence + 1, packages: true }))}>{tr("导入主题包")}</button>
          <button disabled={busy || !details || !hello?.capabilities.methods.includes("files.exportPackage")} onClick={() => void original("files.exportPackage")}>{tr("导出主题")}</button>
          {details && (details.ref.source === "saved" || details.ref.source === "preset") && hello?.capabilities.methods.includes("themes.delete") && <button className="danger" title={activeSelection ? tr("当前正在使用该主题，请先应用其他主题后再删除。") : !details.availability.delete?.allowed ? tr("当前主题受保护，暂时不能删除。") : undefined}
            disabled={busy || draftDirty || !!activeSelection || !details.availability.delete?.allowed} onClick={() => void deleteSelected()}>{tr(details.ref.source === "preset" ? "删除内置主题" : "删除主题")}</button>}
        </>} />
        <ThemeDetailsPanel {...detailProps} selectedPreview={themes.find(theme => identity(theme) === selected) ?? null} activeTheme={activeSkin} snapshot={statusError ? null : snapshot} visible={page === "console"} onEdit={() => goPage("settings")}
          onApply={() => { if (details) void apply(); else if (!selected) void controlRuntime("skin.resume"); }} onControl={method => void controlRuntime(method)} onRefresh={() => { void refreshRuntime(); void load(true); }} />
      </div>
    </section>
    <section id="page-settings" className="manager-page settings-page" aria-labelledby="page-settings-title" hidden={page !== "settings"}>
      <h2 id="page-settings-title" className="visually-hidden" tabIndex={-1}>{tr("主题设置")}</h2>
      <div className="settings-layout"><aside className="theme-selector"><h3>{tr("选择主题")}</h3><p className="muted">{tr("选择内置主题或我的主题，调整显示与取景参数。")}</p>
        <label>{tr("主题")}<Select aria-label={tr("主题")} disabled={operationBusy || fileBusy || importBusy || loading} value={selected}
          onChange={value => { const theme = themes.find(item => identity(item) === value); if (theme) void choose(theme); }}
          options={[...(!selected ? [{ value: "", label: tr("选择主题") }] : []), ...themes.map(theme => ({ value: identity(theme),
            label: theme.name + (themes.filter(other => other.name === theme.name).length > 1 ? ` · ${tr(theme.ref.source === "preset" ? "内置" : "我的")} (${theme.ref.id})` : "") }))]} />
        </label><p className="muted">{details ? tr(details.availability.update.allowed ? "可修改此主题的显示参数。" : "当前主题暂时不能编辑。") : ""}</p>
      </aside><div className="settings-editor"><ThemeDetailsPanel {...detailProps} visible={page === "settings"}>
        {details && hello?.capabilities.methods.includes("themes.update") && <ThemeEditor key={`${identity(details)}:${details.revision}:${editorVersion}`} theme={details} busy={busy || !hello} canApply={canApply} allowCopy={hello.platform === "macos"} onDirty={onDirty} onSave={saveTheme} onNotice={onNotice} />}
      </ThemeDetailsPanel></div></div>
    </section>
    <dialog ref={utilityDialog} className="utility-panel" onCancel={() => setUtility(null)} aria-label={tr(utility === "system" ? "系统与信息" : "软件更新")}>
      <div className="utility-content"><button className="utility-close" onClick={() => setUtility(null)}>{tr("关闭")}</button>
        {(utility === "system" || maintenanceBusy) && hello?.platform === "macos" && client && hello.capabilities.methods.includes("desktop.get") && <div hidden={utility !== "system"}><SystemPanel client={client} hello={hello} info={desktopInfo} onInfo={onDesktopInfo}
          disabled={operationBusy || fileBusy || importBusy || updateBusy || draftDirty || pendingOperation(operation)} onBusy={onMaintenanceBusy} onConsole={() => { setUtility(null); goPage("console"); }} /></div>}
        <div hidden={utility !== "updates"}>{client && hello?.capabilities.methods.includes("updates.check") && <UpdatePanel key={hello.backendSessionId} client={client} session={hello.backendSessionId} checkRequest={updateCheck}
          disabled={operationBusy || fileBusy || importBusy || maintenanceBusy || draftDirty || pendingOperation(operation)} onBusy={onUpdateBusy} onAvailable={onUpdateAvailable} />}</div>
      </div>
    </dialog>
    {client && hello?.capabilities.methods.includes("community.inspect") && <CommunityPanel client={client} hello={hello}
      busy={busy} incoming={incomingLinks[0] ?? null} onConsume={consumeLink}
      canApply={!draftDirty && hello.capabilities.methods.includes("community.apply")}
      onBusy={onImportBusy} onOperation={onImportOperation} onIntent={onImportIntent} onSaved={onImported} />}
    <footer className="message-bar" aria-live="polite"><span title={msg(feedback)}>{operation?.state === "awaitingConfirmation" ? "" : msg(feedback) || (hello ? "" : runtimeLabel)}</span>
      {client && hello && <QuickImport client={client} hello={hello} request={quickImport} busy={busy} onBusy={onImportBusy} onOperation={onImportOperation} onIntent={onImportIntent} onSaved={onImported} onNotice={onNotice} />}
      {disconnected && <button onClick={() => { if (!window.confirm(tr("重新连接会丢弃未保存的编辑，是否继续？"))) return; try { reconnectManager(); } catch (error) { setError(message(error)); } }}>{tr("重新连接")}</button>}
      {(operationError || operation?.state === "indeterminate") && operationId && <button disabled={operationBusy} onClick={() => setOperationRead(value => value + 1)}>{tr("核对结果")}</button>}
      {!busy && snapshot?.runtime?.upgradeRequired && snapshot.availability.upgrade?.allowed && <button disabled={draftDirty} onClick={() => void controlRuntime("runtime.upgrade")}>{tr("升级皮肤运行时")}</button>}
    </footer>
  </main></div></LanguageContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<App />);
