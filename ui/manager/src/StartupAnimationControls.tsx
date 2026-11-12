import { useEffect, useRef, useState } from "react";
import type { StartupAnimationSettings, StartupAnimationUpdate, ThemeDetails } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { useMessage, useText } from "./desktop";
import { errorMessage, joinMessages, uiMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";

export function StartupAnimationControls({ client, theme, busy, application = "codex", onBusy }: { client: ManagerClient; theme: ThemeDetails | null; busy: boolean; application?: "codex" | "claude" | "dsh"; onBusy?: ((value: boolean) => void) | undefined }) {
  const tr = useText(), msg = useMessage();
  const [settings, setSettings] = useState<StartupAnimationSettings | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState<UiMessage>("");
  const current = useRef({ client, application }), writing = useRef(false);
  current.current = { client, application };
  useEffect(() => {
    let active = true;
    setSettings(null); setError("");
    void client.call(application === "codex" ? "startup.get" : `${application}.startup.get`, {}).then(value => { if (active) setSettings(value); })
      .catch(error => { if (active) setError(errorMessage(error, "启动动画设置未能读取。")); });
    return () => { active = false; };
  }, [client, application]);
  async function update(params: StartupAnimationUpdate) {
    if (writing.current || busy || !settings) return;
    writing.current = true; setSaving(true); onBusy?.(true); setError("");
    try {
      const value = await client.call(application === "codex" ? "startup.update" : `${application}.startup.update`, params);
      if (current.current.client === client && current.current.application === application) setSettings(value);
    } catch (error) {
      let notice = errorMessage(error, "请刷新状态后再操作。");
      if (application !== "codex") {
        try {
          const saved = await client.call(`${application}.startup.get`, {});
          const matches = (params.enabled === undefined || params.enabled === saved.enabled) &&
            (!Object.hasOwn(params, "theme") || (params.theme === null ? saved.theme === null :
              params.theme?.source === saved.theme?.source && params.theme?.id === saved.theme?.id));
          if (current.current.client === client && current.current.application === application) setSettings(saved);
          if (matches) notice = joinMessages([uiMessage(application === "dsh" ? "启动动画设置已保存，DSH 连接更新失败。" : "启动动画设置已保存，Claude Desktop 连接更新失败。"), notice], " ");
        } catch {
          notice = joinMessages([uiMessage("启动动画设置结果尚未确认；请刷新后核对，不会自动重试。"), notice], " ");
        }
      }
      if (current.current.client === client && current.current.application === application) setError(notice);
    }
    finally { writing.current = false; onBusy?.(false); if (current.current.client === client && current.current.application === application) setSaving(false); }
  }
  const selected = !!theme && settings?.theme?.source === theme.ref.source && settings.theme.id === theme.ref.id;
  const locked = busy || saving || !settings;
  return <section aria-label={tr("启动动画")}>
    <h3>{tr("启动动画")}</h3>
    <label><input type="checkbox" checked={settings?.enabled ?? false} disabled={locked}
      onChange={event => void update({ enabled: event.target.checked })} />{tr("启用启动动画")}</label>
    {settings && <p className="muted">{tr("当前动画")}：{settings.themeName ?? tr("内置默认动画")}</p>}
    <div className="dashboard-actions">
      <button disabled={locked || theme?.mediaKind !== "video" || selected} title={theme?.mediaKind !== "video" ? tr("请选择视频主题") : undefined}
        onClick={() => { if (theme) void update({ theme: theme.ref, expectedRevision: theme.revision }); }}>{tr(selected ? "已设为启动动画" : "设为启动动画")}</button>
      <button disabled={locked || !settings?.theme} onClick={() => void update({ theme: null })}>{tr("恢复默认动画")}</button>
    </div>
    {error && <p className="notice" role="status">{msg(error)}</p>}
  </section>;
}
