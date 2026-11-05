import type { MediaResource, ThemeRef } from "../../../contracts/manager.mjs";
import { BridgeError } from "./client";
import type { ManagerClient } from "./client";
import { UiMessageError, uiMessage } from "./ui-message";

export type PreviewTarget = { kind: "theme"; theme: ThemeRef; revision: string; variant: "thumbnail" | "preview" } |
  { kind: "community"; version: string; variant: "thumbnail" | "preview" } |
  { kind: "active"; revision: string } |
  { kind: "source" | "package"; handle: string };
export const previewKey = (target: PreviewTarget) => JSON.stringify(target);
export interface PreviewResource { resource: MediaResource; release(): void }
interface Subscriber { resolve(value: MediaResource): void; reject(error: Error): void }
interface Job {
  target: PreviewTarget; key: string; foreground: boolean; priority: number; started: boolean;
  settled: boolean; finished: boolean; resource: MediaResource | null; subscribers: Set<Subscriber>;
}
interface Queue { thumbnails: number; foreground: number; jobs: Map<string, Job>; waiting: Job[] }
const queues = new WeakMap<ManagerClient, Queue>();
const releases = new WeakMap<ManagerClient, Promise<unknown>>();

async function retryBusy<T>(work: () => Promise<T>, active: () => boolean, until: number, release = false): Promise<T> {
  let delay = 250;
  for (;;) {
    if (!active()) throw new DOMException("Preview hidden", "AbortError");
    if (Date.now() >= until) throw new UiMessageError(uiMessage("预览准备超时，请重试。"));
    try { return await work(); }
    catch (error) {
      if (!(error instanceof BridgeError) || !error.detail.retryable ||
          (error.detail.code !== "BUSY" && !(release && error.detail.code === "TIMEOUT")) ||
          !active() || Date.now() >= until) throw error;
      await new Promise(resolve => window.setTimeout(resolve, delay));
      delay = Math.min(2000, delay * 2);
    }
  }
}

function request(client: ManagerClient, target: PreviewTarget): Promise<MediaResource> {
  if (target.kind === "active") return client.call("media.activePreview", { revision: target.revision });
  if (target.kind === "theme") return client.call("media.resolve", { theme: target.theme, revision: target.revision, variant: target.variant });
  if (target.kind === "community") return client.call("community.preview", { version: target.version, variant: target.variant });
  return target.kind === "source" ? client.call("sources.preview", { handle: target.handle }) : client.call("packages.preview", { handle: target.handle });
}
function finish(client: ManagerClient, queue: Queue, job: Job) {
  if (!job.settled || job.finished || job.subscribers.size) return;
  job.finished = true;
  queue.jobs.delete(job.key);
  const resource = job.resource;
  // Release each lease once, including URLs returned after every consumer cancelled.
  // Serialize cleanup into the reserved RPC slot; completed previews need not wait for its ACK.
  const releasing = resource ? (releases.get(client) ?? Promise.resolve()).then(() =>
    retryBusy(() => client.call("media.release", { leaseId: resource.leaseId }, Date.parse(resource.expiresAt)), () => true, Date.parse(resource.expiresAt), true)).catch(() => {}) : Promise.resolve();
  if (resource) releases.set(client, releasing);
  void releasing.finally(() => {
    if (resource && releases.get(client) === releasing) releases.delete(client);
  });
  if (job.foreground) queue.foreground--; else queue.thumbnails--;
  pump(client, queue);
}
function pump(client: ManagerClient, queue: Queue) {
  for (;;) {
    // Hold each slot until the image loads, not just until its URL is returned.
    // This limits the number of large source files awaiting native decoding.
    queue.waiting.sort((a, b) => a.priority - b.priority);
    const index = queue.waiting.findIndex(job => job.foreground ? queue.foreground < 1 : queue.thumbnails < 20);
    if (index < 0) return;
    const job = queue.waiting.splice(index, 1)[0]!;
    if (!job.subscribers.size) { queue.jobs.delete(job.key); continue; }
    job.started = true;
    if (job.foreground) queue.foreground++; else queue.thumbnails++;
    void retryBusy(() => request(client, job.target), () => job.subscribers.size > 0, Date.now() + 180000).then(value => {
      job.resource = value; job.settled = true;
      for (const subscriber of [...job.subscribers]) subscriber.resolve(value);
      finish(client, queue, job);
    }, error => {
      job.settled = true;
      for (const subscriber of [...job.subscribers]) subscriber.reject(error instanceof Error ? error : new Error("预览未完成。"));
      finish(client, queue, job);
    });
  }
}

export function prioritizePreview(client: ManagerClient, target: PreviewTarget): void {
  const queue = queues.get(client), job = queue?.jobs.get(previewKey(target));
  if (queue && job && !job.foreground) { job.priority = 1; pump(client, queue); }
}

// Abort/release drops this consumer; native decoding and writers stay independently bounded.
export function resolvePreview(client: ManagerClient, target: PreviewTarget, signal: AbortSignal, nearViewport = true): Promise<PreviewResource> {
  if (signal.aborted) return Promise.reject(new DOMException("Preview hidden", "AbortError"));
  let queue = queues.get(client);
  if (!queue) { queue = { thumbnails: 0, foreground: 0, jobs: new Map(), waiting: [] }; queues.set(client, queue); }
  const owner = queue, key = previewKey(target);
  let job = owner.jobs.get(key);
  if (!job) {
    const foreground = (target.kind !== "theme" && target.kind !== "community") || target.variant !== "thumbnail";
    job = { target, key, foreground, priority: foreground ? 0 : nearViewport ? 1 : 2,
      started: false, settled: false, finished: false, resource: null, subscribers: new Set() };
    owner.jobs.set(key, job); owner.waiting.push(job);
  } else if (nearViewport && !job.foreground) job.priority = 1;
  const current = job;
  return new Promise((resolve, reject) => {
    let timer: number | undefined;
    function release() {
      window.clearTimeout(timer); signal.removeEventListener("abort", cancel);
      if (!current.subscribers.delete(subscriber)) return;
      if (!current.started) {
        if (!current.subscribers.size) { owner.jobs.delete(key); owner.waiting = owner.waiting.filter(value => value !== current); }
      } else finish(client, owner, current);
    }
    function cancel() { release(); reject(new DOMException("Preview hidden", "AbortError")); }
    const subscriber: Subscriber = {
      resolve: resource => {
        // A missing browser load/error callback must not stall the entire queue.
        timer = window.setTimeout(release, 60000);
        resolve({ resource, release });
      },
      reject: error => { release(); reject(error); },
    };
    current.subscribers.add(subscriber); signal.addEventListener("abort", cancel, { once: true });
    if (current.resource) subscriber.resolve(current.resource);
    pump(client, owner);
  });
}
