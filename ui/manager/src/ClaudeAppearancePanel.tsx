import type { AppearanceSnapshot, AppearanceTarget, AppearanceMutationMethod, HelloResult, ThemeDetails, ThemeSummary } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { useMessage, useText } from "./desktop";
import { ThemeDetailsPanel } from "./ThemeDetailsPanel";
import { emptyParameters } from "./preview-model";
import { diagnosticMessage } from "./ui-message";

export function AppearancePanel({ target, client, hello, theme, selectedPreview, activeTheme, snapshot, supported, busy, draftDirty, visible, onApply, onOriginal, onControl, onRefresh, onEdit, onStartupBusy }: {
  target: AppearanceTarget; client: ManagerClient | null; hello: HelloResult | null; theme: ThemeDetails | null; selectedPreview: ThemeSummary | null;
  activeTheme: ThemeSummary | null; snapshot: AppearanceSnapshot | null; supported: boolean; busy: boolean; draftDirty: boolean;
  visible: boolean; onEdit(): void; onApply(): void; onOriginal(action: "files.saveOriginal" | "files.playOriginal" | "files.exportPackage"): void;
  onControl(method: Exclude<AppearanceMutationMethod, "claude.apply" | "dsh.apply">): void; onRefresh(): void; onStartupBusy(value: boolean): void;
}) {
  const tr = useText(), msg = useMessage();
  return <ThemeDetailsPanel client={client} hello={hello} theme={theme} selectedPreview={selectedPreview} loading={!!selectedPreview && !theme}
    visible={visible} busy={busy} draftDirty={draftDirty} canApply={supported} onApply={onApply} onOriginal={onOriginal}
    onEdit={onEdit} onRefresh={onRefresh} onStartupBusy={onStartupBusy} targetControls={{ application: target, activeTheme,
      activeParameters: snapshot?.parameters ? { ...emptyParameters, ...snapshot.parameters, taskMode: "full" } : null,
      currentName: activeTheme?.name ?? (snapshot?.theme ? `${snapshot.theme.source}:${snapshot.theme.id}` : tr("暂无主题")),
      paused: snapshot?.paused ?? false,
      allowed: action => supported && !!hello?.capabilities.methods.includes(`${target}.${action}`),
      onControl: action => onControl(`${target}.${action}`),
      notice: <>{snapshot?.diagnostics.filter(item => target !== "dsh" || !["DSH_NOT_RUNNING", "DSH_DEBUGGER_REQUIRED", "DSH_DEBUGGER_UNVERIFIED"].includes(item.code)).map((item, index) => <p className="notice" role="status" key={index}>{msg(diagnosticMessage(item))}</p>)}
        {!supported && <p className="muted">{tr(target === "dsh" ? "DSH 换肤目前仅支持 Windows，macOS 暂不支持。" : "Claude Desktop 换肤目前仅支持 Windows。")}</p>}</>,
    }} />;
}
