import { useText } from "./desktop";
import { diagnosticMessage, errorMessage, joinMessages, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HelloResult, OperationSnapshot, SourceGrant, ThemeDetails, ThemeParameters, ThemePatch, ThemeRef } from "../../../contracts/manager.mjs";
import { ManagerClient } from "./client";
import { ThemeEditor } from "./ThemeEditor";
import { MediaPreview } from "./MediaPreview";
import { emptyParameters, importParameters, previewParameters } from "./preview-model";
import { importRefused, rememberImport, sourceName, trackImport } from "./import-operations";
import { ConfirmationDialog } from "./ConfirmationDialog";
import type { ApplicationTarget } from "./ApplicationTarget";

export function ImportPanel({ client, hello, busy, visible, canApply, operation, application, onSaveParameters, onSavedTheme, onDraftDirty, onBusy, onOperation, onIntent, onSaved, onNotice }: {
  client: ManagerClient; hello: HelloResult; busy: boolean; visible: boolean; canApply: boolean;
  operation: OperationSnapshot | null;
  application: ApplicationTarget;
  onSaveParameters(theme: { ref: ThemeRef; revision: string }, parameters: ThemeParameters): Promise<void>;
  onSavedTheme(result: OperationSnapshot, application: ApplicationTarget, parameters: ThemeParameters, applyAfter: boolean): Promise<void>; onDraftDirty(value: boolean): void; onBusy(value: boolean): void;
  onOperation(value: OperationSnapshot): void; onIntent(id: string): void; onSaved(): void; onNotice(value: UiMessage): void;
}) {
  const tr = useText();
  const [source, setSource] = useState<SourceGrant | null>(null), [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false), [draft, setDraft] = useState<ThemeParameters | null>(null), [confirmation, setConfirmation] = useState(false);
  const [submitted, setSubmitted] = useState(false), [parametersPending, setParametersPending] = useState(false);
  const alive = useRef(true), working = useRef(false), attempted = useRef(false), sourceRef = useRef(source); sourceRef.current = source;
  const submission = useRef<{ id: string; source: SourceGrant; application: ApplicationTarget; created?: OperationSnapshot } | null>(null);
  const onDirty = useCallback((value: boolean) => setDirty(value), []), onPreview = useCallback((value: ThemeParameters | null) => setDraft(value), []);
  useEffect(() => { onDraftDirty(dirty || parametersPending); return () => onDraftDirty(false); }, [dirty, parametersPending, onDraftDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [client]);
  useEffect(() => {
    if (!running && operation && settle(operation) && operation.state === "succeeded") {
      onNotice(uiMessage(operation.disposition === "duplicate" ? "素材与渲染参数已存在，返回已有主题。" : "主题已保存。"));
    }
  }, [operation, running]);
  function settle(value: OperationSnapshot, parametersSaved = false) {
    const current = submission.current;
    if (!current || current.id !== value.id || !["succeeded", "failed", "cancelled"].includes(value.state)) return false;
    attempted.current = false; setSubmitted(false);
    if (value.state === "succeeded" && current.application !== "codex" && !parametersSaved) {
      if (!current.created) { current.created = value; onSaved(); }
      setParametersPending(true);
      return false;
    }
    submission.current = null; setParametersPending(false);
    if (value.state === "succeeded") {
      if (!current.created) onSaved();
      setDirty(false); setSource(null);
      void client.call("sources.release", { handles: [current.source.handle] }).catch(() => {});
    }
    return true;
  }
  const initialParameters = application !== "codex" ? emptyParameters : importParameters;
  const theme = useMemo<ThemeDetails>(() => ({ ref: { source: "saved", id: "draft" }, name: source ? sourceName(source) : "",
    storageCategory: "custom", displayCategories: ["art"], tags: [], mediaKind: source?.extension === ".mp4" ? "video" : source && [".gif", ".apng"].includes(source.extension) ? "animatedImage" : "image",
    catalogOrder: 0, addedAt: null, modifiedAt: null, revision: source?.handle ?? "empty", storedParameters: initialParameters, previewParameters: previewParameters(initialParameters),
    media: { mimeType: "image/png", byteLength: source?.byteLength ?? 0, width: null, height: null }, warnings: [],
    availability: { update: { allowed: true, reasonCode: null }, apply: { allowed: false, reasonCode: "NOT_SAVED" }, copy: { allowed: false, reasonCode: "NOT_SAVED" } } }), [source, initialParameters]);
  async function choose(discard = false) {
    if (busy || working.current) return;
    if ((dirty || parametersPending) && !discard) { setConfirmation(true); return; }
    working.current = true; setRunning(true); onBusy(true);
    try {
      const selection = await client.call("files.select", { multiple: false });
      if (!alive.current || selection.cancelled) return;
      const next = selection.sources[0];
      if (next) {
        const old = sourceRef.current; submission.current = null; setSource(next); attempted.current = false; setSubmitted(false); setParametersPending(false); setDirty(false);
        if (old) void client.call("sources.release", { handles: [old.handle] }).catch(() => {});
      }
      if (selection.failures.length) onNotice(joinMessages(selection.failures.map(value => uiMessage("{name}：{detail}", { name: value.name, detail: diagnosticMessage(value.error) })), "；"));
    } catch (error) { if (alive.current) onNotice(errorMessage(error, "素材操作未完成。")); }
    finally { working.current = false; if (alive.current) { setRunning(false); onBusy(false); } }
  }
  async function save(patch: ThemePatch, _copy: string | null, applyAfter: boolean) {
    if (!source || busy || working.current || attempted.current) throw new UiMessageError(uiMessage("请等待当前处理结束，或核对已提交的素材。"));
    if (applyAfter && !canApply) throw new UiMessageError(uiMessage("请先处理主题设置草稿并刷新运行状态，再保存并应用。"));
    working.current = true; setRunning(true); onBusy(true);
    const targetApplication = application;
    try {
      const name = patch.name ?? sourceName(source), next = { ...patch, parameters: { ...initialParameters, ...patch.parameters } }; delete next.name;
      const targetParameters = next.parameters;
      if (targetApplication !== "codex") next.parameters = { ...importParameters };
      let result = submission.current?.created;
      if (!result) {
        const id = rememberImport(hello.backendSessionId, name); attempted.current = true; setSubmitted(true);
        submission.current = { id, source, application: targetApplication };
        if (targetApplication !== "codex") setParametersPending(true);
        let initial: OperationSnapshot;
        try { initial = await client.call("themes.create", { operationId: id, handle: source.handle, name, patch: next }); }
        catch (error) { if (importRefused(error)) { submission.current = null; attempted.current = false; setSubmitted(false); setParametersPending(false); } throw error; }
        finally { if (alive.current) onIntent(id); }
        result = await trackImport(client, initial, () => alive.current, onOperation);
        settle(result);
        if (result.state !== "succeeded") {
          throw new UiMessageError(result.error ? diagnosticMessage(result.error) : uiMessage("导入结果尚未确认。"));
        }
      }
      if (targetApplication !== "codex") {
        if (!result.resultTheme || !result.resultRevision) throw new UiMessageError(uiMessage("已保存主题或应用能力尚未确认，未继续应用。"));
        await onSaveParameters({ ref: result.resultTheme, revision: result.resultRevision }, targetParameters);
        settle(result, true);
      }
      if (applyAfter) {
        try { await onSavedTheme(result, targetApplication, targetParameters, applyAfter); }
        catch (error) { if (alive.current) onNotice(uiMessage("主题已保存，应用未能继续：", undefined, { after: errorMessage(error, "请刷新状态后再操作。") })); }
      } else if (targetApplication === "codex") onNotice(uiMessage(result.disposition === "duplicate" ? "素材与渲染参数已存在，返回已有主题。" : "主题已保存。"));
    } finally { working.current = false; if (alive.current) { setRunning(false); onBusy(false); } }
  }
  return <section className="media-import" aria-label={tr("素材导入")}>
    {confirmation && <ConfirmationDialog title={tr("丢弃草稿")} onCancel={() => setConfirmation(false)}><p>{tr("当前素材有未保存修改，是否丢弃草稿并继续？")}</p><div className="editor-actions">
      <button onClick={() => setConfirmation(false)}>{tr("保留草稿")}</button><button onClick={() => { setConfirmation(false); void choose(true); }}>{tr("丢弃并继续")}</button>
    </div></ConfirmationDialog>}
    <ThemeEditor key={`${application}:${source?.handle ?? "empty"}`} mode="create" application={application} theme={theme} busy={busy || running} canApply={canApply} readyToSave={!!source && !submitted}
      sourcePicker={<div className="source-picker"><label>{tr("背景图片或视频")}<input readOnly value={source?.name ?? ""} placeholder={tr("选择图片／视频")} /></label><button type="button" disabled={busy || running} onClick={() => void choose()}>{tr("选择文件")}</button></div>}
      preview={source ? <MediaPreview client={client} target={{ kind: "source", handle: source.handle }} name={source.name} application={application} parameters={draft ?? theme.previewParameters} mediaKind={theme.mediaKind} visible={visible} /> : <div className="import-empty-preview"><div className="empty-sidebar"><span /><span /><span /></div><div className="empty-composer" /></div>}
      onDirty={onDirty} onPreview={onPreview} onSave={save} onNotice={onNotice} />
  </section>;
}
