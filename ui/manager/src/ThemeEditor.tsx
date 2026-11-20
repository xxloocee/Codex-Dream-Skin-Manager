import { applicationNames, type ApplicationTarget } from "./ApplicationTarget";
import { useMessage, useText } from "./desktop";
import { Select } from "./Select";
import { errorMessage, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { parseThemePatch } from "../../../contracts/manager.mjs";
import type { ThemeDetails, ThemeParameters, ThemePatch } from "../../../contracts/manager.mjs";
import { previewParameters } from "./preview-model";
import { ConfirmationDialog } from "./ConfirmationDialog";
import type { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { CheckIcon, CopyIcon, RotateCcwIcon, SparklesIcon, XIcon } from "./Icons";

interface Props {
  theme: ThemeDetails;
  busy: boolean;
  canApply: boolean;
  mode?: "edit" | "create" | undefined;
  allowCopy?: boolean | undefined;
  onDirty(value: boolean): void;
  onReset?: (() => void) | undefined;
  onPreview?: ((value: ThemeParameters | null) => void) | undefined;
  onSave(patch: ThemePatch, copyName: string | null, applyAfter: boolean): Promise<void>;
  onNotice(value: UiMessage): void;
  preview?: ReactNode | undefined;
  sourcePicker?: ReactNode | undefined;
  readyToSave?: boolean | undefined;
  application?: ApplicationTarget | undefined;
  client?: ManagerClient | null | undefined;
  visible?: boolean | undefined;
}

const ranges = {
  focusX: ["焦点水平位置", 0, 1, 0.5],
  focusY: ["焦点垂直位置", 0, 1, 0.5],
  positionX: ["水平位置", -1, 1, 0],
  positionY: ["垂直位置", -1, 1, 0],
  zoom: ["缩放", 1, 2, 1],
  playbackRate: ["视频播放速度", 0.25, 2, 1],
  bubbleOpacity: ["消息气泡不透明度（用户与助手）", 0, 1, 0],
  surfaceOpacity: ["面板不透明度（输入框、工具面板等）", 0, 1, 0.3],
  shellOpacity: ["背景遮罩不透明度", 0, 1, 0.25],
} as const;

const choices = {
  appearance: ["外观模式", [["auto", "自动"], ["light", "浅色"], ["dark", "深色"]]],
  safeArea: ["文字安全区", [["auto", "自动"], ["left", "左侧"], ["right", "右侧"], ["center", "中央"], ["none", "无"]]],
  taskMode: ["任务页模式", [["auto", "自动"], ["ambient", "氛围"], ["banner", "横幅"], ["full", "完整"], ["off", "关闭"]]],
} as const;

const TAG_LIST = ["动态", "人物", "动漫", "风景", "城市", "萌宠", "科技", "艺术"] as const;

type EditorTab = "info" | "visual" | "framing";

function rebasePatch(patch: ThemePatch, theme: ThemeDetails): ThemePatch {
  const next = { ...patch };
  if (next.name === theme.name) delete next.name;
  if (next.storageCategory === theme.storageCategory) delete next.storageCategory;
  if (next.tags?.length === theme.tags.length && next.tags.every((tag, index) => tag === theme.tags[index])) delete next.tags;
  if (next.parameters) {
    const parameters = { ...next.parameters };
    for (const key of Object.keys(parameters) as (keyof ThemeParameters)[]) {
      if (parameters[key] === theme.storedParameters[key]) delete parameters[key];
    }
    if (Object.keys(parameters).length) next.parameters = parameters;
    else delete next.parameters;
  }
  return next;
}

export function ThemeEditor({
  theme,
  busy,
  canApply,
  mode = "edit",
  allowCopy = false,
  onDirty,
  onReset,
  onPreview,
  onSave,
  onNotice,
  preview,
  sourcePicker,
  readyToSave = true,
  application = "codex",
  client,
  visible = true,
}: Props) {
  const tr = useText(), msg = useMessage();
  const canEditMetadata = mode === "create" || (application === "codex" && theme.ref.source === "saved");
  const [activeTab, setActiveTab] = useState<EditorTab>("info");
  const [patch, setPatch] = useState<ThemePatch>({}), [error, setError] = useState<UiMessage>("");
  const [copying, setCopying] = useState(false), [copyName, setCopyName] = useState(theme.name.slice(0, 80));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const appearance = () => setSystemDark(media.matches);
    media.addEventListener("change", appearance);
    return () => media.removeEventListener("change", appearance);
  }, []);

  const dirty = Object.keys(patch).some(key => key !== "parameters" || Object.keys(patch.parameters ?? {}).length > 0);
  // A save from the quick controls updates the baseline without discarding this editor's changes.
  useEffect(() => { setPatch(previous => rebasePatch(previous, theme)); }, [theme]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    onPreview?.(previewParameters(theme.storedParameters, patch.parameters, systemDark));
    return () => onPreview?.(null);
  }, [theme, patch, onPreview, systemDark]);

  const parameter = (key: keyof ThemeParameters) =>
    patch.parameters && Object.hasOwn(patch.parameters, key) ? patch.parameters[key] ?? null : theme.storedParameters[key];
  const display = previewParameters(theme.storedParameters, patch.parameters, systemDark);
  const framing = display.framingEnabled;

  function change(key: keyof ThemeParameters, value: ThemeParameters[keyof ThemeParameters]) {
    setError("");
    setPatch(previous => {
      const parameters = { ...previous.parameters, [key]: value };
      if (key === "shellOpacity" && value === null && theme.storedParameters.shellOpacity == null) delete parameters.shellOpacity;
      if (key === "framingEnabled" && value === false) {
        for (const name of ["positionX", "positionY", "zoom", "positionMode"] as const) parameters[name] = null;
      }
      return rebasePatch({ ...previous, parameters }, theme);
    });
  }

  function updateName(nextName: string) {
    setError("");
    setPatch(previous => {
      const next = { ...previous };
      if (nextName === theme.name) delete next.name;
      else next.name = nextName;
      return next;
    });
  }

  function toggleTag(tag: string) {
    setError("");
    setPatch(previous => {
      const current = previous.tags ?? theme.tags;
      const isChecked = current.includes(tag);
      const nextTags = isChecked ? current.filter(v => v !== tag) : [...new Set([...current, tag])];
      const next = { ...previous };
      if (nextTags.length === theme.tags.length && nextTags.every((t, i) => t === theme.tags[i])) {
        delete next.tags;
      } else {
        next.tags = nextTags;
      }
      return next;
    });
  }

  async function save(copy: boolean, applyAfter: boolean) {
    setError("");
    try {
      parseThemePatch(patch);
      if ((mode === "create" || Object.hasOwn(patch, "name")) && !(patch.name ?? theme.name).trim()) {
        throw new UiMessageError(uiMessage("主题名称不能为空。"));
      }
      if (copy && (!copyName.trim() || copyName.length > 80)) {
        throw new UiMessageError(uiMessage("副本名称须为 1–80 个字符。"));
      }
    } catch (error) {
      setError(errorMessage(error, "请检查输入的参数。"));
      return;
    }
    try {
      await onSave(patch, copy ? copyName : null, applyAfter);
      setPatch({});
      setCopying(false);
    } catch (error) {
      onNotice(errorMessage(error, "保存未完成，草稿已保留。"));
    }
  }

  function rangeControl(key: keyof typeof ranges) {
    const [label, min, max, fallback] = ranges[key], value = Number(display[key] ?? fallback);
    const coordinate = key === "positionX" || key === "positionY" || key === "zoom";
    return (
      <label className="slider-field compact-slider" key={key}>
        <span className="slider-label-row">
          <span className="slider-title">{tr(label)}</span>
          <output className="slider-val">{key === "playbackRate" ? `${Number(value.toFixed(2))}×` : `${Math.round(value * 100)}%`}</output>
        </span>
        <input
          aria-label={tr(label)}
          type="range"
          min={min * 100}
          max={max * 100}
          step={key === "playbackRate" ? 5 : 1}
          value={Math.round(value * 100)}
          disabled={coordinate && mode === "edit" && !framing}
          onChange={event => change(key, Number(event.target.value) / 100)}
        />
      </label>
    );
  }

  function choiceControl(key: keyof typeof choices) {
    const [label, options] = choices[key];
    return (
      <label className="choice-field" key={key}>
        <span>{tr(label)}</span>
        <Select
          aria-label={tr(label)}
          value={String(display[key])}
          disabled={busy || (application === "codex" && !theme.availability.update.allowed)}
          onChange={value => change(key, value as ThemeParameters[typeof key])}
          options={options.map(([value, optLabel]) => ({ value, label: tr(optLabel) }))}
        />
      </label>
    );
  }

  function framingControls() {
    const disabledCoord = mode === "edit" && !framing;
    return (
      <>
        <div className="editor-grid-2col">
          {rangeControl("positionX")}
          {rangeControl("positionY")}
        </div>
        <div className="editor-grid-2col">
          {rangeControl("zoom")}
          <div className="framing-actions-inline">
            <div className="segmented compact-segmented" role="group" aria-label={tr("移动范围")}>
              {(["locked", "free"] as const).map(value => (
                <button
                  type="button"
                  key={value}
                  disabled={disabledCoord}
                  aria-pressed={display.positionMode === value}
                  onClick={() => change("positionMode", value)}
                >
                  {tr(value === "locked" ? "锁定区域内" : "不锁定区域")}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-sm"
              disabled={disabledCoord}
              title={tr("复位")}
              onClick={() =>
                setPatch(previous => ({
                  ...previous,
                  parameters: {
                    ...previous.parameters,
                    ...(mode === "edit" ? { framingEnabled: true } : {}),
                    positionX: 0,
                    positionY: 0,
                    zoom: 1,
                    positionMode: "locked",
                  },
                }))
              }
            >
              <RotateCcwIcon className="btn-icon-xs" />
              <span>{tr("复位")}</span>
            </button>
          </div>
        </div>
      </>
    );
  }

  const showInfo = activeTab === "info";
  const showVisual = activeTab === "visual";
  const showFraming = activeTab === "framing";

  return (
    <section className={`theme-editor ${mode === "create" ? "create-editor" : "saved-editor"}`} aria-label={tr(mode === "create" ? "导入图片" : "主题设置")}>
      {mode === "create" && (
        <div className="editor-preview-stage">
          <div className="editor-preview-frame import-visual">{preview}</div>
        </div>
      )}
      {mode === "edit" && client && (
        <div className="editor-preview-stage">
          <div className="editor-preview-frame editor-live-preview">
            <MediaPreview
              client={client}
              target={{ kind: "theme", theme: theme.ref, revision: theme.revision, variant: "preview" }}
              name={patch.name ?? theme.name}
              application={application}
              parameters={display}
              visible={visible}
            />
            <div className="canvas-badge-overlay">
              <span className="canvas-badge-dot" />
              <span>{patch.name || theme.name} · {applicationNames[application]}</span>
            </div>
          </div>
        </div>
      )}

      <div className="editor-form modern-editor-panel">
        <div className="editor-form-header">
          <div className="editor-title-row">
            <h3>{mode === "create" ? tr("新主题制作与调校") : tr(`${applicationNames[application]} 显示与取景`)}</h3>
            {mode === "edit" && allowCopy && (
              <button
                type="button"
                className="btn-sm"
                disabled={busy || !theme.availability.copy.allowed}
                onClick={() => {
                  setCopyName((patch.name ?? theme.name).slice(0, 80));
                  setCopying(true);
                }}
              >
                <CopyIcon className="btn-icon-xs" />
                <span>{tr("另存副本")}</span>
              </button>
            )}
          </div>

          <div className="editor-subtabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "info"}
              className={activeTab === "info" ? "tab-active" : ""}
              onClick={() => setActiveTab("info")}
            >
              {tr("基础设置")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "visual"}
              className={activeTab === "visual" ? "tab-active" : ""}
              onClick={() => setActiveTab("visual")}
            >
              {tr("材质与外观")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "framing"}
              className={activeTab === "framing" ? "tab-active" : ""}
              onClick={() => setActiveTab("framing")}
            >
              {tr("画面取景")}
            </button>
          </div>
        </div>

        <fieldset className="editor-form-scrollable" disabled={busy || (application === "codex" && !theme.availability.update.allowed)}>
          {showInfo && (
            <div className="editor-section">
              <div className="editor-section-title">{tr("基础设置")}</div>
              <div className="editor-fields">
                <label>
                  <span>{tr("主题名称")}</span>
                  <input
                    maxLength={80}
                    value={patch.name ?? theme.name}
                    readOnly={!canEditMetadata}
                    placeholder={tr("请输入主题名称…")}
                    onChange={event => updateName(event.target.value)}
                  />
                </label>
                {mode === "create" && sourcePicker}
              </div>
              {canEditMetadata ? (
                <div className="tag-panel-inline">
                  <span className="editor-sublabel">{tr("标签（可多选）")}</span>
                  <div className="tag-options-pills">
                    {TAG_LIST.map(tag => {
                      const currentTags = patch.tags ?? theme.tags;
                      const isChecked = currentTags.includes(tag);
                      const disabledLimit = !isChecked && currentTags.length >= 8;
                      return (
                        <button
                          type="button"
                          key={tag}
                          disabled={busy || disabledLimit}
                          aria-pressed={isChecked}
                          className={`tag-pill ${isChecked ? "active" : ""}`}
                          onClick={() => toggleTag(tag)}
                        >
                          {tr(tag)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : theme.tags.length > 0 && (
                <div className="tag-options-pills">
                  {theme.tags.map(tag => <span key={tag} className="tag-pill active">{tr(tag)}</span>)}
                </div>
              )}
              <div className="editor-fields">
                {choiceControl("appearance")}
                {application === "codex" && choiceControl("safeArea")}
                {application === "codex" && choiceControl("taskMode")}
                {theme.mediaKind === "video" && rangeControl("playbackRate")}
              </div>
            </div>
          )}

          {showVisual && (
            <div className="editor-section">
              <div className="editor-section-title">{tr("视觉遮罩与透光")}</div>
              <div className="editor-grid-2col">
                {rangeControl("shellOpacity")}
                {rangeControl("surfaceOpacity")}
              </div>

              {application === "codex" && (
                <div className="editor-grid-2col">
                  {rangeControl("bubbleOpacity")}
                </div>
              )}

              <div className="editor-row-tools">
                <button
                  type="button"
                  className="btn-sm"
                  disabled={parameter("shellOpacity") == null}
                  title={tr("清除自定义背景遮罩，恢复默认不透明度 25%。")}
                  onClick={() => change("shellOpacity", null)}
                >
                  {tr("使用默认值（25%）")}
                </button>

                {application === "codex" && (
                  <div className="accent-field-inline">
                    <span>{tr("主题强调色")}</span>
                    <input
                      aria-label={tr("主题强调色")}
                      maxLength={7}
                      placeholder="#RRGGBB"
                      value={String(parameter("accent") ?? "")}
                      onChange={event => change("accent", event.target.value || null)}
                    />
                    <input
                      type="color"
                      aria-label={tr("选择颜色")}
                      value={/^#[0-9a-f]{6}$/i.test(String(parameter("accent"))) ? String(parameter("accent")) : "#B65CFF"}
                      onChange={event => change("accent", event.target.value.toUpperCase())}
                    />
                    {parameter("accent") && (
                      <button
                        type="button"
                        className="btn-icon-only"
                        title={tr("清除强调色")}
                        aria-label={tr("清除强调色")}
                        onClick={() => change("accent", null)}
                      >
                        <XIcon className="btn-icon-xs" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {showFraming && (
            <div className="editor-section">
              <div className="editor-section-title">{tr("画面与取景位置")}</div>
              {mode === "edit" ? (
                <>
                  <div className="editor-grid-2col">
                    {rangeControl("focusX")}
                    {rangeControl("focusY")}
                  </div>
                  <div className="editor-row">
                    <label className="checkbox-inline">
                      <input
                        type="checkbox"
                        checked={framing === true}
                        onChange={event => change("framingEnabled", event.target.checked)}
                      />
                      <span>{tr("启用自定义取景")}</span>
                    </label>
                  </div>
                  {framingControls()}
                </>
              ) : (
                framingControls()
              )}
            </div>
          )}

          {mode === "edit" && application === "codex" && theme.ref.source === "preset" && allowCopy && (
            <p className="muted editor-footnote">{tr("内置主题只保存参数修改；分类和标签的修改须另存为副本。")}</p>
          )}
        </fieldset>

        {error && <p className="field-error editor-inline-error" role="alert">{msg(error)}</p>}

        <div className="editor-sticky-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => { setPatch({}); setError(""); onReset?.(); }}
          >
            <RotateCcwIcon className="btn-icon-sm" />
            {tr(mode === "create" ? "重置草稿" : "恢复已存参数")}
          </button>
          <button
            type="button"
            className={!canApply ? "primary btn-apply-primary" : ""}
            disabled={!readyToSave || busy || (mode === "edit" && (!dirty || (application === "codex" && !theme.availability.update.allowed)))}
            onClick={() => void save(false, false)}
          >
            <CheckIcon className="btn-icon-sm" />
            <span>{tr(mode === "create" ? "保存主题" : "保存修改")}</span>
          </button>
          {canApply && (
            <button
              type="button"
              className="primary btn-apply-primary"
              disabled={!readyToSave || busy || (mode === "edit" && (!dirty || (application === "codex" && !theme.availability.update.allowed)))}
              onClick={() => void save(false, true)}
            >
              <SparklesIcon className="btn-icon-sm" />
              <span>{tr(mode === "create" ? "保存并应用" : "保存并应用")}</span>
            </button>
          )}
        </div>

        {copying && (
          <ConfirmationDialog title={tr("另存副本")} onCancel={() => setCopying(false)}>
            <label>
              <span>{tr("副本名称")}</span>
              <input value={copyName} maxLength={80} onChange={event => setCopyName(event.target.value)} />
            </label>
            <div className="editor-actions">
              <button type="button" disabled={busy} onClick={() => setCopying(false)}>{tr("取消")}</button>
              <button type="button" disabled={busy} onClick={() => void save(true, false)}>{tr("另存副本")}</button>
              <button type="button" className="primary" disabled={busy || !canApply} onClick={() => void save(true, true)}>{tr("另存并应用")}</button>
            </div>
          </ConfirmationDialog>
        )}
      </div>
    </section>
  );
}
