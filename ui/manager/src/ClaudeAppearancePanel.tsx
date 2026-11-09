import type { ClaudeSnapshot, HelloResult, ThemeDetails, ThemeSummary } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { useText } from "./desktop";
import { ThemeDetailsPanel } from "./ThemeDetailsPanel";
import { emptyParameters } from "./preview-model";

export function ClaudeAppearancePanel({ client, hello, theme, selectedPreview, activeTheme, snapshot, supported, busy, draftDirty, visible, onApply, onOriginal, onControl, onRefresh, onEdit, onStartupBusy }: {
  client: ManagerClient | null; hello: HelloResult | null; theme: ThemeDetails | null; selectedPreview: ThemeSummary | null;
  activeTheme: ThemeSummary | null; snapshot: ClaudeSnapshot | null; supported: boolean; busy: boolean; draftDirty: boolean;
  visible: boolean; onEdit(): void; onApply(): void; onOriginal(action: "files.saveOriginal" | "files.playOriginal" | "files.exportPackage"): void;
  onControl(method: "claude.pause" | "claude.resume" | "claude.reset" | "claude.restore"): void; onRefresh(): void; onStartupBusy(value: boolean): void;
}) {
  const tr = useText(), connected = snapshot?.connection === "connected";
  return <ThemeDetailsPanel client={client} hello={hello} theme={theme} selectedPreview={selectedPreview} loading={!!selectedPreview && !theme}
    visible={visible} busy={busy} draftDirty={draftDirty} canApply={supported && connected} onApply={onApply} onOriginal={onOriginal}
    onEdit={onEdit} onRefresh={onRefresh} onStartupBusy={onStartupBusy} targetControls={{ application: "claude", activeTheme,
      activeParameters: snapshot?.parameters ? { ...emptyParameters, ...snapshot.parameters, taskMode: "full" } : null,
      currentName: activeTheme?.name ?? (snapshot?.theme ? `${snapshot.theme.source}:${snapshot.theme.id}` : tr("暂无主题")),
      paused: snapshot?.paused ?? false,
      allowed: action => supported && connected && !!hello?.capabilities.methods.includes(`claude.${action}`) && (action === "reset" || action === "restore" || !!snapshot?.theme),
      onControl: action => onControl(`claude.${action}`),
      notice: <>{snapshot?.connection === "awaiting-debugger" && <p className="muted">{tr("在 Claude Desktop 的 Developer 菜单开启 Enable Main Process Debugger，然后刷新。")}</p>}
        {!supported && <p className="muted">{tr("Claude Desktop 换肤目前仅支持 Windows。")}</p>}</>,
    }} />;
}
