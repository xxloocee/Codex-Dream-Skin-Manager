import { useText } from "./desktop";
import { useState } from "react";
import type { ReactNode } from "react";
import type { HelloResult, ManagerSnapshot, RuntimeMethod, ThemeDetails, ThemeParameters, ThemeSummary } from "../../../contracts/manager.mjs";
import { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { previewParameters } from "./preview-model";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { StartupAnimationControls } from "./StartupAnimationControls";
import type { ApplicationTarget } from "./ApplicationTarget";

export interface TargetSkinControls {
  application: ApplicationTarget;
  activeTheme: ThemeSummary | null;
  activeParameters?: ThemeParameters | null;
  currentName: string;
  paused: boolean;
  allowed(action: "pause" | "resume" | "reset" | "restore"): boolean;
  onControl(action: "pause" | "resume" | "reset" | "restore"): void;
  notice?: ReactNode;
}

export function ThemeDetailsPanel({ client, hello, theme, selectedPreview = null, activeTheme = null, snapshot, loading, visible, busy, canApply, onApply, onOriginal, onEdit, onControl, onRefresh, children, targetControls, onStartupBusy }: {
  client: ManagerClient | null; hello: HelloResult | null; theme: ThemeDetails | null; loading: boolean; visible: boolean;
  busy: boolean; draftDirty: boolean; canApply: boolean; onApply(): void;
  onOriginal(action: "files.saveOriginal" | "files.playOriginal" | "files.exportPackage"): void; onEdit?: () => void; children?: ReactNode;
  selectedPreview?: ThemeSummary | null; activeTheme?: ThemeDetails | null; snapshot?: ManagerSnapshot | null; onControl?(method: RuntimeMethod): void; onRefresh?(): void;
  targetControls?: TargetSkinControls; onStartupBusy?(value: boolean): void;
}) {
  const tr = useText();
  const [mediaMenu, setMediaMenu] = useState(false), [startupRead, setStartupRead] = useState(0);
  const application = targetControls?.application ?? "codex";
  const selectedTheme = theme ?? selectedPreview, currentTheme = targetControls?.activeTheme ?? activeTheme, shown = selectedTheme ?? currentTheme;
  const paused = targetControls?.paused ?? snapshot?.desired.paused;
  const control = (action: "pause" | "resume" | "reset" | "restore") => targetControls ? targetControls.onControl(action) : onControl?.(`skin.${action}`);
  const runtimeAllowed = (action: "pause" | "resume" | "reset" | "restore") => !busy && (targetControls ? targetControls.allowed(action)
    : !!hello?.capabilities.methods.includes(`skin.${action}`) && (action !== "restore" || !!snapshot?.runtime?.revision && !!snapshot.availability.restore?.allowed));
  if (onEdit) return <section className="inspector dashboard-inspector" aria-label={tr("当前皮肤控制")} tabIndex={hello?.platform === "macos" ? 0 : undefined} onKeyDown={event => {
    if ((event.key === "ContextMenu" || event.shiftKey && event.key === "F10") && hello?.platform === "macos" && theme && theme.mediaKind !== "image" && hello.capabilities.methods.includes("files.playOriginal")) { event.preventDefault(); setMediaMenu(true); }
  }} onContextMenu={event => {
    if (hello?.platform === "macos" && theme?.mediaKind !== "image" && theme && hello.capabilities.methods.includes("files.playOriginal")) { event.preventDefault(); setMediaMenu(true); }
  }}>
    {shown && client ? <MediaPreview key={`${selectedTheme ? "library" : "active"}:${shown.revision}`} client={client}
      target={selectedTheme || application !== "codex" ? { kind: "theme", theme: shown.ref, revision: shown.revision, variant: "preview" } : { kind: "active", revision: shown.revision }}
      name={shown.name} parameters={theme ? previewParameters(theme.storedParameters) : application !== "codex" ? selectedTheme ? null : targetControls?.activeParameters ?? null : selectedTheme ? null : activeTheme ? previewParameters(activeTheme.storedParameters) : null} application={application} mediaKind={shown.mediaKind} visible={visible} />
      : <div className="preview placeholder">{loading ? tr("正在读取详情…") : tr("尚无可预览的当前皮肤")}</div>}
    <div className="detail-body"><p className="eyebrow">{tr("选中主题")}</p><h2>{shown?.name ?? tr("尚未选择主题")}</h2>
      <div className="target-runtime-summary"><span>{tr(application === "dsh" ? "DSH 当前皮肤" : application === "claude" ? "Claude Desktop 当前皮肤" : "Codex 当前皮肤")}</span><strong>{targetControls?.currentName ?? activeTheme?.name ?? tr(snapshot?.desired.theme ? "状态暂不可用" : "未运行")}</strong></div>
      <button className="primary" disabled={busy || loading || (selectedTheme ? !theme || !canApply : !runtimeAllowed("resume"))} onClick={onApply}>{tr(application === "dsh" ? "应用到 DSH" : application === "claude" ? "应用到 Claude Desktop" : "应用到 Codex")}</button>
      <div className="dashboard-actions">
        <button disabled={busy || !theme || !hello?.capabilities.methods.includes("files.saveOriginal")} onClick={() => onOriginal("files.saveOriginal")}>{tr("下载素材")}</button>
        <button disabled={busy || !theme} onClick={onEdit}>{tr("编辑参数")}</button>
        <button disabled={!runtimeAllowed(paused ? "resume" : "pause")} onClick={() => control(paused ? "resume" : "pause")}>{tr(paused ? "继续" : "暂停")}</button>
        <button disabled={!runtimeAllowed("reset")} onClick={() => control("reset")}>{tr("重置")}</button>
        <button disabled={busy || !hello} onClick={() => { setStartupRead(value => value + 1); onRefresh?.(); }}>{tr("刷新")}</button>
        <button className="danger" disabled={!runtimeAllowed("restore")} onClick={() => control("restore")}>{tr("恢复原貌")}</button>
      </div>
      {client && hello?.capabilities.methods.includes(application === "codex" ? "startup.update" : `${application}.startup.update`) && <StartupAnimationControls key={`${application}:${startupRead}`} client={client} theme={theme} busy={busy} application={application} onBusy={onStartupBusy} />}
      {targetControls?.notice}
      {mediaMenu && <ConfirmationDialog title={tr("原始素材")} onCancel={() => setMediaMenu(false)}><button disabled={busy} onClick={() => { setMediaMenu(false); onOriginal("files.playOriginal"); }}>{tr("打开原始素材")}</button><button onClick={() => setMediaMenu(false)}>{tr("关闭")}</button></ConfirmationDialog>}
    </div>
  </section>;
  return <section className="inspector" aria-label={onEdit ? tr("已保存主题与操作") : tr("主题设置与草稿")}>
    {theme && client ? <>
      <div className="detail-body">
        {children}
      </div></> : <div className="empty inspector-empty">{loading ? tr("正在读取详情…") : tr("在控制台选择一个主题，查看素材与参数。")}</div>}
  </section>;
}
