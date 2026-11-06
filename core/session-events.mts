import { PROTOCOL } from "../contracts/manager.mjs";
import type { ManagerEvent, ManagerSnapshot, OperationSnapshot } from "../contracts/manager.mjs";
type EventBody = { event: "status.changed"; snapshot: ManagerSnapshot } | { event: "operation.changed"; operation: OperationSnapshot } | { event: "status.invalidated" } | { event: "session.closing" };
export class SessionEvents {
  private enabled = false;
  private observationActive = true;
  private closing = false;
  private generation = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pending = new Map<string, EventBody>();
  private writing: Promise<void> | null = null;
  private observing: Promise<void> | null = null;
  private digest = "";
  private sink: ((event: ManagerEvent) => Promise<void>) | undefined;
  constructor(private readonly session: string, private readonly capture: () => Promise<ManagerSnapshot>, private readonly busy: () => boolean) {}
  attach(sink: (event: ManagerEvent) => Promise<void>): void { this.sink = sink; }
  subscribe(): void { if (this.enabled || this.closing) return; this.enabled = true; this.generation++; this.digest = ""; this.schedule(0); }
  unsubscribe(): void { this.enabled = false; this.generation++; clearTimeout(this.timer); this.pending.clear(); }
  setObservationActive(active: boolean): void {
    if (this.observationActive === active) return;
    this.observationActive = active; this.generation++; clearTimeout(this.timer);
    if (active) { this.digest = ""; this.schedule(0); }
  }
  operation(operation: OperationSnapshot): void { this.queue("operation:" + operation.id, { event: "operation.changed", operation }); this.schedule(0); }
  private schedule(delay = 15000): void {
    if (!this.enabled || !this.observationActive || this.closing || this.observing) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const generation = this.generation;
      this.observing = this.observe().finally(() => {
        this.observing = null;
        this.schedule(generation === this.generation ? 15000 : 0);
      });
    }, delay);
    this.timer.unref();
  }
  private async observe(): Promise<void> {
    const generation = this.generation;
    if (!this.enabled || !this.observationActive || this.busy()) return;
    try {
      const snapshot = await this.capture();
      if (!this.enabled || this.closing || generation !== this.generation) return;
      const { sequence: _sequence, observedAt: _observedAt, renderer, ...rest } = snapshot;
      const next = JSON.stringify({ ...rest, renderer: { ...renderer, verifiedAt: null } });
      if (next !== this.digest) { this.digest = next; this.queue("status", { event: "status.changed", snapshot }); }
    } catch { if (this.enabled && generation === this.generation) { this.digest = ""; this.queue("status", { event: "status.invalidated" }); } }
  }
  private queue(key: string, body: EventBody): void {
    if (!this.enabled || !this.sink || this.closing && body.event !== "session.closing") return;
    if (!this.pending.has(key) && this.pending.size >= 32) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(key, body);
    this.startFlush();
  }
  private startFlush(): void {
    if (!this.writing && this.enabled && this.pending.size) this.writing = this.flush().catch(() => this.unsubscribe()).finally(() => { this.writing = null; this.startFlush(); });
  }
  private async flush(): Promise<void> {
    while (this.enabled && this.sink && this.pending.size) {
      const [key, body] = this.pending.entries().next().value!; this.pending.delete(key);
      await this.sink({ protocol: PROTOCOL, kind: "event", backendSessionId: this.session, sequence: ++this.sequence, ...body });
    }
  }
  async close(): Promise<void> {
    this.closing = true; clearTimeout(this.timer); this.generation++;
    this.pending.clear();
    if (this.enabled) this.queue("closing", { event: "session.closing" });
    while (this.writing) await this.writing;
    this.unsubscribe(); await this.observing;
  }
}
