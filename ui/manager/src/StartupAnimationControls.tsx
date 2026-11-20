import { applicationNames, type ApplicationTarget } from "./ApplicationTarget";
import { useEffect, useRef, useState } from "react";
import type { StartupAnimationSettings, StartupAnimationUpdate, ThemeDetails } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { useMessage, useText } from "./desktop";
import { errorMessage, joinMessages, uiMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { FilmIcon } from "./Icons";

export function StartupAnimationControls({
  client,
  theme,
  busy,
  application = "codex",
  onBusy,
}: {
  client: ManagerClient;
  theme: ThemeDetails | null;
  busy: boolean;
  application?: ApplicationTarget | undefined;
  onBusy?: ((value: boolean) => void) | undefined;
}) {
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
          if (matches) notice = joinMessages([uiMessage(`启动动画设置已保存，${applicationNames[application]} 连接更新失败。`), notice], " ");
        } catch {
          notice = joinMessages([uiMessage("启动动画设置结果尚未确认；请刷新后核对，不会自动重试。"), notice], " ");
        }
      }
      if (current.current.client === client && current.current.application === application) setError(notice);
    } finally {
      writing.current = false;
      onBusy?.(false);
      if (current.current.client === client && current.current.application === application) setSaving(false);
    }
  }

  const selected = !!theme && settings?.theme?.source === theme.ref.source && settings.theme.id === theme.ref.id;
  const isEnabled = settings?.enabled ?? false;
  const locked = busy || saving || !settings;
  const isVideo = theme?.mediaKind === "video";

  return (
    <section className="startup-capsule" aria-label={tr("启动动画")}>
      <div className="startup-capsule-row">
        <div className="startup-info-left">
          <FilmIcon className="startup-icon" />
          <span className="startup-label">{tr("启动动画")}</span>
          <span className="startup-current-name" title={settings ? settings.themeName ?? tr("内置默认动画") : undefined}>
            {settings ? settings.themeName ?? tr("内置默认动画") : tr("正在读取…")}
          </span>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={isEnabled}
          aria-label={tr("启用启动动画")}
          disabled={locked}
          className={`switch-toggle ${isEnabled ? "on" : "off"}`}
          onClick={() => void update({ enabled: !isEnabled })}
          title={tr(isEnabled ? "点击关闭启动动画" : "点击开启启动动画")}
        >
          <span className="switch-thumb" />
        </button>
      </div>

      {(isVideo || !!settings?.theme) && (
        <div className="startup-action-row">
          <button
            type="button"
            className="btn-tiny"
            disabled={locked || !isVideo || selected}
            title={!isVideo ? tr("请选择视频主题") : undefined}
            onClick={() => { if (theme && isVideo) void update({ theme: theme.ref, expectedRevision: theme.revision }); }}
          >
            {tr(selected ? "已设为启动动画" : "设为启动动画")}
          </button>
          {settings?.theme && (
            <button
              type="button"
              className="btn-tiny ghost"
              disabled={locked}
              onClick={() => void update({ theme: null })}
            >
              {tr("恢复默认动画")}
            </button>
          )}
        </div>
      )}

      {error && <p className="notice startup-notice" role="status">{msg(error)}</p>}
    </section>
  );
}
