import { useMessage } from "./desktop";
import { Select } from "./Select";
import { errorMessage, uiMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useEffect, useRef, useState } from "react";
import type { DesktopInfo, HelloResult, MaintenanceAction, MaintenanceInfo, MaintenanceOperation, MaintenanceProposal } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { BridgeError } from "./client";
import { preference, useCopy, copy } from "./desktop";

const storage = "dreamskin.manager.maintenance";
const pending = (op?: MaintenanceOperation) => !!op && ["queued", "running"].includes(op.state);
export function SystemPanel({ client, hello, disabled, onBusy, info, onInfo, onConsole }: {
  client: ManagerClient; hello: HelloResult; disabled: boolean; onBusy(value: boolean): void;
  info: DesktopInfo | null; onInfo(value: DesktopInfo): void; onConsole(): void;
}) {
  const msg = useMessage();
  const t = useCopy(), [notice, setNotice] = useState<UiMessage>(""), [running, setRunning] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceInfo | null>(null), [proposal, setProposal] = useState<MaintenanceProposal | null>(null);
  const [ids, setIds] = useState<string[]>([]), [operations, setOperations] = useState<Record<string, MaintenanceOperation>>({});
  const working = useRef(false), alive = useRef(true), attempted = useRef(false), records = useRef<string[]>([]);
  const canMaintain = hello.capabilities.methods.includes("maintenance.inspect");
  const latestId = ids.at(-1), active = latestId ? pending(operations[latestId]) : false;
  useEffect(() => {
    alive.current = true;
    if (canMaintain) {
      try {
        const saved = sessionStorage.getItem(storage);
        const value: unknown = saved ? JSON.parse(saved) : [];
        records.current = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-16) : [];
        setIds(records.current);
      } catch { setNotice(uiMessage(copy.maintenanceError[0])); }
      void client.call("maintenance.inspect", {}).then(value => { if (alive.current) setMaintenance(value); })
        .catch(error => { if (alive.current) setNotice(errorMessage(error, copy.systemError[0])); });
    }
    return () => { alive.current = false; };
  }, [client, canMaintain]);
  async function run(work: () => Promise<void>, query = false) {
    if (working.current || !query && (disabled || active)) return;
    working.current = true; setRunning(true); setNotice("");
    try { await work(); } catch (error) { if (alive.current) setNotice(errorMessage(error, copy.systemError[0])); }
    finally { working.current = false; if (alive.current) setRunning(false); }
  }
  async function read(id: string) {
    const value = await client.call("maintenance.get", { operationId: id });
    if (alive.current) {
      setOperations(previous => ({ ...previous, [id]: value }));
      if (records.current[records.current.length - 1] === id) onBusy(pending(value));
    }
    return value;
  }
  useEffect(() => {
    if (!latestId || !canMaintain) return;
    const id = latestId;
    let cancelled = false, timer: number | undefined;
    const query = async () => {
      try {
        const value = await read(id);
        if (!cancelled && pending(value)) timer = window.setTimeout(() => void query(), 1500);
      } catch (error) {
        if (cancelled || records.current[records.current.length - 1] !== id) return;
        setNotice(errorMessage(error, copy.maintenanceError[0]));
        // A rejected submission has no journal. Other failures retain the
        // current writer's busy state; old history never participates here.
        if (error instanceof BridgeError && error.detail.code === "OPERATION_UNKNOWN") onBusy(false);
        else timer = window.setTimeout(() => void query(), 5000);
      }
    };
    void query(); return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, latestId, canMaintain, onBusy]);
  async function prepare(action: MaintenanceAction) {
    const value = await client.call("maintenance.prepare", { action });
    if (alive.current) { setProposal(value); attempted.current = false; }
  }
  async function execute() {
    if (!proposal || attempted.current) return;
    const id = hello.backendSessionId + ":" + crypto.randomUUID(), next = [...records.current, id].slice(-16);
    sessionStorage.setItem(storage, JSON.stringify(next)); records.current = next;
    attempted.current = true; onBusy(true);
    try {
      const value = await client.call("maintenance.execute", { operationId: id, handle: proposal.handle, accepted: true });
      if (alive.current) setOperations(previous => ({ ...previous, [id]: value }));
    } finally { if (alive.current) setIds(next); }
  }
  const locked = disabled || running || active;
  return <section className="import-panel" id="system-information"><h2>{t("system")}</h2>
    <label>{t("language")} <Select aria-label={t("language")} disabled={running || !info} value={info?.language ?? "system"}
      onChange={value => void run(async () => onInfo(await client.call("desktop.language", { language: preference(value) })), true)}
      options={[{ value: "system", label: t("follow") }, { value: "zh-CN", label: "中文" }, { value: "en-US", label: "English" }]} /></label>
    <p>{t("login")}: {info ? t(info.login) : "—"}</p>
    {info && info.login !== "unsupported" && <button disabled={locked || info.login === "unavailable"} onClick={() => void run(async () => onInfo(await client.call("desktop.login", { enabled: info.login !== "enabled" && info.login !== "requiresApproval" })))}>{t(info.login === "enabled" || info.login === "requiresApproval" ? "disable" : "enable")}</button>}
    <div className="actions">{(["themes", "images", "state", "website", "gallery", "studio"] as const).map(target => <button key={target} disabled={running} onClick={() => void run(async () => {
      const result = await client.call("desktop.open", { target }); if (!result.opened) setNotice(uiMessage(copy.systemError[0]));
    }, true)}>{t(target)}</button>)}
      <button onClick={onConsole}>{t("codex")}</button>
      <button disabled={running} onClick={() => void run(async () => { onInfo(await client.call("desktop.get", {})); if (canMaintain) setMaintenance(await client.call("maintenance.inspect", {})); }, true)}>{t("refresh")}</button>
    </div><p className="muted">{t("codexHint")}</p>
    {canMaintain && <section id="platform-maintenance"><h3>{t("maintenance")}</h3>
      {maintenance ? <p>{t("engine")}: {maintenance.bundledVersion} · {t("deployed")}: {maintenance.installedVersion ?? t("missing")}</p> : <p>{t("preparing")}</p>}
      <div className="editor-actions">{maintenance?.actions.map(action => <button key={action} disabled={locked} onClick={() => void run(() => prepare(action))}>{t(action === "engine.install" ? "install" : "uninstall")}</button>)}</div>
      {proposal && !attempted.current && <div className="confirmation"><p>{t(proposal.action === "engine.install" ? "installImpact" : "uninstallImpact")}</p>

        <div className="editor-actions"><button disabled={locked || attempted.current || Date.parse(proposal.expiresAt) <= Date.now()} onClick={() => void run(execute)}>{t("execute")}</button>
          <button disabled={running} onClick={() => { setProposal(null); }}>{t("cancel")}</button></div>
      </div>}
      {!!ids.length && <div><ul className="import-results">{ids.slice(-1).map(id => {
        const operation = operations[id];
        return <li key={id}><p>{operation ? t(operation.state) : t("restoring")}</p>{operation?.error && <p className="error">{operation.error.message}</p>}
          {operation?.state === "indeterminate" && <p className="notice">{t("unknown")}</p>}
          {operation?.state === "succeeded" && <p className="notice">{t("completed")}</p>}
          <button disabled={running} onClick={() => void run(async () => { await read(id); }, true)}>{t("query")}</button>
        </li>;
      })}</ul></div>}
    </section>}
    {notice && <p className="notice" role="status">{msg(notice)}</p>}
  </section>;
}
