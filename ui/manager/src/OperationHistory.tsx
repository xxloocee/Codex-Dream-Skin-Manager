import { useMessage } from "./desktop";
import { diagnosticMessage, errorMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { useText } from "./desktop";
import { useState } from "react";
import type { OperationSnapshot } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";

export function OperationHistory({ client, disabled, onView }: { client: ManagerClient; disabled: boolean; onView: (value: OperationSnapshot) => void }) {
  const tr = useText(), msg = useMessage();
  const [values, setValues] = useState<OperationSnapshot[]>([]), [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState<UiMessage>(""), [warnings, setWarnings] = useState<string[]>([]);
  async function load(more = false) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try {
      const page = await client.call("operations.list", { limit: 20, ...(more && cursor ? { cursor } : {}) });
      setValues(previous => more ? [...previous, ...page.operations] : page.operations); setCursor(page.nextCursor);
      setWarnings(page.warnings.map(value => value.message));
    } catch (error) { setCursor(undefined); setError(errorMessage(error, "记录读取失败，请重新刷新。")); }
    finally { setBusy(false); }
  }
  return <section className="import-panel" aria-label={tr("操作历史")}><h2>{tr("操作历史")}</h2>
    <p className="muted">{tr("历史仅供查询。结果待核对的操作不会自动重放，旧窗口的确认不能继续使用。")}</p>
    <button disabled={busy || disabled} onClick={() => void load()}>{tr("刷新操作记录")}</button>
    {values.map(value => <div className="import-result" key={value.id}>
      <strong>{msg(diagnosticMessage(value.method))} · {value.state === "indeterminate" ? tr("结果待核对") : value.state === "cancelled" ? tr("已取消") : value.state === "succeeded" ? tr("已完成") : value.state === "failed" ? tr("未完成") : tr("处理中 / 等待确认")}</strong>
      <small>{new Date(value.startedAt).toLocaleString()} · {value.theme.id}</small>
      <button disabled={disabled} onClick={() => onView(value)}>{tr("查看结果")}</button>
    </div>)}
    {cursor && <button disabled={busy || disabled} onClick={() => void load(true)}>{tr("更多记录")}</button>}
    {warnings.map((value, index) => <p className="notice" key={index}>{msg(diagnosticMessage(value))}</p>)}
    {error && <p className="error" role="alert">{msg(error)}</p>}
  </section>;
}
