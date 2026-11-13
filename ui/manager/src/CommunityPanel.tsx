import { useEffect, useRef, useState } from "react";
import type { AppearanceOperation, CommunityCompatibility, CommunityLocalTheme, CommunityProposal, DesktopIntent, HelloResult, OperationSnapshot, ThemeRef } from "../../../contracts/manager.mjs";
import { applicationNames, type ApplicationTarget } from "./ApplicationTarget";
import type { ManagerClient } from "./client";
import { useMessage, useText } from "./desktop";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { diagnosticMessage, errorMessage, joinMessages, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { communityCompatibilityMessages, mergeCommunityCompatibility } from "./community-compatibility";

export interface CommunityActionRequest { id: string; version: string; action: "download" | "apply"; application: ApplicationTarget; compatibility?: CommunityCompatibility }
export interface CommunityDownloadUpdate { version: string; downloaded: CommunityLocalTheme | null }
const receiptsKey = "dreamskin.manager.community", operationKey = "dreamskin.manager.operation";
const pending = (value: OperationSnapshot | null) => !!value && ["queued", "running", "awaitingConfirmation"].includes(value.state);

export function CommunityPanel({ client, hello, busy, canApply, incoming, request, onConsume, onConsumeRequest, onBusy, onOperation, onIntent, onSaved, onDownloadState, onNotice, onApplyTheme }: {
  client: ManagerClient; hello: HelloResult; busy: boolean; canApply: boolean; incoming: (DesktopIntent & { application: ApplicationTarget }) | null; request: CommunityActionRequest | null;
  onApplyTheme(theme: ThemeRef, revision: string, application: ApplicationTarget): Promise<OperationSnapshot | AppearanceOperation>;
  onConsume(id: string): void; onConsumeRequest(id: string): void; onBusy(value: boolean): void;
  onOperation(value: OperationSnapshot): void; onIntent(id: string): void; onSaved(): void;
  onDownloadState(version: string, downloaded: CommunityLocalTheme | null): void; onNotice(value: UiMessage): void;
}) {
  const tr = useText(), msg = useMessage();
  const [link, setLink] = useState(""), [proposal, setProposal] = useState<CommunityProposal | null>(null);
  const [compatibility, setCompatibility] = useState<CommunityCompatibility>();
  const [notice, setNotice] = useState<UiMessage>(""), [running, setRunning] = useState(false), [reading, setReading] = useState(false);
  const [operation, setOperation] = useState<OperationSnapshot | null>(null);
  const [linkApplication, setLinkApplication] = useState<ApplicationTarget>("codex");
  const alive = useRef(true), working = useRef(false), sequence = useRef(0), operationId = useRef("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, [client]);
  useEffect(() => client.onEvent(event => {
    if (event.event === "operation.changed" && event.operation.id === operationId.current) setOperation(event.operation);
  }), [client]);
  useEffect(() => {
    if (!incoming?.link || busy || working.current || link || request) return;
    setLink(incoming.link); setLinkApplication(incoming.application); onConsume(incoming.id); void inspect(incoming.link, true);
  }, [incoming, busy, link, request, onConsume]);
  useEffect(() => {
    if (!request || busy || working.current || link) return;
    onConsumeRequest(request.id);
    void action(() => install(request.version, request.action, request.application, request.compatibility));
  }, [request, busy, link, onConsumeRequest]);
  function tell(value: UiMessage) { if (alive.current) { setNotice(value); onNotice(value); } }
  async function action(work: () => Promise<void>) {
    if (busy || working.current) return;
    sequence.current++; setReading(false);
    working.current = true; setRunning(true); onBusy(true); setOperation(null); operationId.current = ""; tell("");
    try { await work(); }
    catch (error) { tell(errorMessage(error, "社区操作未完成。")); }
    finally { working.current = false; if (alive.current) { setRunning(false); onBusy(false); } }
  }
  async function inspect(value = link, preferLocal = false) {
    const current = ++sequence.current; setReading(true); setNotice("");
    try {
      if (preferLocal) {
        const version = /^dreamskin:\/\/apply\?version=(ver_[a-z0-9]{8,64})$/.exec(value)?.[1];
        const local = version ? await client.call("community.local", { version }) : null;
        if (!alive.current || current !== sequence.current) return;
        if (local) { setProposal(null); setCompatibility(local.compatibility); return; }
      }
      const next = await client.call("community.inspect", { link: value });
      if (alive.current && current === sequence.current) { setProposal(next); setCompatibility(mergeCommunityCompatibility({ applyCompatible: next.metadata.applyCompatible }, next.metadata.compatibility)); }
    } catch (error) { if (alive.current && current === sequence.current) tell(errorMessage(error, "社区操作未完成。")); }
    finally { if (alive.current && current === sequence.current) setReading(false); }
  }
  function remember(kind: "import") {
    const saved: unknown = JSON.parse(sessionStorage.getItem(receiptsKey) ?? "[]");
    const id = `${hello.backendSessionId}:${crypto.randomUUID()}`;
    sessionStorage.setItem(receiptsKey, JSON.stringify([...(Array.isArray(saved) ? saved.slice(-31) : []), { id, kind }]));
    sessionStorage.setItem(operationKey, id); operationId.current = id; return id;
  }
  async function track(value: OperationSnapshot) {
    const deadline = Date.now() + 180000;
    while (alive.current) {
      setOperation(value); onOperation(value);
      if (!["queued", "running"].includes(value.state)) return value;
      if (Date.now() >= deadline) throw new UiMessageError(uiMessage("处理仍在继续，稍后核对结果；不会重复提交。"));
      await new Promise<void>(resolve => window.setTimeout(resolve, 1500));
      if (alive.current) value = await client.call("operations.get", { operationId: value.id });
    }
    throw new UiMessageError(uiMessage("窗口已关闭；已接受的操作继续处理。"));
  }
  async function install(version: string, action: CommunityActionRequest["action"], application: ApplicationTarget, declared?: CommunityCompatibility) {
    if (action === "apply" && (!canApply || !hello.capabilities.methods.includes(application === "codex" ? "skin.apply" : `${application}.apply`))) return;
    let declaration = declared ?? (proposal?.metadata.id === version ? mergeCommunityCompatibility({ applyCompatible: proposal.metadata.applyCompatible }, proposal.metadata.compatibility) : undefined);
    const report = (value: UiMessage) => tell(joinMessages([value, ...communityCompatibilityMessages(declaration, hello.platform, hello.versions.application)], " "));
    let local = await client.call("community.local", { version });
    declaration = mergeCommunityCompatibility(declaration, local?.compatibility); setCompatibility(declaration);
    onDownloadState(version, local);
    if (!local) {
      report(uiMessage("正在下载社区主题…"));
      const info = proposal?.metadata.id === version && Date.parse(proposal.expiresAt) > Date.now() ? proposal :
        await client.call("community.inspect", { link: `dreamskin://apply?version=${version}` });
      declaration = mergeCommunityCompatibility(declaration, mergeCommunityCompatibility({ applyCompatible: info.metadata.applyCompatible }, info.metadata.compatibility));
      setCompatibility(declaration); report(uiMessage("正在下载社区主题…"));
      setProposal(null);
      const download = await client.call("community.download", { handle: info.handle, accepted: true });
      declaration = mergeCommunityCompatibility(declaration, download.details.compatibility); setCompatibility(declaration);
      report(uiMessage("正在下载社区主题…"));
      try {
        const id = remember("import"); let initial: OperationSnapshot;
        try { initial = await client.call("community.import", { operationId: id, handle: download.source.handle }); }
        finally { if (alive.current) onIntent(id); }
        const saved = await track(initial);
        if (saved.state !== "succeeded" || !saved.resultTheme || !saved.resultRevision) {
          report(saved.error ? diagnosticMessage(saved.error) : uiMessage("社区主题下载未确认完成，请核对操作结果。")); return;
        }
        local = { version, packageSha256: download.origin?.packageSha256 ?? info.metadata.packageSha256, theme: saved.resultTheme, revision: saved.resultRevision, compatibility: declaration };
        onSaved(); onDownloadState(version, local);
      } finally { void client.call("packages.release", { handles: [download.source.handle] }).catch(() => {}); }
    }
    if (!alive.current) return;
    if (action === "download") { report(uiMessage("社区主题已下载。")); return; }
    report(uiMessage("正在应用社区主题…"));
    const applied = await onApplyTheme(local.theme, local.revision, application);
    if ("target" in applied) {
      report(applied.error ? diagnosticMessage(applied.error) : uiMessage(applied.state === "succeeded" ? applied.snapshot.renderer === "applied" ?
        "社区主题已应用并核验。" : "操作已完成，请刷新确认当前外观。" : "结果待核对"));
    } else {
      operationId.current = applied.id;
      const result = await track(applied);
      if (result.state !== "awaitingConfirmation") report(result.error ? diagnosticMessage(result.error) : uiMessage(result.state === "succeeded" ? result.effects.rendererApplied === true ?
        "社区主题已应用并核验。" : "操作已完成，请刷新确认当前外观。" : "社区主题已下载，应用未完成；请核对当前外观。"));
    }
  }
  function close() {
    if (working.current || pending(operation)) return;
    sequence.current++; setReading(false); setLink(""); setProposal(null); setCompatibility(undefined); setNotice(""); setOperation(null);
  }
  if (!link) return null;
  const locked = busy || running || pending(operation), version = /^dreamskin:\/\/apply\?version=(ver_[a-z0-9]{8,64})$/.exec(link)?.[1];
  return <ConfirmationDialog title={tr("社区主题")} onCancel={close}><section className="community-panel"><h2>{tr("社区主题")}</h2>
    {proposal && <><h3>{proposal.metadata.name}</h3><p>{proposal.metadata.authorDisplayName} · {proposal.metadata.version}</p><p>{tr("许可")}：{proposal.metadata.license}</p></>}
    {communityCompatibilityMessages(compatibility, hello.platform, hello.versions.application).map((value, index) => <p className="muted" key={index}>{msg(value)}</p>)}
    <p className="muted">{tr("未下载时会先下载并应用；已下载时直接应用本地副本。")}</p>
    <div className="editor-actions"><button className="primary" disabled={locked || !canApply || !hello.capabilities.methods.includes(linkApplication === "codex" ? "skin.apply" : `${linkApplication}.apply`) || !version} onClick={() => { if (version) void action(() => install(version, "apply", linkApplication)); }}>{tr(`应用到 ${applicationNames[linkApplication]}`)}</button>
      <button disabled={locked || !version} onClick={() => { if (version) void action(() => install(version, "download", linkApplication)); }}>{tr("下载主题")}</button>
      {!running && <button disabled={locked || reading} onClick={() => void inspect()}>{tr("重新读取主题信息")}</button>}</div>
    {notice && <p className="notice" role="status">{msg(notice)}</p>}
    <div className="editor-actions"><button disabled={running || pending(operation)} onClick={close}>{tr("关闭")}</button></div>
  </section></ConfirmationDialog>;
}
