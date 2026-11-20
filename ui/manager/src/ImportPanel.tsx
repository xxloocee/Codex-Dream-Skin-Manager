import { useText } from "./desktop";
import { diagnosticMessage, errorMessage, joinMessages, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HelloResult, OperationSnapshot, SourceGrant, ThemeCreateRequest, ThemeDetails, ThemeParameters, ThemePatch, ThemeRef } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { ThemeEditor } from "./ThemeEditor";
import { MediaPreview } from "./MediaPreview";
import { emptyParameters, importParameters, previewParameters } from "./preview-model";
import { importRefused, rememberImport, sourceName, trackImport } from "./import-operations";
import type { ApplicationTarget } from "./ApplicationTarget";
import { ImageIcon, UploadIcon } from "./Icons";

export function ImportPanel({
  client,
  hello,
  busy,
  visible,
  canApply,
  operation,
  application,
  onSaveParameters,
  onSavedTheme,
  onDraftDirty,
  onBusy,
  onOperation,
  onIntent,
  onSaved,
  onNotice,
}: {
  client: ManagerClient;
  hello: HelloResult;
  busy: boolean;
  visible: boolean;
  canApply: boolean;
  operation: OperationSnapshot | null;
  application: ApplicationTarget;
  onSaveParameters(theme: { ref: ThemeRef; revision: string }, parameters: ThemeParameters): Promise<void>;
  onSavedTheme(result: OperationSnapshot, application: ApplicationTarget, parameters: ThemeParameters, applyAfter: boolean): Promise<void>;
  onDraftDirty(value: boolean): void;
  onBusy(value: boolean): void;
  onOperation(value: OperationSnapshot): void;
  onIntent(id: string): void;
  onSaved(): void;
  onNotice(value: UiMessage): void;
}) {
  const tr = useText();
  const [source, setSource] = useState<SourceGrant | null>(null), [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false), [draft, setDraft] = useState<ThemeParameters | null>(null);
  const [submitted, setSubmitted] = useState(false), [parametersPending, setParametersPending] = useState(false);
  const alive = useRef(true), working = useRef(false), attempted = useRef(false), sourceRef = useRef(source);
  sourceRef.current = source;
  const submission = useRef<{ id: string; source: SourceGrant; application: ApplicationTarget; params: ThemeCreateRequest;
    parameters: ThemeParameters; saveParameters: typeof onSaveParameters; created?: OperationSnapshot } | null>(null);
  const onDirty = useCallback((value: boolean) => setDirty(value), []), onPreview = useCallback((value: ThemeParameters | null) => setDraft(value), []);

  useEffect(() => { onDraftDirty(!!source && (dirty || parametersPending)); return () => onDraftDirty(false); }, [source, dirty, parametersPending, onDraftDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [client]);
  useEffect(() => {
    resetDraft();
  }, [application]);
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
      if (current.application === application && sourceRef.current?.handle === current.source.handle) {
        setDirty(false); setSource(null);
        void client.call("sources.release", { handles: [current.source.handle] }).catch(() => {});
      }
    }
    return true;
  }

  const initialParameters = application !== "codex" ? emptyParameters : importParameters;
  const theme = useMemo<ThemeDetails>(() => ({
    ref: { source: "saved", id: "draft" },
    name: source ? sourceName(source) : "",
    storageCategory: "custom",
    displayCategories: ["art"],
    tags: [],
    mediaKind: source?.extension === ".mp4" ? "video" : source && [".gif", ".apng"].includes(source.extension) ? "animatedImage" : "image",
    catalogOrder: 0,
    addedAt: null,
    modifiedAt: null,
    revision: source?.handle ?? "empty",
    storedParameters: initialParameters,
    previewParameters: previewParameters(initialParameters),
    media: { mimeType: "image/png", byteLength: source?.byteLength ?? 0, width: null, height: null },
    warnings: [],
    availability: {
      update: { allowed: true, reasonCode: null },
      apply: { allowed: false, reasonCode: "NOT_SAVED" },
      copy: { allowed: false, reasonCode: "NOT_SAVED" },
    },
  }), [source, initialParameters]);

  function resetDraft() {
    setDirty(false);
    setDraft(null);
    setParametersPending(false);
    if (submission.current?.created) {
      submission.current = null;
      attempted.current = false;
      setSubmitted(false);
    }
  }

  async function choose() {
    if (busy || working.current) return;
    working.current = true; setRunning(true); onBusy(true);
    try {
      const selection = await client.call("files.select", { multiple: false });
      if (!alive.current || selection.cancelled) return;
      const next = selection.sources[0];
      if (next) {
        const old = sourceRef.current;
        submission.current = null;
        setSource(next);
        attempted.current = false;
        setSubmitted(false);
        setParametersPending(false);
        setDirty(false);
        if (old) void client.call("sources.release", { handles: [old.handle] }).catch(() => {});
      }
      if (selection.failures.length) {
        onNotice(joinMessages(selection.failures.map(value => uiMessage("{name}：{detail}", { name: value.name, detail: diagnosticMessage(value.error) })), "；"));
      }
    } catch (error) {
      if (alive.current) onNotice(errorMessage(error, "素材操作未完成。"));
    } finally {
      working.current = false;
      if (alive.current) { setRunning(false); onBusy(false); }
    }
  }

  async function save(patch: ThemePatch, _copy: string | null, applyAfter: boolean) {
    if (!source || busy || working.current || attempted.current) throw new UiMessageError(uiMessage("请等待当前处理结束，或核对已提交的素材。"));
    if (applyAfter && !canApply) throw new UiMessageError(uiMessage("当前管理器尚不支持此功能。"));
    working.current = true; setRunning(true); onBusy(true);
    const targetApplication = application;
    try {
      const name = patch.name ?? sourceName(source), next = { ...patch, parameters: { ...initialParameters, ...patch.parameters } };
      delete next.name;
      const targetParameters = next.parameters;
      if (targetApplication !== "codex") next.parameters = { ...importParameters };
      let result = submission.current?.created;
      if (!result) {
        const id = rememberImport(hello.backendSessionId, name);
        attempted.current = true; setSubmitted(true);
        const params: ThemeCreateRequest = { operationId: id, handle: source.handle, name, patch: next };
        submission.current = { id, source, application: targetApplication, params, parameters: targetParameters, saveParameters: onSaveParameters };
        if (targetApplication !== "codex") setParametersPending(true);
        let initial: OperationSnapshot;
        try { initial = await client.call("themes.create", params); }
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
      } else if (targetApplication === "codex") {
        onNotice(uiMessage(result.disposition === "duplicate" ? "素材与渲染参数已存在，返回已有主题。" : "主题已保存。"));
      }
    } finally {
      working.current = false;
      if (alive.current) { setRunning(false); onBusy(false); }
    }
  }

  async function retrySave() {
    const current = submission.current;
    if (!current || busy || working.current) return;
    working.current = true; setRunning(true); onBusy(true);
    try {
      let result = current.created;
      if (!result) {
        let initial: OperationSnapshot;
        try { initial = await client.call("themes.create", current.params); }
        catch (error) {
          if (importRefused(error)) { submission.current = null; attempted.current = false; setSubmitted(false); setParametersPending(false); }
          throw error;
        } finally { if (alive.current) onIntent(current.id); }
        result = await trackImport(client, initial, () => alive.current, onOperation);
        settle(result);
        if (result.state !== "succeeded") throw new UiMessageError(result.error ? diagnosticMessage(result.error) : uiMessage("导入结果尚未确认。"));
      }
      if (current.application !== "codex") {
        if (!result.resultTheme || !result.resultRevision) throw new UiMessageError(uiMessage("已保存主题或应用能力尚未确认，未继续应用。"));
        await current.saveParameters({ ref: result.resultTheme, revision: result.resultRevision }, current.parameters);
        settle(result, true);
      }
      onNotice(uiMessage(result.disposition === "duplicate" ? "素材与渲染参数已存在，返回已有主题。" : "主题已保存。"));
    } catch (error) { if (alive.current) onNotice(errorMessage(error, "保存未完成，草稿已保留。")); }
    finally {
      working.current = false;
      if (alive.current) { setRunning(false); onBusy(false); }
    }
  }

  return (
    <section className="media-import modern-import-workspace" aria-label={tr("素材导入")}>
      {submission.current && !running && <button type="button" disabled={busy} onClick={() => void retrySave()}>{tr("重试上次保存")}</button>}
      <ThemeEditor
        key={`${application}:${source?.handle ?? "empty"}`}
        mode="create"
        application={application}
        theme={theme}
        busy={busy || running}
        canApply={canApply}
        readyToSave={!!source && !submitted && (!submission.current?.created || submission.current.application === application)}
        sourcePicker={
          <div className="source-picker modern-source-picker">
            <label>
              <span>{tr("背景图片或视频")}</span>
              <input readOnly value={source?.name ?? ""} placeholder={tr("点击右侧按钮选择文件…")} />
            </label>
            <button type="button" className="btn-browse" disabled={busy || running} onClick={() => void choose()}>
              <UploadIcon className="btn-icon-sm" />
              <span>{tr("选择文件")}</span>
            </button>
          </div>
        }
        preview={
          source ? (
            <div className="import-canvas-container">
              <MediaPreview
                client={client}
                target={{ kind: "source", handle: source.handle }}
                name={source.name}
                application={application}
                parameters={draft ?? theme.previewParameters}
                mediaKind={theme.mediaKind}
                visible={visible}
              />
              <div className="canvas-badge-overlay">
                <span className="canvas-badge-dot" />
                <span>{tr("实时预览")}：{source.name}</span>
              </div>
              <button
                type="button"
                className="canvas-reselect-btn"
                disabled={busy || running}
                onClick={() => void choose()}
              >
                <UploadIcon className="btn-icon-xs" />
                <span>{tr("选择文件")}</span>
              </button>
            </div>
          ) : (
            <div
              className="import-empty-dropzone"
              onClick={() => void choose()}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void choose(); } }}
            >
              <div className="dropzone-icon-ring">
                <ImageIcon className="dropzone-svg" />
              </div>
              <h4>{tr("点击选择背景图片或视频")}</h4>
              <p className="dropzone-hint">{tr("支持 PNG, JPG, WebP, GIF, MP4 等格式，画质越高清体验越佳")}</p>
              <button
                type="button"
                className="primary btn-select-file"
                disabled={busy || running}
                onClick={e => { e.stopPropagation(); void choose(); }}
              >
                <UploadIcon className="btn-icon-sm" />
                <span>{tr("浏览本地素材文件")}</span>
              </button>
            </div>
          )
        }
        onDirty={onDirty}
        onReset={resetDraft}
        onPreview={onPreview}
        onSave={save}
        onNotice={onNotice}
      />
    </section>
  );
}
