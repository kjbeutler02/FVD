import type { LocalFile, UploadDestination, UploadFileProgress } from "@/types/upload";
import {
  requestUploadSlot,
  commitUpload,
  createFolderApi,
  sendViaRelay,
  sendViaBlob,
  isUploadRetryable,
  StorageError,
  type UploadSlotResponse,
  type UploadConfig,
} from "@/lib/uploadApi";
import { retryDelay } from "@/lib/api";
import { UPLOAD_CONCURRENCY, UPLOAD_MAX_RETRIES } from "@/lib/constants";

export type FolderFlatMap = Record<number, { name: string; parentId: number | null }>;

export interface CreatedFolder {
  id: number;
  name: string;
  parentId: number;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolves (and creates on demand) Filevine folders for local sub-paths.
 * Seeded from the project's folder map so existing folders are reused; a
 * folder is only created once even when many files race for it.
 */
export class FolderResolver {
  private byParent = new Map<number, Map<string, number>>();
  private inFlight = new Map<string, Promise<number>>();
  readonly created: CreatedFolder[] = [];

  constructor(
    private readonly projectId: number,
    flatMap: FolderFlatMap,
    private readonly onCreated?: (folder: CreatedFolder) => void
  ) {
    for (const [idStr, f] of Object.entries(flatMap)) {
      if (f.parentId == null) continue;
      this.remember(f.parentId, f.name, Number(idStr));
    }
  }

  private remember(parentId: number, name: string, id: number) {
    let m = this.byParent.get(parentId);
    if (!m) {
      m = new Map();
      this.byParent.set(parentId, m);
    }
    m.set(name.trim().toLowerCase(), id);
  }

  /** Whether `relDir` under `rootId` already exists end to end. */
  exists(rootId: number, relDir: string[]): boolean {
    let cur = rootId;
    for (const part of relDir) {
      const id = this.byParent.get(cur)?.get(part.trim().toLowerCase());
      if (id == null) return false;
      cur = id;
    }
    return true;
  }

  /** Existing folder id for a path, or null if any component is missing. */
  lookup(rootId: number, relDir: string[]): number | null {
    let cur = rootId;
    for (const part of relDir) {
      const id = this.byParent.get(cur)?.get(part.trim().toLowerCase());
      if (id == null) return null;
      cur = id;
    }
    return cur;
  }

  async ensure(rootId: number, relDir: string[], signal?: AbortSignal): Promise<number> {
    let cur = rootId;
    for (const raw of relDir) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = this.byParent.get(cur)?.get(key);
      if (existing != null) {
        cur = existing;
        continue;
      }
      const flightKey = `${cur}/${key}`;
      let pending = this.inFlight.get(flightKey);
      if (!pending) {
        const parentId = cur;
        pending = createFolderApi({ projectId: this.projectId, parentId, name }, signal)
          .then((res) => {
            this.remember(parentId, name, res.folderId);
            const created = { id: res.folderId, name, parentId };
            this.created.push(created);
            this.onCreated?.(created);
            return res.folderId;
          })
          .finally(() => this.inFlight.delete(flightKey));
        this.inFlight.set(flightKey, pending);
      }
      cur = await pending;
    }
    return cur;
  }
}

export interface QueueItem {
  lf: LocalFile;
  dest: UploadDestination;
}

export interface QueueEvents {
  update: (id: string, patch: Partial<UploadFileProgress>) => void;
  attributed: (attributed: boolean) => void;
  /** A file finished (complete or error). */
  settled: (item: QueueItem, progress: Pick<UploadFileProgress, "status" | "documentId" | "error">) => void;
  /** No more work queued and nothing in flight. */
  idle: () => void;
}

/**
 * Uploads files a few at a time with retries. Each file: ensure its Filevine
 * folder exists → request an upload slot → PUT the bytes to storage → commit.
 * The queue stays open so a folder watcher can keep feeding it; `idle` fires
 * each time it drains.
 */
export class UploadQueue {
  private pending: QueueItem[] = [];
  private active = 0;
  private closed = false;

  constructor(
    private readonly folders: FolderResolver,
    private readonly signal: AbortSignal,
    private readonly events: QueueEvents,
    private readonly config: UploadConfig
  ) {}

  get size(): number {
    return this.pending.length + this.active;
  }

  add(items: QueueItem[]): void {
    if (this.closed) return;
    this.pending.push(...items);
    this.pump();
  }

  close(): void {
    this.closed = true;
  }

  private pump() {
    while (this.active < UPLOAD_CONCURRENCY && this.pending.length > 0) {
      const item = this.pending.shift()!;
      this.active++;
      void this.process(item).finally(() => {
        this.active--;
        if (this.pending.length === 0 && this.active === 0) this.events.idle();
        else this.pump();
      });
    }
  }

  private async process(item: QueueItem): Promise<void> {
    const { lf, dest } = item;
    const { signal, events, config } = this;
    let attempts = 0;
    // One pending Filevine document per file: the slot is reused across
    // retries and only re-requested if its storage link has expired.
    let slot: UploadSlotResponse | null = null;
    let folderId: number | null = null;

    if (lf.size > config.relayMaxBytes && !config.largeFiles) {
      const limitMb = Math.round(config.relayMaxBytes / 1024 / 1024);
      const message = `Over ${limitMb} MB — large-file uploads are not set up on this deployment yet`;
      events.update(lf.id, { status: "error", error: message, attempts: 0 });
      events.settled(item, { status: "error", error: message });
      return;
    }

    for (;;) {
      attempts++;
      try {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        events.update(lf.id, { status: "preparing", attempts, fraction: 0, error: undefined });

        if (folderId == null) folderId = await this.folders.ensure(dest.folderId, lf.relDir, signal);
        if (!slot) {
          slot = await requestUploadSlot(
            { projectId: dest.projectId, folderId, filename: lf.name, size: lf.size },
            signal
          );
          events.attributed(slot.attributed);
        }

        events.update(lf.id, { status: "uploading" });
        // A file handle (watch mode) is re-read at send time so we never send
        // a stale snapshot of a file that has since been rewritten.
        const blob = lf.handle ? await lf.handle.getFile() : lf.file;
        if (blob.size !== lf.size) {
          throw new Error("The file changed size while waiting to upload; it will be picked up again");
        }
        const onProgress = (loaded: number) =>
          events.update(lf.id, { fraction: lf.size > 0 ? Math.min(1, loaded / lf.size) : 1 });
        if (lf.size <= config.relayMaxBytes) {
          await sendViaRelay(slot.ticket, blob, slot.contentType, onProgress, signal);
        } else {
          await sendViaBlob(slot.ticket, blob, lf.name, onProgress, signal);
        }

        events.update(lf.id, { status: "committing", fraction: 1 });
        const committed = await this.commitWithRetry({
          projectId: dest.projectId,
          folderId,
          documentId: slot.documentId,
        });

        events.update(lf.id, { status: "complete", documentId: committed.documentId });
        events.settled(item, { status: "complete", documentId: committed.documentId });
        return;
      } catch (err) {
        if (signal.aborted || isAbort(err)) {
          events.update(lf.id, { status: "pending", fraction: 0 });
          return;
        }
        // An expired storage link means the pending document is stale too.
        if (err instanceof StorageError && err.status === 403) slot = null;
        if (attempts < UPLOAD_MAX_RETRIES && isUploadRetryable(err)) {
          try {
            await sleep(retryDelay(err, attempts), signal);
          } catch {
            events.update(lf.id, { status: "pending", fraction: 0 });
            return;
          }
          continue;
        }
        const message = err instanceof Error ? err.message : "Upload failed";
        events.update(lf.id, { status: "error", error: message, attempts });
        events.settled(item, { status: "error", error: message });
        return;
      }
    }
  }

  /** The bytes are already in storage; retry only the commit so nothing is re-sent or orphaned. */
  private async commitWithRetry(params: { projectId: number; folderId: number; documentId: number }) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await commitUpload(params, this.signal);
      } catch (err) {
        if (attempt >= 3 || !isUploadRetryable(err) || this.signal.aborted) throw err;
        await sleep(retryDelay(err, attempt), this.signal);
      }
    }
  }
}
