import type { Readable, Writable } from "node:stream";
import { ContractError, failure, MAX_MESSAGE_BYTES, parseRequest, PROTOCOL, record, responseId } from "../contracts/manager.mjs";
import type { ManagerResponse, ManagerEvent } from "../contracts/manager.mjs";
import type { ManagerService } from "./manager-service.mjs";

export async function send(output: Writable, response: ManagerResponse | { protocol: string; kind: "native.response"; requestId: string | null; ok: boolean; result?: unknown; error?: unknown }): Promise<void> {
  let text = JSON.stringify(response);
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
    const error = failure(response.requestId, new ContractError("BUSY", "The result exceeded the message limit; reduce the page size."));
    text = JSON.stringify(response.kind === "native.response" ? { ...error, kind: "native.response" } : error);
  }
  // Completion callback propagates stdout backpressure to the serial input reader.
  await new Promise<void>((resolve, reject) => output.write(text + "\n", "utf8", error => error ? reject(error) : resolve()));
}
export async function serve(input: Readable, output: Writable, service: ManagerService): Promise<void> {
  service.attachEvents(async (event: ManagerEvent) => {
    const text = JSON.stringify(event);
    if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) return;
    await new Promise<void>((resolve, reject) => output.write(text + "\n", "utf8", error => error ? reject(error) : resolve()));
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // Keep only a small recent window for duplicate detection. A manager window
  // can stay open for days; a lifetime-sized set would eventually disconnect
  // an otherwise healthy session because of ordinary polling.
  const ids = new Set<string>();
  const recentIds: string[] = [];
  const remember = (id: string): void => {
    ids.add(id); recentIds.push(id);
    if (recentIds.length > 1024) ids.delete(recentIds.shift()!);
  };
  let greeted = false;
  const readJobs = new Map<string, Promise<void>>();
  let outputError: Error | undefined;
  const line = async (bytes: Buffer): Promise<boolean> => {
    if (service.isClosing) return false;
    let value: unknown, id: string | null = null, native = false;
    try {
      try { value = JSON.parse(decoder.decode(bytes)); }
      catch { throw new ContractError("INVALID_REQUEST", "Expected one UTF-8 JSON request per line."); }
      id = responseId(value);
      native = record(value) && value.kind === "native.request";
      if (id !== null) {
        if (ids.has(id)) throw new ContractError("INVALID_REQUEST", "Request IDs must be unique within a connection.");
        remember(id);
      }
      if (native) {
        if (!greeted || id === null) throw new ContractError("INVALID_REQUEST", "A native request requires a current handshake.");
        const result = await service.executeNative(value);
        await send(output, { protocol: PROTOCOL, kind: "native.response", requestId: id, ok: true, result });
        return true;
      }
      const request = parseRequest(value);
      if (!greeted && request.method !== "system.hello") throw new ContractError("INVALID_REQUEST", "system.hello must precede other methods.");
      // Independent probes must not hold up theme operations while waiting for
      // the runtime or network. Mutations keep their serial admission order.
      if (["status.get", "updates.check", "community.inspect"].includes(request.method)) {
        if (readJobs.has(request.method)) throw new ContractError("BUSY", "This read request is already in progress.", true);
        const job = (async () => {
          let response: ManagerResponse;
          try {
            const result = await service.execute(request);
            response = { protocol: PROTOCOL, kind: "response", requestId: request.requestId, ok: true, result };
          } catch (error) { response = failure(request.requestId, error); }
          await send(output, response);
        })().catch(error => {
          outputError = error instanceof Error ? error : new Error("The manager output closed.");
          input.destroy();
        }).finally(() => { readJobs.delete(request.method); });
        readJobs.set(request.method, job);
        return true;
      }
      const result = await service.execute(request);
      if (request.method === "system.hello") greeted = true;
      await send(output, { protocol: PROTOCOL, kind: "response", requestId: request.requestId, ok: true, result });
      if (service.isClosing) return false;
    } catch (error) { const response = failure(id, error); await send(output, native ? { ...response, kind: "native.response" } : response); }
    return true;
  };
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      let start = 0;
      while (start < bytes.length) {
        const newline = bytes.indexOf(10, start);
        const end = newline < 0 ? bytes.length : newline;
        if (pending.length + end - start > MAX_MESSAGE_BYTES) {
          await send(output, failure(null, new ContractError("INVALID_REQUEST", "The request exceeded the message limit.")));
          return; // Do not buffer or parse the remainder of an oversized connection.
        }
        pending = Buffer.concat([pending, bytes.subarray(start, end)]);
        if (newline < 0) break;
        const payload = pending.length && pending[pending.length - 1] === 13 ? pending.subarray(0, -1) : pending;
        pending = Buffer.alloc(0);
        if (!await line(payload)) return;
        start = newline + 1;
      }
    }
    if (pending.length) await send(output, failure(null, new ContractError("INVALID_REQUEST", "An NDJSON request must end with a newline.")));
  } finally {
    // Also drain on EOF, oversized input, session.close and native shutdown
    // before main closes the service and its resource owners.
    await Promise.all(readJobs.values());
    if (outputError) throw outputError;
  }
}
