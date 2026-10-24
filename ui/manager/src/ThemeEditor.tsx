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

interface Props {
  theme: ThemeDetails; busy: boolean; canApply: boolean; mode?: "edit" | "create"; allowCopy?: boolean;
  onDirty(value: boolean): void; onPreview?(value: ThemeParameters | null): void;
  onSave(patch: ThemePatch, copyName: string | null, applyAfter: boolean): Promise<void>;
  onNotice(value: UiMessage): void;
  preview?: ReactNode; sourcePicker?: ReactNode; readyToSave?: boolean;
}
const ranges = {
  focusX: ["焦点水平位置", 0, 1, 0.5], focusY: ["焦点垂直位置", 0, 1, 0.5],
  positionX: ["水平位置", -1, 1, 0], positionY: ["垂直位置", -1, 1, 0], zoom: ["缩放", 1, 2, 1],
  playbackRate: ["视频播放速度", 0.25, 2, 1],
  bubbleOpacity: ["消息气泡不透明度（用户与助手）", 0, 1, 0], surfaceOpacity: ["面板不透明度（输入框、工具面板等）", 0, 1, 0.3],
  shellOpacity: ["背景遮罩不透明度", 0, 1, 0.58],
} as const;
const choices = {
  appearance: ["外观模式", [["auto", "自动"], ["light", "浅色"], ["dark", "深色"]]],
  safeArea: ["文字安全区", [["auto", "自动"], ["left", "左侧"], ["right", "右侧"], ["center", "中央"], ["none", "无"]]],
  taskMode: ["任务页模式", [["auto", "自动"], ["ambient", "氛围"], ["banner", "横幅"], ["full", "完整"], ["off", "关闭"]]],
} as const;

export function ThemeEditor({ theme, busy, canApply, mode = "edit", allowCopy = false, onDirty, onPreview, onSave, onNotice, preview, sourcePicker, readyToSave = true }: Props) {
  const tr = useText(), msg = useMessage();
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
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onPreview?.(previewParameters(theme.storedParameters, patch.parameters, systemDark)); return () => onPreview?.(null); }, [theme, patch, onPreview, systemDark]);
  const parameter = (key: keyof ThemeParameters) => patch.parameters && Object.hasOwn(patch.parameters, key) ? patch.parameters[key] ?? null : theme.storedParameters[key];
  const display = previewParameters(theme.storedParameters, patch.parameters, systemDark);
  const framing = display.framingEnabled;
  function change(key: keyof ThemeParameters, value: ThemeParameters[keyof ThemeParameters]) {
    setError("");
    setPatch(previous => {
      const parameters = { ...previous.parameters, [key]: value };
      if (key === "shellOpacity" && value === null && theme.storedParameters.shellOpacity == null) delete parameters.shellOpacity;
      if (key === "framingEnabled" && value === false) for (const name of ["positionX", "positionY", "zoom", "positionMode"] as const) parameters[name] = null;
      return { ...previous, parameters };
    });
  }
  async function save(copy: boolean, applyAfter: boolean) {
    setError("");
    try {
      parseThemePatch(patch);
      if (mode === "create" && !(patch.name ?? theme.name).trim()) throw new UiMessageError(uiMessage("主题名称不能为空。"));
      if (copy && (!copyName.trim() || copyName.length > 80)) throw new UiMessageError(uiMessage("副本名称须为 1–80 个字符。"));
    } catch (error) { setError(errorMessage(error, "请检查输入的参数。")); return; }
    try { await onSave(patch, copy ? copyName : null, applyAfter); setPatch({}); setCopying(false); }
    catch (error) { onNotice(errorMessage(error, "保存未完成，草稿已保留。")); }
  }
  function rangeControl(key: keyof typeof ranges) {
    const [label, min, max, fallback] = ranges[key], value = Number(display[key] ?? fallback);
    const coordinate = key === "positionX" || key === "positionY" || key === "zoom";
    return <label className="slider-field" key={key}><span>{tr(label)}<output>{key === "playbackRate" ? `${Number(value.toFixed(2))}×` : `${Math.round(value * 100)}%`}</output></span>
      <input aria-label={tr(label)} type="range" min={min * 100} max={max * 100} step={key === "playbackRate" ? 5 : 1} value={Math.round(value * 100)} disabled={coordinate && mode === "edit" && !framing}
        onChange={event => change(key, Number(event.target.value) / 100)} />
    </label>;
  }
  function choiceControl(key: keyof typeof choices) {
    const [label, options] = choices[key];
    return <label>{tr(label)}<Select aria-label={tr(label)} value={String(display[key])} disabled={busy || !theme.availability.update.allowed}
      onChange={value => change(key, value as ThemeParameters[typeof key])}
      options={options.map(([value, label]) => ({ value, label: tr(label) }))} /></label>;
  }
  function framingControls() { return <>
    {rangeControl("positionX")}{rangeControl("positionY")}{rangeControl("zoom")}
    <div className="framing-actions"><div className="segmented" role="group" aria-label={tr("移动范围")}>
      {(["locked", "free"] as const).map(value => <button type="button" key={value} disabled={mode === "edit" && !framing} aria-pressed={display.positionMode === value} onClick={() => change("positionMode", value)}>{tr(value === "locked" ? "锁定区域内" : "不锁定区域")}</button>)}
    </div>{mode === "create" && <button type="button" onClick={() => setPatch(previous => ({ ...previous, parameters: { ...previous.parameters, positionX: 0, positionY: 0, zoom: 1, positionMode: "locked" } }))}>{tr("复位")}</button>}</div>
  </>; }
  return <section className={`theme-editor ${mode === "create" ? "create-editor" : "saved-editor"}`} aria-label={tr(mode === "create" ? "导入图片" : "主题设置")}>
    {mode === "create" && <div className="import-visual"><section className="tag-panel"><h3>{tr("标签（可多选）")}</h3><div className="tag-options">
      {["动态", "人物", "动漫", "风景", "城市", "萌宠", "科技", "艺术"].map(tag => <label key={tag}><input type="checkbox" disabled={busy} checked={(patch.tags ?? theme.tags).includes(tag)} onChange={event => {
        const checked = event.target.checked;
        setPatch(previous => ({ ...previous, tags: checked ? [...new Set([...(previous.tags ?? theme.tags), tag])] : (previous.tags ?? theme.tags).filter(value => value !== tag) }));
      }} />{tr(tag)}</label>)}
    </div><p className="muted">{tr("可同时选择多个分类；未选择时归入艺术。")}</p></section>{preview}</div>}
    <div className="editor-form">
      {mode === "edit" && <><h3>{tr("显示与取景参数")}</h3><p className="muted">{tr("正在使用的主题保存后会刷新；已暂停的皮肤保持暂停。")}</p></>}
      <fieldset disabled={busy || !theme.availability.update.allowed}>
        {mode === "create" && <div className="editor-fields"><label>{tr("主题名称")}<input maxLength={80} value={patch.name ?? theme.name} onChange={event => setPatch(previous => ({ ...previous, name: event.target.value }))} /></label>{sourcePicker}</div>}
        <div className="editor-fields">{choiceControl("appearance")}</div>
        {mode === "edit" ? <>{rangeControl("focusX")}{rangeControl("focusY")}</> : framingControls()}
        <div className="editor-fields">{choiceControl("safeArea")}{choiceControl("taskMode")}</div>
        {rangeControl("shellOpacity")}
        <div className="framing-actions"><button type="button" disabled={parameter("shellOpacity") == null}
          title={tr("清除自定义背景遮罩，随浅色和深色外观自动调整。")}
          onClick={() => change("shellOpacity", null)}>{tr("使用外观默认值")}</button></div>
        {rangeControl("bubbleOpacity")}{rangeControl("surfaceOpacity")}
        {theme.mediaKind === "video" && rangeControl("playbackRate")}
        <label className="accent-field">{tr("主题强调色")}<span><input maxLength={7} placeholder="#RRGGBB" value={String(parameter("accent") ?? "")} onChange={event => change("accent", event.target.value || null)} />
          <input type="color" aria-label={tr("选择颜色")} value={/^#[0-9a-f]{6}$/i.test(String(parameter("accent"))) ? String(parameter("accent")) : "#B65CFF"} onChange={event => change("accent", event.target.value.toUpperCase())} /></span></label>
        {mode === "edit" && <><div className="editor-row"><label><input type="checkbox" checked={framing === true} onChange={event => change("framingEnabled", event.target.checked)} />{tr("启用自定义取景")}</label></div>{framingControls()}</>}
        <div className="editor-actions">
          {mode === "edit" && <button type="button" disabled={!dirty} onClick={() => { setPatch({}); setError(""); }}>{tr("恢复已存参数")}</button>}
          <button type="button" disabled={!readyToSave || mode === "edit" && !dirty} onClick={() => void save(false, false)}>{tr(mode === "create" ? "保存主题" : "保存修改")}</button>
          {mode === "create" && <button type="button" disabled={!readyToSave || !canApply} onClick={() => void save(false, true)}>{tr("保存并应用")}</button>}
        </div>
      </fieldset>
      {mode === "edit" && allowCopy && <button disabled={busy || !theme.availability.copy.allowed} onClick={() => setCopying(true)}>{tr("另存副本")}</button>}
      {copying && <ConfirmationDialog title={tr("另存副本")} onCancel={() => setCopying(false)}><label>{tr("副本名称")}<input value={copyName} maxLength={80} onChange={event => setCopyName(event.target.value)} /></label><div className="editor-actions">
        <button disabled={busy} onClick={() => setCopying(false)}>{tr("取消")}</button><button disabled={busy} onClick={() => void save(true, false)}>{tr("另存副本")}</button><button disabled={busy || !canApply} onClick={() => void save(true, true)}>{tr("另存并应用")}</button>
      </div></ConfirmationDialog>}
      {error && <p className="field-error" role="alert">{msg(error)}</p>}
    </div>
  </section>;
}
