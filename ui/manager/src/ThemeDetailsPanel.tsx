import { useMessage, useText } from "./desktop";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { HelloResult, ManagerSnapshot, RuntimeMethod, ThemeDetails, ThemeParameters, ThemeSummary } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { previewParameters } from "./preview-model";
import { errorMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { StartupAnimationControls } from "./StartupAnimationControls";
import { applicationNames, type ApplicationTarget } from "./ApplicationTarget";
import {
  SparklesIcon,
  CheckIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  RotateCcwIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  DropletsIcon,
  SunIcon,
  WrenchIcon,
} from "./Icons";

export interface TargetSkinControls {
  application: ApplicationTarget;
  activeTheme: ThemeSummary | null;
  activeParameters?: ThemeParameters | null | undefined;
  currentName: string;
  paused: boolean;
  applied: boolean;
  allowed(action: "pause" | "resume" | "reset" | "restore"): boolean;
  onControl(action: "pause" | "resume" | "reset" | "restore"): void;
  notice?: ReactNode | undefined;
}

export function ThemeDetailsPanel({
  client,
  hello,
  theme,
  selectedPreview = null,
  activeTheme = null,
  snapshot,
  loading,
  visible,
  busy,
  canApply,
  onApply,
  onOriginal,
  onEdit,
  onControl,
  onRefresh,
  onQuickSave,
  children,
  targetControls,
  onStartupBusy,
}: {
  client: ManagerClient | null;
  hello: HelloResult | null;
  theme: ThemeDetails | null;
  loading: boolean;
  visible: boolean;
  busy: boolean;
  draftDirty: boolean;
  canApply: boolean;
  onApply(): void;
  onOriginal(action: "files.saveOriginal" | "files.playOriginal" | "files.exportPackage"): void;
  onEdit?: (() => void) | undefined;
  children?: ReactNode | undefined;
  selectedPreview?: ThemeSummary | null | undefined;
  activeTheme?: ThemeDetails | null | undefined;
  snapshot?: ManagerSnapshot | null | undefined;
  onControl?: ((method: RuntimeMethod) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onQuickSave?: ((parameters: Partial<ThemeParameters>) => Promise<void>) | undefined;
  targetControls?: TargetSkinControls | undefined;
  onStartupBusy?: ((value: boolean) => void) | undefined;
}) {
  const tr = useText(), msg = useMessage();
  const [mediaMenu, setMediaMenu] = useState(false);
  const [startupRead, setStartupRead] = useState(0);
  const [quickPatch, setQuickPatch] = useState<Partial<ThemeParameters>>({});
  const [quickError, setQuickError] = useState<UiMessage>("");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const themeIdentity = theme ? `${theme.ref.source}:${theme.ref.id}:${theme.revision}` : "";
  useEffect(() => {
    setQuickPatch({});
    setQuickError("");
  }, [themeIdentity, targetControls?.application]);

  const application = targetControls?.application ?? "codex";
  const selectedTheme = theme ?? selectedPreview;
  const currentTheme = targetControls?.activeTheme ?? activeTheme;
  const shown = selectedTheme ?? currentTheme;
  const paused = targetControls?.paused ?? snapshot?.desired.paused;
  const control = (action: "pause" | "resume" | "reset" | "restore") =>
    targetControls ? targetControls.onControl(action) : onControl?.(`skin.${action}`);
  const runtimeAllowed = (action: "pause" | "resume" | "reset" | "restore") =>
    !busy && (targetControls
      ? targetControls.allowed(action)
      : !!hello?.capabilities.methods.includes(`skin.${action}`) &&
        (action !== "restore" || (!!snapshot?.runtime?.revision && !!snapshot.availability.restore?.allowed)));

  const canPlayOriginal =
    hello?.platform === "macos" &&
    !!theme &&
    theme.mediaKind !== "image" &&
    !!hello.capabilities.methods.includes("files.playOriginal");

  const canRepair =
    application === "codex" &&
    !!hello?.capabilities.methods.includes("runtime.repair") &&
    !!snapshot?.availability.repair?.allowed &&
    snapshot.engine.health !== "healthy";

  const canQuickEdit =
    !!theme &&
    !!onQuickSave &&
    (application !== "codex"
      ? !!hello?.capabilities.methods.includes(`${application}.parameters.update`)
      : !!hello?.capabilities.methods.includes("themes.update") && theme.availability.update.allowed);

  const quickDirty = Object.keys(quickPatch).length > 0;
  const effectivePreview = theme
    ? previewParameters(theme.storedParameters, quickPatch, systemDark)
    : application !== "codex"
    ? selectedTheme ? null : targetControls?.activeParameters ?? null
    : selectedTheme ? null : activeTheme ? previewParameters(activeTheme.storedParameters, {}, systemDark) : null;

  const rendererApplied = targetControls ? targetControls.applied : snapshot?.engine.health === "healthy" &&
    snapshot.desired.paused === false && snapshot.renderer.status === "applied" &&
    !!snapshot.engine.runtimeSessionId && snapshot.renderer.runtimeSessionId === snapshot.engine.runtimeSessionId;
  const appliedRef = rendererApplied ? targetControls ? targetControls.activeTheme?.ref : snapshot?.renderer.theme : null;
  const isApplied = !!(appliedRef && shown && appliedRef.source === shown.ref.source && appliedRef.id === shown.ref.id);
  const currentName = targetControls?.currentName ?? (appliedRef
    ? activeTheme?.ref.source === appliedRef.source && activeTheme.ref.id === appliedRef.id ? activeTheme.name : appliedRef.id
    : tr(paused ? "已暂停" : !snapshot ? "状态暂不可用" : snapshot.engine.health === "healthy" ? "尚未核验" : snapshot.engine.health === "stopped" ? "未运行" : "需要重新连接"));

  function setQuickValue(key: "shellOpacity" | "surfaceOpacity" | "bubbleOpacity", value: number | null) {
    setQuickError("");
    setQuickPatch(prev => {
      const next = { ...prev };
      if (value === null && theme?.storedParameters[key] == null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  async function commitQuickSave() {
    if (!onQuickSave || !quickDirty || busy) return;
    setQuickError("");
    try {
      await onQuickSave(quickPatch);
      setQuickPatch({});
    } catch (error) {
      setQuickError(errorMessage(error, "保存未完成，草稿已保留。"));
    }
  }

  if (onEdit) {
    const shellVal = Math.round(((effectivePreview?.shellOpacity ?? 0.25)) * 100);
    const surfaceVal = Math.round(((effectivePreview?.surfaceOpacity ?? 0.3)) * 100);
    const bubbleVal = Math.round(((effectivePreview?.bubbleOpacity ?? 0)) * 100);

    return (
      <aside
        className="inspector modern-inspector-panel dashboard-inspector"
        aria-label={tr("当前皮肤控制")}
        tabIndex={canPlayOriginal ? 0 : undefined}
        onKeyDown={event => {
          if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && canPlayOriginal) {
            event.preventDefault();
            setMediaMenu(true);
          }
        }}
        onContextMenu={event => {
          if (canPlayOriginal) {
            event.preventDefault();
            setMediaMenu(true);
          }
        }}
      >
        <div className="inspector-viewport-wrapper">
          {shown && client ? (
            <div className="inspector-viewport-inner">
              <MediaPreview
                key={`${selectedTheme ? "library" : "active"}:${shown.revision}`}
                client={client}
                target={
                  selectedTheme || application !== "codex"
                    ? { kind: "theme", theme: shown.ref, revision: shown.revision, variant: "preview" }
                    : { kind: "active", revision: shown.revision }
                }
                name={shown.name}
                parameters={effectivePreview}
                application={application}
                mediaKind={shown.mediaKind}
                visible={visible}
              />
              <div className="terminal-header-overlay" aria-hidden="true">
                <div className="terminal-dots">
                  <span className="dot" />
                  <span className="dot" />
                </div>
                <span className="terminal-agent-label">
                  {applicationNames[application]}
                  {theme?.media.width && theme.media.height ? ` · ${theme.media.width}×${theme.media.height}` : ""}
                </span>
              </div>
            </div>
          ) : (
            <div className="preview placeholder">{loading ? tr("正在读取详情…") : tr("尚无可预览的当前皮肤")}</div>
          )}
        </div>

        <div className="inspector-content">
          <div className="inspector-title-row">
            <h2 className="inspector-theme-name" title={shown?.name}>{shown?.name ?? tr("尚未选择主题")}</h2>
            <span className="inspector-runtime-status" title={currentName}>
              {applicationNames[application]}: {currentName}
            </span>
          </div>

          <button
            type="button"
            className={`primary inspector-btn-apply ${isApplied && !quickDirty ? "applied-state" : ""}`}
            disabled={busy || loading || (selectedTheme ? !theme || !canApply : !runtimeAllowed("resume"))}
            onClick={onApply}
          >
            {isApplied && selectedTheme ? (
              <>
                <CheckIcon className="btn-icon" />
                <span>{tr(`已应用到 ${applicationNames[application]}`)}</span>
              </>
            ) : (
              <>
                <SparklesIcon className="btn-icon" />
                <span>{tr(selectedTheme ? `应用到 ${applicationNames[application]}` : "继续当前皮肤")}</span>
              </>
            )}
          </button>

          {theme && (
            <div className="inspector-quick-sliders">
              <label className="quick-slider-row" title={tr("背景遮罩不透明度")}>
                <EyeIcon className="slider-icon" />
                <span className="slider-title-inline">{tr("遮罩深度")}</span>
                <input
                  type="range"
                  aria-label={tr("背景遮罩不透明度")}
                  min={0}
                  max={100}
                  step={1}
                  value={shellVal}
                  disabled={busy || !canQuickEdit}
                  onChange={e => setQuickValue("shellOpacity", Number(e.target.value) / 100)}
                />
                <output className="slider-val-inline">{shellVal}%</output>
              </label>

              <label className="quick-slider-row" title={tr("面板不透明度（输入框、工具面板等）")}>
                <DropletsIcon className="slider-icon" />
                <span className="slider-title-inline">{tr("面板透光")}</span>
                <input
                  type="range"
                  aria-label={tr("面板不透明度（输入框、工具面板等）")}
                  min={0}
                  max={100}
                  step={1}
                  value={surfaceVal}
                  disabled={busy || !canQuickEdit}
                  onChange={e => setQuickValue("surfaceOpacity", Number(e.target.value) / 100)}
                />
                <output className="slider-val-inline">{surfaceVal}%</output>
              </label>

              {application === "codex" && (
                <label className="quick-slider-row" title={tr("消息气泡不透明度（用户与助手）")}>
                  <SunIcon className="slider-icon" />
                  <span className="slider-title-inline">{tr("气泡透光")}</span>
                  <input
                    type="range"
                    aria-label={tr("消息气泡不透明度（用户与助手）")}
                    min={0}
                    max={100}
                    step={1}
                    value={bubbleVal}
                    disabled={busy || !canQuickEdit}
                    onChange={e => setQuickValue("bubbleOpacity", Number(e.target.value) / 100)}
                  />
                  <output className="slider-val-inline">{bubbleVal}%</output>
                </label>
              )}

              {quickDirty && (
                <div className="quick-slider-actions">
                  <button
                    type="button"
                    className="btn-tiny ghost"
                    disabled={busy}
                    onClick={() => { setQuickPatch({}); setQuickError(""); }}
                  >
                    {tr("还原")}
                  </button>
                  {(Object.hasOwn(quickPatch, "shellOpacity") || theme.storedParameters.shellOpacity != null) && (
                    <button
                      type="button"
                      className="btn-tiny"
                      disabled={busy}
                      title={tr("清除自定义背景遮罩，恢复默认不透明度 25%。")}
                      onClick={() => setQuickValue("shellOpacity", null)}
                    >
                      {tr("默认 25%")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary btn-tiny-primary"
                    disabled={busy}
                    onClick={() => void commitQuickSave()}
                  >
                    {tr("保存微调")}
                  </button>
                </div>
              )}
            </div>
          )}

          {quickError && <p className="field-error" role="alert">{msg(quickError)}</p>}

          <div className={`inspector-controls-grid ${canRepair ? "cols-4" : "cols-3"}`}>
            <button
              type="button"
              className="inspector-action-btn"
              disabled={!runtimeAllowed(paused ? "resume" : "pause")}
              onClick={() => control(paused ? "resume" : "pause")}
            >
              {paused ? <PlayIcon className="btn-icon-sm" /> : <PauseIcon className="btn-icon-sm" />}
              <span>{tr(paused ? "继续" : "暂停")}</span>
            </button>

            <button
              type="button"
              className="inspector-action-btn"
              disabled={busy || !hello}
              onClick={() => {
                setStartupRead(value => value + 1);
                onRefresh?.();
              }}
            >
              <RefreshIcon className="btn-icon-sm" />
              <span>{tr("刷新")}</span>
            </button>

            <button
              type="button"
              className="inspector-action-btn"
              disabled={!runtimeAllowed("reset")}
              onClick={() => control("reset")}
            >
              <RotateCcwIcon className="btn-icon-sm" />
              <span>{tr("重置")}</span>
            </button>

            {canRepair && (
              <button
                type="button"
                className="inspector-action-btn"
                disabled={busy}
                onClick={() => onControl?.("runtime.repair")}
                title={tr("修复皮肤连接")}
              >
                <WrenchIcon className="btn-icon-sm" />
                <span>{tr("修复连接")}</span>
              </button>
            )}
          </div>

          <div className={`inspector-subtools-row ${canPlayOriginal ? "cols-3" : ""}`}>
            <button
              type="button"
              className="subtool-btn highlight"
              disabled={busy || !theme}
              onClick={onEdit}
            >
              <EditIcon className="btn-icon-sm" />
              <span>{tr("编辑详细参数")}</span>
            </button>

            <button
              type="button"
              className="subtool-btn"
              disabled={busy || !theme || !hello?.capabilities.methods.includes("files.saveOriginal")}
              onClick={() => onOriginal("files.saveOriginal")}
            >
              <DownloadIcon className="btn-icon-sm" />
              <span>{tr("下载素材")}</span>
            </button>

            {canPlayOriginal && (
              <button
                type="button"
                className="subtool-btn"
                disabled={busy}
                onClick={() => onOriginal("files.playOriginal")}
              >
                <PlayIcon className="btn-icon-sm" />
                <span>{tr("打开素材")}</span>
              </button>
            )}
          </div>

          {client && hello?.capabilities.methods.includes(application === "codex" ? "startup.update" : `${application}.startup.update`) && (
            <div className="inspector-startup-wrapper">
              <StartupAnimationControls
                key={`${application}:${startupRead}`}
                client={client}
                theme={theme}
                busy={busy}
                application={application}
                onBusy={onStartupBusy}
              />
            </div>
          )}

          <div className="inspector-danger-footer">
            <button
              type="button"
              className="btn-danger-ghost"
              disabled={!runtimeAllowed("restore")}
              onClick={() => control("restore")}
            >
              {tr("恢复原貌")}
            </button>
          </div>

          {targetControls?.notice}
          {mediaMenu && (
            <ConfirmationDialog title={tr("原始素材")} onCancel={() => setMediaMenu(false)}>
              <p>{tr("原始素材")}：{theme?.name}</p>
              <div className="editor-actions">
                <button type="button" disabled={busy} onClick={() => { setMediaMenu(false); onOriginal("files.playOriginal"); }}>{tr("打开原始素材")}</button>
                <button type="button" onClick={() => setMediaMenu(false)}>{tr("关闭")}</button>
              </div>
            </ConfirmationDialog>
          )}
        </div>
      </aside>
    );
  }

  if (theme && client && children) {
    return <div className="settings-child-container">{children}</div>;
  }

  return (
    <section className="inspector modern-inspector-panel" aria-label={tr("主题设置与草稿")}>
      <div className="empty inspector-empty">{loading ? tr("正在读取详情…") : tr("在控制台选择一个主题，查看素材与参数。")}</div>
    </section>
  );
}
