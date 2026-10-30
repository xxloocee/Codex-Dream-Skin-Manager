import { useMessage } from "./desktop";
import { errorMessage, uiMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useText } from "./desktop";
import { useEffect, useRef, useState } from "react";
import type { UpdateCheck, UpdateOperation } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { BridgeError } from "./client";

const labels: Record<UpdateOperation["state"], string> = { queued: "正在准备更新…", running: "正在下载更新…", handoff: "请完成安装", installed: "更新已安装", failed: "更新未完成", indeterminate: "结果待核对" };
const installing = (operation?: UpdateOperation) => operation?.state === "queued" || operation?.state === "running" || (operation?.state === "handoff" && operation.managerMustQuit);
const channels = { "windows-release": "Windows 正式版", "macos-release": "macOS 普通发布", "macos-gui": "macOS 签名 GUI" };
const message = (error: unknown) => errorMessage(error, "更新处理未完成。");
const recordsKey = "dreamskin.manager.updates", notificationKey = "dreamskin.manager.update-notified";

export function UpdatePanel({ client, session, disabled, checkRequest = 0, onBusy, onAvailable }: {
  client: ManagerClient; session: string; disabled: boolean; checkRequest?: number; onBusy(value: boolean): void; onAvailable(value: boolean): void;
}) {
  const tr = useText(), msg = useMessage();
  const [proposal, setProposal] = useState<UpdateCheck | null>(null);
  const [running, setRunning] = useState(false), [notice, setNotice] = useState<UiMessage>(""), [ids, setIds] = useState<string[]>([]);
  const [operations, setOperations] = useState<Record<string, UpdateOperation>>({}), [attempted, setAttempted] = useState(false);
  const [showOperation, setShowOperation] = useState(true), [queryError, setQueryError] = useState<UiMessage>("");
  const alive = useRef(true), working = useRef(false), foregroundCheck = useRef(false), busy = useRef(disabled), proposalRef = useRef<UpdateCheck | null>(null), attemptedRef = useRef(false);
  const operationsRef = useRef(operations), records = useRef<string[]>([]), lastCheck = useRef(0), announced = useRef<Record<string, string>>({});
  busy.current = disabled; operationsRef.current = operations;
  const unresolvedId = () => [...records.current].reverse().find(id => !["installed", "failed"].includes(operationsRef.current[id]?.state ?? ""));
  const handledCheck = useRef(0);
  useEffect(() => {
    if (checkRequest > handledCheck.current && !disabled && !running) {
      handledCheck.current = checkRequest; void check(false);
    }
  }, [checkRequest, disabled, running]);
  function announce(value: UpdateCheck, background: boolean) {
    proposalRef.current = value; setProposal(value); attemptedRef.current = false; setAttempted(false);
    if (!background) setShowOperation(false);
    if (!value.updateAvailable) { onAvailable(false); if (!background) setNotice(uiMessage("当前已是最新版本（{version}）。", { version: value.currentVersion })); return; }
    onAvailable(true);
    if (!background || announced.current[value.channel] !== value.latestVersion) {
      setNotice(uiMessage("发现新版本 {version}。", { version: value.latestVersion }));
      announced.current[value.channel] = value.latestVersion;
      if (background) void client.call("desktop.notifyUpdate", { handle: value.handle }).catch(() => {});
      try { localStorage.setItem(notificationKey, JSON.stringify(announced.current)); } catch { /* Session memory still suppresses duplicate notices. */ }
    }
  }
  async function check(background: boolean) {
    if (working.current || busy.current || installing(operationsRef.current[unresolvedId() ?? ""])) return;
    working.current = true; foregroundCheck.current = !background; lastCheck.current = Date.now();
    if (!background) { setShowOperation(false); setRunning(true); onBusy(true); setNotice(uiMessage("正在检查更新…")); }
    try { const value = await client.call("updates.check", { background }); if (alive.current) announce(value, background); }
    catch (error) { if (!background && alive.current) setNotice(uiMessage("更新检查失败：", undefined, { after: uiMessage("。未判定为最新版。", undefined, { before: message(error) }) })); }
    finally { working.current = false; foregroundCheck.current = false; if (!background && alive.current) { setRunning(false); onBusy(installing(operationsRef.current[unresolvedId() ?? ""])); } }
  }
  useEffect(() => {
    alive.current = true; lastCheck.current = 0;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(recordsKey) ?? "[]");
      records.current = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string").slice(-16) : [];
      setIds(records.current);
      const notified: unknown = JSON.parse(localStorage.getItem(notificationKey) ?? "{}");
      if (notified && typeof notified === "object") for (const channel of Object.keys(channels)) {
        const version = (notified as Record<string, unknown>)[channel]; if (typeof version === "string") announced.current[channel] = version;
      }
    } catch { /* Core history remains intact when UI storage is unavailable. */ }
    const due = () => { if (document.visibilityState === "visible" && Date.now() - lastCheck.current >= 86400000) void check(true); };
    const first = window.setTimeout(due, 8000), timer = window.setInterval(due, 60000);
    document.addEventListener("visibilitychange", due);
    return () => { alive.current = false; window.clearTimeout(first); window.clearInterval(timer); document.removeEventListener("visibilitychange", due); };
  }, [client]);
  async function read(id: string) {
    const value = await client.call("updates.get", { operationId: id });
    if (alive.current) { operationsRef.current = { ...operationsRef.current, [id]: value }; setOperations(operationsRef.current); setQueryError(""); } return value;
  }
  useEffect(() => {
    if (!ids.length) return;
    let cancelled = false, timer: number | undefined;
    const poll = async () => {
      if (cancelled || !alive.current) return;
      try {
        const id = unresolvedId() ?? ids[ids.length - 1]!, value = await read(id);
        if (cancelled || !alive.current) return;
        if (installing(value)) {
          onBusy(true);
          if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
        } else { onBusy(foregroundCheck.current); if (unresolvedId()) timer = window.setTimeout(() => void poll(), 5000); }
      } catch (error) { if (!cancelled && alive.current) { setQueryError(uiMessage("更新结果暂不可用，正在重新查询；不会重复安装。", undefined, { after: message(error) })); timer = window.setTimeout(() => void poll(), 5000); } }
    };
    void poll(); return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, ids]);
  async function act(work: () => Promise<void>) {
    if (working.current || busy.current) return;
    working.current = true; setRunning(true);
    try { await work(); } catch (error) { if (alive.current) { setNotice(message(error)); onBusy(installing(operationsRef.current[unresolvedId() ?? ""])); } }
    finally { working.current = false; if (alive.current) setRunning(false); }
  }
  async function install() {
    const value = proposalRef.current;
    if (!value || !value.updateAvailable || attemptedRef.current || unresolvedId()) return;
    const id = `${session}:${crypto.randomUUID()}`, next = [...records.current, id].slice(-16);
    sessionStorage.setItem(recordsKey, JSON.stringify(next)); records.current = next;
    attemptedRef.current = true; setAttempted(true); setShowOperation(true); onBusy(true);
    // Intent is persisted before sending. A timeout leaves the same id queryable.
    try {
      const result = await client.call("updates.install", { operationId: id, handle: value.handle, accepted: true });
      if (alive.current) { setOperations(previous => ({ ...previous, [id]: result })); setNotice(uiMessage("更新已批准，下载校验完成后才交给平台安装器。")); }
    } catch (error) {
      if (error instanceof BridgeError && ["BUSY", "RESOURCE_EXPIRED", "INVALID_REQUEST", "METHOD_UNSUPPORTED", "OPERATION_UNKNOWN"].includes(error.detail.code)) {
        // A definite refusal created no installer. Keep accepted/unknown ids.
        records.current = records.current.filter(value => value !== id);
        sessionStorage.setItem(recordsKey, JSON.stringify(records.current));
        attemptedRef.current = false; setAttempted(false); setShowOperation(false);
      }
      throw error;
    } finally { if (alive.current) setIds(records.current); }
  }
  const unresolved = unresolvedId(), latestId = unresolved ?? ids[ids.length - 1], latest = latestId ? operations[latestId] : undefined;
  return <section id="software-updates" className="update-dialog" aria-label={tr("软件更新")}><h2>{tr("软件更新")}</h2>
    {proposal && <p>{tr("当前 {current} · 最新稳定发布 {latest}", { current: proposal.currentVersion, latest: proposal.latestVersion })}</p>}
    {showOperation && latest ? <><p role="status">{queryError ? msg(queryError) : tr(labels[latest.state])}</p>{latest.error && <p className="error">{latest.error.message}</p>}
      {latest.state === "indeterminate" && <p>{tr("请核对已安装版本，不会重复安装。")}</p>}
      {latest.state === "handoff" && <p>{tr("安装器已启动，请按提示完成更新。")}</p>}
      {latest.state === "handoff" && latest.managerMustQuit && <button disabled={running} onClick={() => void act(async () => { await client.call("updates.quit", { operationId: latestId! }); })}>{tr("退出并完成更新")}</button>}
    </> : <p role="status">{msg(queryError || notice)}</p>}
    {unresolved && !showOperation && <p>{tr("上次更新结果待核对，可继续检查版本；不会重复安装。")}</p>}
    {unresolved && <button disabled={running} onClick={() => void act(async () => { setShowOperation(true); await read(unresolved); })}>{tr("核对结果")}</button>}
    {proposal?.updateAvailable && !attempted && !unresolved && <div className="editor-actions">
      {proposal.installMode === "manual" ? <button disabled={disabled || running || Date.parse(proposal.expiresAt) <= Date.now()} onClick={() => void act(async () => {
        const result = await client.call("updates.openRelease", { handle: proposal.handle }); if (alive.current) setNotice(uiMessage(result.opened ? "已打开发布页。" : "无法打开发布页。"));
      })}>{tr("打开下载页面")}</button> : <><p>{tr("下载并安装新版本？安装时需要退出管理器。")}</p><button disabled={disabled || running || Date.parse(proposal.expiresAt) <= Date.now()} onClick={() => void act(install)}>{tr("下载并安装")}</button></>}
    </div>}
    {!running && (attempted || unresolved || !proposal || Date.parse(proposal.expiresAt) <= Date.now()) && <button disabled={disabled || installing(latest)} onClick={() => void check(false)}>{tr("重新检查")}</button>}
  </section>;
}
