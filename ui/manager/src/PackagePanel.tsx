import { useMessage } from "./desktop";
import { diagnosticMessage, errorMessage, joinMessages, uiMessage, UiMessageError } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useText } from "./desktop";
import { useEffect, useRef, useState } from "react";
import type { HelloResult, OperationSnapshot, PackageDetails, SourceGrant } from "../../../contracts/manager.mjs";
import { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { previewParameters } from "./preview-model";
import { Select } from "./Select";

const receiptsKey = "dreamskin.manager.packages", operationKey = "dreamskin.manager.operation";
const text = (error: unknown) => errorMessage(error, "主题包操作未完成。");
const pending = (value: OperationSnapshot) => ["queued", "running", "awaitingConfirmation"].includes(value.state);
interface Receipt { name: string; id: string }
interface ResultRow extends Receipt { operation?: OperationSnapshot; error?: UiMessage }
const states: Record<OperationSnapshot["state"], string> = { queued: "已排队", running: "正在导入", awaitingConfirmation: "等待确认", succeeded: "已保存", failed: "失败", cancelled: "已取消", indeterminate: "结果待核对" };

function PackagePreview({ client, source, visible }: { client: ManagerClient; source: SourceGrant; visible: boolean }) {
  const tr = useText(), msg = useMessage();
  const [details, setDetails] = useState<PackageDetails | null>(null);
  const [error, setError] = useState<UiMessage>(""), [attempt, retry] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let active = true; setError("");
    void client.call("packages.inspect", { handle: source.handle }).then(value => { if (active) setDetails(value); }).catch(error => { if (active) setError(text(error)); });
    return () => { active = false; };
  }, [client, source, attempt, visible]);
  return <div className="import-editor"><MediaPreview client={client} target={{ kind: "package", handle: source.handle }} name={details?.name ?? source.name}
    parameters={details ? previewParameters(details.storedParameters) : null} visible={visible} mediaKind="unknown" />
    <div>{error && <p className="error" role="alert">{msg(error)}<button onClick={() => retry(value => value + 1)}>{tr("重新读取包信息")}</button></p>}
      {details && <><h3>{details.name}</h3><p className="muted">{details.format === "cdskin" ? tr("通用 .cdskin") : details.format === "official" ? tr("Mac 官方格式 ZIP") : tr("Mac 简化 ZIP")} · {details.storageCategory} · {details.tags.join(" / ") || tr("无标签")}</p>
        <p className="muted">{details.hasCss ? tr("含 Safe CSS") : tr("无附加 CSS")}{tr("。此处只预览素材；实际背景与样式需应用后核验。")}</p>
        {details.format === "official" && <p className="notice">{tr("格式校验不代表发布者身份已确认。")}{details.signatureIgnored ? tr("包中签名未验证。") : tr("此包没有已验证的签名。")}</p>}
        <details><summary>{details.license === null ? tr("包内未附 LICENSE.txt") : tr("查看包内许可证")}</summary><pre className="package-license">{details.license ?? tr("请自行确认素材与主题的使用授权。")}</pre></details>
      </>}
    </div></div>;
}

export function PackagePanel({ client, hello, busy, visible, selectionRequest = 0, onBusy, onOperation, onSaved }: {
  client: ManagerClient; hello: HelloResult; busy: boolean; visible: boolean; selectionRequest?: number; onBusy(value: boolean): void;
  onOperation(value: OperationSnapshot): void; onSaved(): void;
}) {
  const tr = useText(), msg = useMessage();
  const [sources, setSources] = useState<SourceGrant[]>([]), [selected, setSelected] = useState("");
  const [results, setResults] = useState<ResultRow[]>([]), [notice, setNotice] = useState<UiMessage>(""), [running, setRunning] = useState(false);
  const alive = useRef(true), activeRun = useRef(false), stop = useRef(false), attempted = useRef(new Set<string>()), receipts = useRef<Receipt[]>([]);
  const source = sources.find(value => value.handle === selected);
  const handledSelection = useRef(0);
  useEffect(() => {
    if (selectionRequest > handledSelection.current && visible && !busy && !activeRun.current) {
      handledSelection.current = selectionRequest; void choose(true);
    }
  }, [selectionRequest, visible, busy]);
  function update(row: ResultRow) { if (alive.current) setResults(previous => [...previous.filter(value => value.id !== row.id), row]); }
  async function track(row: Receipt, initial?: OperationSnapshot, announce = true): Promise<OperationSnapshot> {
    let value = initial ?? await client.call("operations.get", { operationId: row.id });
    while (true) {
      if (!alive.current) throw new UiMessageError(uiMessage("窗口已关闭；已接受的导入继续完成。"));
      update({ ...row, operation: value }); if (announce) onOperation(value);
      if (!pending(value)) return value;
      await new Promise<void>(resolve => window.setTimeout(resolve, 1500)); value = await client.call("operations.get", { operationId: row.id });
    }
  }
  useEffect(() => {
    alive.current = true;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(receiptsKey) ?? "[]");
      if (Array.isArray(saved)) receipts.current = saved.filter((row): row is Receipt => !!row && typeof row.name === "string" && typeof row.id === "string").slice(-32);
      setResults(receipts.current);
      void (async () => { for (const row of receipts.current) {
        if (!alive.current) return;
        try { await track(row, undefined, false); } catch (error) { update({ ...row, error: text(error) }); }
      } })();
    } catch { setNotice(uiMessage("无法恢复主题包记录，请先核对主题库。")); }
    return () => { alive.current = false; stop.current = true; };
  }, [client]);
  async function choose(quickImport = false) {
    if (busy || activeRun.current) return;
    activeRun.current = true; stop.current = false; setRunning(true); onBusy(true); setNotice("");
    try {
      const selection = await client.call("files.selectPackages", { multiple: true }); if (!alive.current || selection.cancelled) return;
      if (selection.sources.length) {
        const old = sources.map(value => value.handle); setSources(selection.sources); setSelected(selection.sources[0]!.handle); attempted.current.clear();
        if (old.length) void client.call("packages.release", { handles: old }).catch(() => {});
      }
      setNotice(selection.failures.length ? joinMessages(selection.failures.map(value => uiMessage("{name}：{detail}", { name: value.name, detail: diagnosticMessage(value.error) })), "；") : uiMessage(selection.sources.length ? "主题包已选择，可查看内容后导入。" : "没有可导入的包。"));
      if (quickImport && selection.sources.length) {
        for (const value of selection.sources) {
          if (!alive.current || stop.current) break;
          const result = await importOne(value);
          if (result.state === "indeterminate") { stop.current = true; setNotice(uiMessage("此项结果未知，已停止后续提交；请核对操作记录与主题库。")); }
        }
        if (alive.current && !stop.current) setNotice(uiMessage("快捷导入处理结束；逐项结果如下。导入仅保存主题库。", undefined,
          { after: joinMessages(selection.failures.map(value => uiMessage("{name}：{detail}", { name: value.name, detail: diagnosticMessage(value.error) })), "；") }));
      }
    } catch (error) { if (alive.current) setNotice(text(error)); }
    finally { activeRun.current = false; if (alive.current) { setRunning(false); onBusy(false); } }
  }
  async function importOne(value: SourceGrant): Promise<OperationSnapshot> {
    const row: Receipt = { name: value.name, id: `${hello.backendSessionId}:${crypto.randomUUID()}` };
    receipts.current = [...receipts.current, row].slice(-32);
    sessionStorage.setItem(receiptsKey, JSON.stringify(receipts.current)); sessionStorage.setItem(operationKey, row.id);
    attempted.current.add(value.handle); update(row);
    try {
      const initial = await client.call("themes.importPackage", { operationId: row.id, handle: value.handle });
      const result = await track(row, initial); if (result.state === "succeeded") onSaved(); return result;
    } catch (error) { update({ ...row, error: uiMessage(" 未自动重试，请查询此操作。", undefined, { before: text(error) }) }); throw error; }
  }
  async function run(batch: boolean) {
    if (busy || activeRun.current || (!batch && !source)) return;
    activeRun.current = true; stop.current = false; setRunning(true); onBusy(true); setNotice("");
    try {
      for (const value of batch ? sources : [source!]) {
        if (!alive.current || stop.current) break; if (attempted.current.has(value.handle)) continue;
        const result = await importOne(value);
        if (result.state === "indeterminate") { stop.current = true; setNotice(uiMessage("此项结果未知，已停止后续提交；请核对操作记录与主题库。")); }
      }
      if (alive.current && !stop.current) setNotice(uiMessage("处理结束。导入仅保存主题库，应用需另行操作。"));
    } catch (error) { if (alive.current) setNotice(uiMessage("已停止后续提交：", undefined, { after: text(error) })); }
    finally { activeRun.current = false; if (alive.current) { setRunning(false); onBusy(false); } }
  }
  async function clear() {
    if (busy || activeRun.current) return;
    const handles = sources.map(value => value.handle); setSources([]); setSelected(""); attempted.current.clear();
    try { if (handles.length) await client.call("packages.release", { handles }); } catch (error) { if (alive.current) setNotice(text(error)); }
  }
  return <section className="import-panel" aria-label={tr("主题包导入")}><h2>{tr("导入主题包")}</h2>
    <p className="muted">{tr("支持 .cdskin{mac}，单包最多 160 MiB，每次最多 32 项。样式与许可证随包保留。", { mac: hello.platform === "macos" ? tr(" 和 Mac ZIP") : "" })}</p>
    <div className="editor-actions"><button disabled={busy || running} onClick={() => void choose()}>{tr("选择主题包")}</button>
      <button disabled={busy || running || !source || attempted.current.has(source.handle)} onClick={() => void run(false)}>{tr("导入当前包")}</button>
      <button disabled={busy || running || !sources.some(value => !attempted.current.has(value.handle))} onClick={() => void run(true)}>{tr("逐项导入全部（自动去重）")}</button>
      <button disabled={!running} onClick={() => { stop.current = true; setNotice(uiMessage("将在当前项结束后停止，已接受任务继续完成。")); }}>{tr("停止后续导入")}</button>
      <button disabled={busy || running || !sources.length} onClick={() => void clear()}>{tr("清除选择")}</button></div>
    {notice && <p className="notice" role="status">{msg(notice)}</p>}
    {!!sources.length && <label>{tr("查看包")} <Select aria-label={tr("查看包")} disabled={busy || running} value={selected}
      onChange={setSelected} options={sources.map(value => ({ value: value.handle, label: value.name }))} /></label>}
    {source && <PackagePreview key={source.handle} client={client} source={source} visible={visible} />}
    {!!results.length && <ul className="import-results" aria-label={tr("主题包逐项结果")}>{results.map(row => <li key={row.id}><strong>{row.name}</strong> · {row.error ? msg(row.error) : (row.operation ? row.operation.disposition === "duplicate" ? tr("内容与许可相同，返回已有主题") : tr(states[row.operation.state]) : tr("正在查询"))}
      {row.operation?.error && <p className="muted">{msg(diagnosticMessage(row.operation.error))}</p>}{row.operation?.resultTheme && <small>{row.operation.resultTheme.id}</small>}
      <button disabled={running} onClick={() => { void track(row, undefined, false).catch(error => update({ ...row, error: text(error) })); }}>{tr("查询记录")}</button></li>)}</ul>}
  </section>;
}
