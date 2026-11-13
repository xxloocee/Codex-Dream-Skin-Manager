import { applicationNames } from "./ApplicationTarget";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppearanceOperation, AppearanceParameters, AppearanceSnapshot, AppearanceTarget, HelloResult, ThemeDetails, ThemeParameters, ThemeRef } from "../../../contracts/manager.mjs";
import { BridgeError, ManagerClient } from "./client";
import { diagnosticMessage, errorMessage, joinMessages, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { emptyParameters, previewParameters } from "./preview-model";

const identity = (theme: { ref: ThemeRef; revision: string }) => `${theme.ref.source}:${theme.ref.id}:${theme.revision}`;
export const appearanceParametersOnly = (parameters: Partial<ThemeParameters>): Partial<AppearanceParameters> => {
  const result: Partial<AppearanceParameters> = {};
  for (const key of ["appearance", "focusX", "focusY", "positionX", "positionY", "zoom", "positionMode", "framingEnabled", "shellOpacity", "surfaceOpacity", "playbackRate"] as const) {
    if (Object.hasOwn(parameters, key)) Object.assign(result, { [key]: parameters[key] });
  }
  return result;
};

export function useAppearance(target: AppearanceTarget, client: ManagerClient | null, hello: HelloResult | null, details: ThemeDetails | null, onNotice: (value: UiMessage) => void) {
  const storageKey = `dreamskin.manager.${target}.operation`;
  const statusSupported = !!hello?.capabilities.methods.includes(`${target}.status`);
  const supported = !!hello?.capabilities.methods.includes(`${target}.apply`);
  const parametersSupported = !!hello?.capabilities.methods.includes(`${target}.parameters.get`);
  const [snapshot, setSnapshot] = useState<AppearanceSnapshot | null>(null);
  const [statusError, setStatusError] = useState<UiMessage>("");
  const [operation, setOperation] = useState<AppearanceOperation | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<UiMessage>("");
  const [submitting, setSubmitting] = useState(false), [saving, setSaving] = useState(false);
  const [operationRead, setOperationRead] = useState(0), [parametersRead, setParametersRead] = useState(0);
  const [saved, setSaved] = useState<{ key: string; parameters: Partial<AppearanceParameters> } | null>(null);
  const [parametersError, setParametersError] = useState<UiMessage>("");
  const statusEpoch = useRef(0), parameterEpoch = useRef(0), mutating = useRef(false);
  const statusJob = useRef<Promise<void> | null>(null);
  const themeKey = details ? identity(details) : null;
  const currentThemeKey = useRef(themeKey);
  currentThemeKey.current = themeKey;
  const parametersReady = !!themeKey && saved?.key === themeKey;
  const theme = useMemo(() => {
    if (!details || !parametersReady) return null;
    const storedParameters = { ...emptyParameters, ...saved!.parameters, accent: null, safeArea: null, taskMode: "full" as const };
    return { ...details, storedParameters, previewParameters: previewParameters(storedParameters) };
  }, [details, parametersReady, saved]);

  const refresh = useCallback(async () => {
    if (!client || !statusSupported || mutating.current) return;
    if (statusJob.current) return statusJob.current;
    const epoch = ++statusEpoch.current;
    const job = (async () => {
      try {
        const value = await client.call(`${target}.status`, {});
        if (epoch === statusEpoch.current) { setSnapshot(value); setStatusError(""); }
      } catch (error) {
        if (epoch === statusEpoch.current) { setSnapshot(null); setStatusError(errorMessage(error, "状态暂不可用")); }
      }
    })();
    statusJob.current = job;
    try { await job; } finally { if (statusJob.current === job) statusJob.current = null; }
  }, [client, statusSupported, target]);
  useEffect(() => {
    setSnapshot(null); setStatusError("");
    if (!statusSupported) return;
    void refresh();
    const focus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(focus, 5000);
    return () => { statusEpoch.current++; window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refresh, statusSupported]);
  const refreshParameters = useCallback(() => { parameterEpoch.current++; setParametersRead(value => value + 1); }, []);
  useEffect(() => {
    let active = true;
    const epoch = ++parameterEpoch.current;
    setParametersError(""); setSaved(null);
    if (client && parametersSupported && details) {
      void client.call(`${target}.parameters.get`, { theme: details.ref }).then(value => {
        if (active && epoch === parameterEpoch.current) setSaved({ key: identity(details), parameters: value.parameters });
      }).catch(error => { if (active && epoch === parameterEpoch.current) setParametersError(errorMessage(error, "读取参数失败，请重新选择主题。")); });
    }
    return () => { active = false; };
  }, [client, parametersSupported, themeKey, parametersRead, target]);
  useEffect(() => {
    if (!client || !supported) return;
    try { setOperationId(sessionStorage.getItem(storageKey)); }
    catch (error) { setOperationError(errorMessage(error, "无法恢复之前的操作记录；请先核对运行状态。")); }
  }, [client, supported, storageKey]);
  useEffect(() => {
    if (!client || !supported || !operationId) return;
    let active = true, timer: number | undefined;
    const poll = async () => {
      try {
        const value = await client.call(`${target}.operations.get`, { operationId });
        if (!active) return;
        setOperation(value); setOperationError("");
        if (value.state === "running") timer = window.setTimeout(() => void poll(), 1500);
        else { statusEpoch.current++; setSnapshot(value.snapshot); if (value.state !== "indeterminate") sessionStorage.removeItem(storageKey); }
      } catch (error) {
        if (!active) return;
        setOperationError(errorMessage(error, "结果暂不确定，请刷新状态后核对；不会重复执行。"));
        if (error instanceof BridgeError && error.detail.code === "OPERATION_UNKNOWN") { setOperation(null); sessionStorage.removeItem(storageKey); void refresh(); }
        else timer = window.setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, supported, operationId, operationRead, refresh, storageKey, target]);
  useEffect(() => {
    if (operationError) onNotice(operationError);
    else if (operation?.error) onNotice(diagnosticMessage(operation.error));
    else if (operation?.state === "indeterminate") onNotice(uiMessage("结果暂不确定，请刷新状态后核对；不会重复执行。"));
    else if (operation?.state === "succeeded") onNotice(uiMessage(operation.snapshot.renderer === "unknown" || operation.snapshot.renderer === "unavailable" ? "操作已完成，请刷新确认当前外观。" : `${applicationNames[target]} 操作已完成。`));
    else if (operation?.state === "failed") onNotice(uiMessage("操作未完成"));
  }, [operation, operationError, onNotice, target]);

  const run = async (method: AppearanceOperation["method"], selectedTheme?: { ref: ThemeRef; revision: string; storedParameters?: Partial<ThemeParameters> }) => {
    if (!client || !hello?.capabilities.methods.includes(method)) throw new UiMessageError(uiMessage("当前管理器尚不支持此功能。"));
    if (mutating.current || operation?.state === "running") throw new UiMessageError(uiMessage("请等待当前操作结束。"));
    const id = `${hello.backendSessionId}:${crypto.randomUUID()}`;
    statusEpoch.current++; mutating.current = true;
    setSubmitting(true); setOperationError("");
    let submitted = false;
    try {
      sessionStorage.setItem(storageKey, id); setOperation(null); setOperationId(null); submitted = true;
      const value = method === `${target}.apply` && selectedTheme
        ? await client.call(`${target}.apply`, { operationId: id, theme: selectedTheme.ref, expectedRevision: selectedTheme.revision, ...(selectedTheme.storedParameters ? { parameters: appearanceParametersOnly(selectedTheme.storedParameters) } : {}) })
        : method === `${target}.apply` ? null : await client.call(method, { operationId: id });
      if (!value) throw new UiMessageError(uiMessage("选择主题"));
      setOperation(value); setSnapshot(value.snapshot); setStatusError("");
      if (value.state === "succeeded" || value.state === "failed") { submitted = false; sessionStorage.removeItem(storageKey); }
      return value;
    } catch (error) {
      setOperationError(errorMessage(error, "操作未完成"));
      // A backend error can follow an appearance change or failed receipt write.
      // Query this exact identity even for typed errors; never replay it.
      throw error;
    } finally {
      statusEpoch.current++; mutating.current = false;
      if (submitted) setOperationId(id);
      setSubmitting(false);
      if (submitted) {
        const pendingStatus = statusJob.current;
        if (pendingStatus) void pendingStatus.then(() => refresh());
        else void refresh();
      }
    }
  };
  const saveForTheme = async (selectedTheme: { ref: ThemeRef; revision: string }, parameters: Partial<ThemeParameters>) => {
    if (!client || !hello?.capabilities.methods.includes(`${target}.parameters.update`)) throw new UiMessageError(uiMessage("当前管理器尚不支持此功能。"));
    if (mutating.current || operation?.state === "running") throw new UiMessageError(uiMessage("请等待当前操作结束。"));
    const selected = !!details && identity(details) === identity(selectedTheme);
    statusEpoch.current++; mutating.current = true; setSaving(true);
    try {
      const value = await client.call(`${target}.parameters.update`, { theme: selectedTheme.ref, expectedRevision: selectedTheme.revision, parameters: appearanceParametersOnly(parameters) });
      if (selected && currentThemeKey.current === identity(selectedTheme)) { parameterEpoch.current++; setSaved({ key: identity(selectedTheme), parameters: value.parameters }); setParametersError(""); }
      if (value.snapshot) { setSnapshot(value.snapshot); setStatusError(""); }
      onNotice(value.refreshError ? joinMessages([uiMessage(`${applicationNames[target]} 参数已保存，当前显示更新失败。`), diagnosticMessage(value.refreshError)], " ") : uiMessage(`${applicationNames[target]} 参数已保存。`));
    } finally { statusEpoch.current++; mutating.current = false; setSaving(false); }
  };
  return { supported, snapshot, statusError, operation, operationError, parametersError, theme, parametersReady,
    busy: submitting || saving || operation?.state === "running" || !!operationId && !operation && !operationError,
    refresh, refreshParameters, run, saveForTheme, save: async (parameters: Partial<ThemeParameters>) => {
      if (!details) throw new UiMessageError(uiMessage("选择主题"));
      await saveForTheme(details, parameters);
    }, checkResult: () => setOperationRead(value => value + 1) };
}
