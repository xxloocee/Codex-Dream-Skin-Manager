import { useEffect, useRef, useState } from "react";
import type { HelloResult, OperationSnapshot, SourceGrant } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import type { UiMessage } from "./ui-message";
import { diagnosticMessage, errorMessage, joinMessages, uiMessage } from "./ui-message";
import { importParameters } from "./preview-model";
import { rememberImport, sourceName, trackImport } from "./import-operations";
import { useText } from "./desktop";

// A console command, independent of the single-theme import draft.
export function QuickImport({ client, hello, request, busy, onBusy, onOperation, onIntent, onSaved, onNotice }: {
  client: ManagerClient; hello: HelloResult; request: { sequence: number; packages: boolean }; busy: boolean;
  onBusy(value: boolean): void; onOperation(value: OperationSnapshot): void; onIntent(id: string): void;
  onSaved(): void; onNotice(value: UiMessage): void;
}) {
  const tr = useText(), [running, setRunning] = useState(false);
  const alive = useRef(true), handled = useRef(0), working = useRef(false), stop = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, [client]);
  useEffect(() => {
    if (request.sequence <= handled.current || busy || working.current) return;
    handled.current = request.sequence; void run(request.packages);
  }, [request, busy]);
  async function run(packages: boolean) {
    working.current = true; stop.current = false; setRunning(true); onBusy(true);
    const releasable = new Set<string>();
    let sources: SourceGrant[] = [], completed = 0, failed = 0;
    const failures: UiMessage[] = [];
    try {
      const selection = packages ? await client.call("files.selectPackages", { multiple: true }) : await client.call("files.select", { multiple: true });
      sources = selection.sources; for (const source of sources) releasable.add(source.handle);
      if (selection.cancelled) { onNotice(uiMessage("已取消导入。")); return; }
      failures.push(...selection.failures.map(value => uiMessage("{name}：{detail}", { name: value.name, detail: diagnosticMessage(value.error) }))); failed += selection.failures.length;
      for (const source of sources) {
        if (!alive.current || stop.current) break;
        onNotice(uiMessage("正在导入 {current}/{total}：{name}", { current: completed + failed + 1 - selection.failures.length, total: sources.length, name: source.name }));
        const id = rememberImport(hello.backendSessionId, source.name, packages);
        // Retain inputs with an unknown outcome. The backend owns accepted inputs.
        releasable.delete(source.handle);
        let initial: OperationSnapshot;
        try { initial = packages ? await client.call("themes.importPackage", { operationId: id, handle: source.handle })
          : await client.call("themes.create", { operationId: id, handle: source.handle, name: sourceName(source), patch: { parameters: importParameters } }); }
        finally { if (alive.current) onIntent(id); }
        const result = await trackImport(client, initial, () => alive.current, onOperation);
        if (result.state === "indeterminate") { stop.current = true; failures.push(uiMessage("{name}：{detail}", { name: source.name, detail: result.error ? diagnosticMessage(result.error) : { key: "结果待核对" } })); break; }
        releasable.add(source.handle);
        if (result.state === "succeeded") { completed++; onSaved(); }
        else { failed++; failures.push(uiMessage("{name}：{detail}", { name: source.name, detail: result.error ? diagnosticMessage(result.error) : { key: "操作未完成" } })); }
      }
      if (alive.current) onNotice(uiMessage(stop.current ? "导入已停止，已保存 {count} 个主题。" : "导入结束，已保存 {count} 个主题。", { count: completed }, failures.length ? { after: joinMessages(failures, "；") } : {}));
    } catch (error) { if (alive.current) onNotice(uiMessage("导入已停止，已保存 {count} 个主题。", { count: completed }, { after: errorMessage(error, "请稍后核对主题库；不会重复提交。") })); }
    finally {
      const handles = [...releasable];
      if (handles.length) void client.call(packages ? "packages.release" : "sources.release", { handles }).catch(() => {});
      working.current = false; if (alive.current) { setRunning(false); onBusy(false); }
    }
  }
  return running ? <button onClick={() => { stop.current = true; onNotice(uiMessage("将在当前项结束后停止；已接受的任务继续完成。")); }}>{tr("停止后续导入")}</button> : null;
}
