import { useMessage, useText } from "./desktop";
import { errorMessage, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useEffect, useRef, useState } from "react";
import type { CommunityDownload, CommunityProposal, DesktopIntent, HelloResult, OperationSnapshot } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { previewParameters } from "./preview-model";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { importRefused } from "./import-operations";

const receiptsKey = "dreamskin.manager.community", operationKey = "dreamskin.manager.operation";
const pending = (value?: OperationSnapshot) => !!value && ["queued", "running", "awaitingConfirmation"].includes(value.state);
export function CommunityPanel({ client, hello, busy, canApply, incoming, onConsume, onBusy, onOperation, onIntent, onSaved }: {
  client: ManagerClient; hello: HelloResult; busy: boolean; canApply: boolean;
  onBusy(value: boolean): void; onOperation(value: OperationSnapshot): void; onIntent(id: string): void; onSaved(): void;
  incoming: DesktopIntent | null; onConsume(id: string): void;
}) {
  const tr = useText(), msg = useMessage();
  const [open, setOpen] = useState(false), [link, setLink] = useState("");
  const [proposal, setProposal] = useState<CommunityProposal | null>(null), [download, setDownload] = useState<CommunityDownload | null>(null);
  const [running, setRunning] = useState(false), [notice, setNotice] = useState<UiMessage>("");
  const [reading, setReading] = useState(false), readSequence = useRef(0);
  const [imported, setImported] = useState<OperationSnapshot | null>(null), [applied, setApplied] = useState<OperationSnapshot | null>(null);
  const alive = useRef(true), working = useRef(false), attempted = useRef(false), importId = useRef(""), applyId = useRef("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [client]);
  useEffect(() => {
    if (!incoming?.link || busy || working.current || link) return;
    const value = incoming.link;
    setLink(value); setOpen(true); onConsume(incoming.id); void inspect(value);
  }, [incoming, busy, link, onConsume]);
  useEffect(() => client.onEvent(event => {
    if (event.event !== "operation.changed") return;
    if (event.operation.id === importId.current) setImported(event.operation);
    if (event.operation.id === applyId.current) setApplied(event.operation);
  }), [client]);
  async function action(work: () => Promise<void>, query = false) {
    if (busy && !query || working.current) return;
    working.current = true; setRunning(true); onBusy(true); setNotice("");
    try { await work(); } catch (error) { if (alive.current) setNotice(errorMessage(error, "社区操作未完成。")); }
    finally { working.current = false; if (alive.current) { setRunning(false); onBusy(false); } }
  }
  async function inspect(value = link) {
    const sequence = ++readSequence.current;
    setReading(true); setNotice("");
    try {
      const result = await client.call("community.inspect", { link: value });
      if (alive.current && sequence === readSequence.current) { setProposal(result); attempted.current = false; }
    } catch (error) {
      if (alive.current && sequence === readSequence.current) setNotice(errorMessage(error, "社区操作未完成。"));
    } finally { if (alive.current && sequence === readSequence.current) setReading(false); }
  }
  function remember(kind: "import" | "apply") {
    const saved: unknown = JSON.parse(sessionStorage.getItem(receiptsKey) ?? "[]");
    const id = `${hello.backendSessionId}:${crypto.randomUUID()}`;
    sessionStorage.setItem(receiptsKey, JSON.stringify([...(Array.isArray(saved) ? saved.slice(-31) : []), { id, kind }]));
    sessionStorage.setItem(operationKey, id); return id;
  }
  async function track(id: string, initial?: OperationSnapshot) {
    let value = initial ?? await client.call("operations.get", { operationId: id });
    const deadline = Date.now() + 180000;
    while (alive.current) {
      if (id === importId.current) setImported(value); else setApplied(value);
      onOperation(value);
      if (!["queued", "running"].includes(value.state)) return value;
      if (Date.now() >= deadline) throw new UiMessageError(uiMessage("处理仍在继续，稍后核对结果；不会重复提交。"));
      await new Promise<void>(resolve => window.setTimeout(resolve, 1500));
      if (alive.current) value = await client.call("operations.get", { operationId: id });
    }
    throw new UiMessageError(uiMessage("窗口已关闭；已接受的操作继续处理。"));
  }
  async function savePackage(value: CommunityDownload) {
    if (importId.current) return;
    const id = remember("import"); importId.current = id;
    let initial: OperationSnapshot;
    try { initial = await client.call("community.import", { operationId: id, handle: value.source.handle }); }
    finally { if (alive.current) onIntent(id); }
    const result = await track(id, initial);
    if (result.state === "succeeded") { onSaved(); setNotice(uiMessage("主题已保存，可选择应用。")); }
    else setNotice(uiMessage("导入未确认成功，请核对主题库。"));
  }
  async function downloadAndSave() {
    if (!proposal || attempted.current) return;
    attempted.current = true;
    const value = await client.call("community.download", { handle: proposal.handle, accepted: true });
    if (!alive.current) return;
    setDownload(value); await savePackage(value);
  }
  async function apply() {
    if (!canApply || imported?.state !== "succeeded" || applyId.current && !retryApply) return;
    const id = remember("apply"); applyId.current = id;
    setApplied(null);
    let initial: OperationSnapshot;
    try { initial = await client.call("community.apply", { operationId: id, importOperationId: importId.current }); }
    catch (error) { if (importRefused(error)) applyId.current = ""; throw error; }
    finally { if (alive.current) onIntent(id); }
    const result = await track(id, initial);
    if (result.state !== "awaitingConfirmation") setNotice(uiMessage(result.state === "succeeded" ? "社区主题已应用并核验。" : "主题已保存，应用未完成；请核对当前外观。"));
  }
  function close() {
    if (working.current || pending(imported ?? undefined) || pending(applied ?? undefined)) return;
    readSequence.current++; setReading(false);
    if (download) void client.call("packages.release", { handles: [download.source.handle] }).catch(() => {});
    setOpen(false); setLink(""); setProposal(null); setDownload(null); setImported(null); setApplied(null); setNotice("");
    attempted.current = false; importId.current = ""; applyId.current = "";
  }
  const retryApply = !!applied && applied.id === applyId.current && ["failed", "cancelled"].includes(applied.state);
  const locked = busy || running || reading, unresolved = importId.current && !imported || applyId.current && !applied || imported?.state === "indeterminate" || applied?.state === "indeterminate";
  if (!open) return null;
  return <ConfirmationDialog title={tr("社区主题")} onCancel={close}><section className="community-panel"><h2>{tr("社区主题")}</h2>
    {proposal && <><h3>{proposal.metadata.name}</h3><p>{proposal.metadata.authorDisplayName} · {proposal.metadata.version}</p><p>{tr("许可")}：{proposal.metadata.license}</p>
      {!download && <button disabled={locked || attempted.current || Date.parse(proposal.expiresAt) <= Date.now()} onClick={() => void action(downloadAndSave)}>{tr("下载并保存")}</button>}</>}
    {!download && !running && !importId.current && <button disabled={locked} onClick={() => void inspect()}>{tr("重新读取主题信息")}</button>}
    {download && <><MediaPreview client={client} target={{ kind: "package", handle: download.source.handle }} name={download.details.name} parameters={previewParameters(download.details.storedParameters)} visible={open} mediaKind="unknown" />
      {download.details.license && <details><summary>{tr("查看包内许可")}</summary><pre className="package-license">{download.details.license}</pre></details>}
      {!importId.current && <button disabled={locked} onClick={() => void action(() => savePackage(download))}>{tr("保存主题")}</button>}
      <button disabled={locked || !canApply || imported?.state !== "succeeded" || !!applyId.current && !retryApply} onClick={() => void action(apply)}>{tr("应用皮肤")}</button>
    </>}
    {unresolved && <button disabled={running} onClick={() => void action(async () => { const id = applyId.current || importId.current; if (id) await track(id); }, true)}>{tr("核对结果")}</button>}
    {notice && <p className="notice" role="status">{msg(notice)}</p>}
    <div className="editor-actions"><button disabled={running || pending(imported ?? undefined) || pending(applied ?? undefined)} onClick={close}>{tr("关闭")}</button></div>
  </section></ConfirmationDialog>;
}
