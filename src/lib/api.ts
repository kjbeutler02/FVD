import type { FolderNode, DocumentItem, DocumentPage, LocatorResult } from "@/types/filevine";
import {
  DOWNLOAD_ETAG_HEADER,
  DOWNLOAD_MAX_REQUESTS,
  DOWNLOAD_OFFSET_HEADER,
  DOWNLOAD_SIZE_HEADER,
  DOWNLOAD_SPILL_BYTES,
  DOWNLOAD_STALL_MS,
  FOLDER_RESOLVE_BATCH,
  FOLDER_SCAN_CONCURRENCY,
  MAX_RETRIES,
  SCAN_RETRIES,
  SESSION_REFRESH_MARGIN_SECONDS,
  THROTTLE_MAX_RETRIES,
} from "@/lib/constants";

export { displayFolderPath as buildFolderPath } from "@/lib/zipPath";

/** An HTTP failure from our API routes, with the status so callers can decide how to retry. */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Transient failures worth retrying: throttling, upstream/server errors, network drops. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof HttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  // fetch() rejects with a TypeError on network failure.
  return err instanceof TypeError;
}

/** Backoff for the given attempt (1-based); throttling waits longer. */
export function retryDelay(err: unknown, attempt: number): number {
  const base = err instanceof HttpError && err.status === 429 ? 5000 : 1000;
  return Math.min(base * 2 ** (attempt - 1), 30_000);
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
 * Resolves once the browser has a network connection. While the machine is
 * offline (Wi-Fi dropped, laptop lid closed) every request fails at once, and
 * retrying on a timer would write off file after file in seconds; waiting for
 * the connection costs nothing and lets a long run pick up where it was.
 */
function waitUntilOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    function cleanup() {
      window.removeEventListener("online", onOnline);
      signal?.removeEventListener("abort", onAbort);
    }
    function onOnline() {
      cleanup();
      resolve();
    }
    function onAbort() {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }
    window.addEventListener("online", onOnline, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run `fn` up to `attempts` times, backing off between retryable failures. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  signal?: AbortSignal
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      await waitUntilOnline(signal);
      await sleep(retryDelay(err, attempt), signal);
    }
  }
}

export async function errorFromResponse(res: Response, fallback: string): Promise<HttpError> {
  const data = await res.json().catch(() => ({}));
  const detail = typeof data.error === "string" && data.error ? data.error : fallback;
  return new HttpError(detail, res.status);
}

/* ------------------------------------------------------------- session */

let sessionToken: string | null = null;
// Expiry (ms since epoch, by this machine's clock) of `sessionToken`; 0 if unknown.
let sessionExpiresAt = 0;
// Attempts to mint a session token before giving up on the request that needed it.
const SESSION_RETRIES = 3;
// Concurrent 401s (four downloads hitting an expired token at once) share a
// single refresh instead of each minting a new session.
let refreshInFlight: Promise<string> | null = null;

/**
 * Whether the current token is still safely usable. Tokens are refreshed a
 * margin before they expire so a multi-hour download never sends a request
 * with a token that dies in flight.
 */
function tokenIsFresh(): boolean {
  if (!sessionToken) return false;
  if (sessionExpiresAt === 0) return true;
  return Date.now() < sessionExpiresAt - SESSION_REFRESH_MARGIN_SECONDS * 1000;
}

function refreshSession(): Promise<string> {
  if (!refreshInFlight) {
    // A token is renewed every few minutes of a long run; one failed renewal
    // (Filevine busy, connection blip) is retried rather than failing every
    // request that was waiting on it.
    refreshInFlight = withRetry(async () => {
      const requestedAt = Date.now();
      const res = await fetch("/api/fv-session", { method: "POST" });
      if (res.status === 401) {
        // The Entra session expired — send the user back through sign-in.
        window.location.assign("/");
        throw new Error("Session expired — signing in again");
      }
      if (!res.ok) {
        throw await errorFromResponse(res, "Authentication failed");
      }
      const data = await res.json();
      if (typeof data.sessionToken !== "string" || data.sessionToken === "") {
        throw new Error("Authentication failed: no session token was returned");
      }
      sessionToken = data.sessionToken as string;
      // The token is opaque; the server states how long it lasts. Counted from
      // when the request was sent, so the estimate errs on the early side.
      sessionExpiresAt =
        typeof data.expiresIn === "number" ? requestedAt + data.expiresIn * 1000 : 0;
      return sessionToken;
    }, SESSION_RETRIES).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!tokenIsFresh()) {
    await refreshSession();
  }
  return { Authorization: `Bearer ${sessionToken}` };
}

/** The Authorization header value for a request made outside fetchWithAuth (e.g. XHR). */
export async function currentAuthHeader(): Promise<string> {
  return (await authHeaders()).Authorization;
}

export async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const tokenBefore = sessionToken;
  const headers = await authHeaders();
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });

  // Auto-refresh on 401 (don't retry if the caller already aborted). If another
  // request already refreshed the token since we read it, just reuse that one.
  if (res.status === 401 && !init?.signal?.aborted) {
    if (sessionToken === tokenBefore) await refreshSession();
    const newHeaders = await authHeaders();
    return fetch(url, {
      ...init,
      headers: { ...newHeaders, ...init?.headers },
    });
  }

  return res;
}

/* ------------------------------------------------------------- folders */

export interface FolderResponse {
  tree: FolderNode[];
  flatMap: Record<number, { name: string; parentId: number | null }>;
  /** The project's root document folder (parent of the top-level folders), if it could be determined. */
  rootFolderId: number | null;
  totalCount: number;
}

export async function fetchFolders(projectId: number): Promise<FolderResponse> {
  return withRetry(async () => {
    const res = await fetchWithAuth(`/api/folders?projectId=${projectId}`);
    if (!res.ok) throw await errorFromResponse(res, "Failed to fetch folders");
    return res.json() as Promise<FolderResponse>;
  }, SCAN_RETRIES);
}

export type FolderFlatMap = FolderResponse["flatMap"];

export interface ResolveFoldersResponse {
  folders: FolderFlatMap;
  missing: number[];
}

/** Look up folders the project's folder list did not include (max FOLDER_RESOLVE_BATCH ids). */
export async function resolveFolders(
  folderIds: number[],
  signal?: AbortSignal
): Promise<ResolveFoldersResponse> {
  return withRetry(
    async () => {
      const res = await fetchWithAuth("/api/folders/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderIds }),
        signal,
      });
      if (!res.ok) throw await errorFromResponse(res, "Failed to resolve folders");
      return res.json() as Promise<ResolveFoldersResponse>;
    },
    SCAN_RETRIES,
    signal
  );
}

/**
 * Fill in `flatMap` for every folder referenced by `docs` that it does not
 * already contain, following parent chains until each path reaches a known
 * folder or the project root. Returns the number of documents whose folder
 * could still not be identified. Best effort: a failed lookup leaves those
 * documents unresolved rather than failing the run.
 */
export async function resolveMissingFolders(
  docs: { folderId: number }[],
  flatMap: FolderFlatMap,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const pending = new Set<number>();
  for (const d of docs) {
    if (d.folderId && !flatMap[d.folderId]) pending.add(d.folderId);
  }
  const missing = new Set<number>();
  let done = 0;
  let total = pending.size;

  while (pending.size > 0) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = [...pending].slice(0, FOLDER_RESOLVE_BATCH);
    for (const id of batch) pending.delete(id);

    let result: ResolveFoldersResponse;
    try {
      result = await resolveFolders(batch, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      for (const id of batch) missing.add(id);
      done += batch.length;
      onProgress?.(done, total);
      continue;
    }

    for (const [id, folder] of Object.entries(result.folders)) {
      flatMap[Number(id)] = folder;
      // Walk up: the parent may itself be a folder the list did not cover.
      const parentId = folder.parentId;
      if (parentId != null && !flatMap[parentId] && !missing.has(parentId) && !pending.has(parentId)) {
        pending.add(parentId);
        total++;
      }
    }
    for (const id of result.missing) missing.add(id);
    done += batch.length;
    onProgress?.(done, total);
  }

  let unresolved = 0;
  for (const d of docs) {
    if (d.folderId && !flatMap[d.folderId]) unresolved++;
  }
  return unresolved;
}

/* ----------------------------------------------------------- documents */

export async function fetchDocumentPage(
  projectId: number,
  lastId: number = 0,
  limit: number = 200,
  signal?: AbortSignal,
  folderId?: number
): Promise<DocumentPage> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    lastId: String(lastId),
    limit: String(limit),
  });
  if (folderId != null) params.set("folderId", String(folderId));
  // One throttled or flaky page used to abort the whole scan; retry it.
  return withRetry(
    async () => {
      const res = await fetchWithAuth(`/api/documents?${params}`, { signal });
      if (!res.ok) throw await errorFromResponse(res, "Failed to fetch documents");
      return res.json() as Promise<DocumentPage>;
    },
    SCAN_RETRIES,
    signal
  );
}

/**
 * The cursor for the page after `page`. Filevine has said there is more; if
 * the cursor cannot move forward, stopping would hand back a partial list as
 * though it were the whole one, and the missing documents would simply never
 * be downloaded. Refuse instead, so the scan fails visibly.
 */
function nextCursor(page: DocumentPage, lastId: number, soFar: number): number {
  if (page.lastId == null || page.lastId === lastId) {
    throw new Error(
      `The document list could not be read completely (it stopped after ${soFar.toLocaleString()} documents). Nothing was downloaded — please try again.`
    );
  }
  return page.lastId;
}

/** Paginate one folder's documents (server-scoped via folderId). */
export async function fetchDocumentsForFolder(
  projectId: number,
  folderId: number,
  signal?: AbortSignal
): Promise<DocumentItem[]> {
  const docs: DocumentItem[] = [];
  let lastId = 0;
  let hasMore = true;

  while (hasMore) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await fetchDocumentPage(projectId, lastId, 200, signal, folderId);
    docs.push(...page.items);
    hasMore = page.hasMore;
    if (!hasMore) break;
    lastId = nextCursor(page, lastId, docs.length);
  }

  return docs;
}

/**
 * Fast path for a specific selection: fetch documents for each selected folder
 * directly (server-scoped), in parallel, instead of scanning the whole project.
 * The selection set already contains every descendant folder, so this covers
 * the full subtree. Documents are de-duped by id.
 */
export async function fetchDocumentsByFolders(
  projectId: number,
  folderIds: Iterable<number>,
  onProgress?: (found: number, foldersDone: number, foldersTotal: number) => void,
  signal?: AbortSignal
): Promise<DocumentItem[]> {
  const ids = [...folderIds];
  const all: DocumentItem[] = [];
  const seen = new Set<number>();
  let foldersDone = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const fid = ids[cursor++];
      const docs = await fetchDocumentsForFolder(projectId, fid, signal);
      for (const d of docs) {
        if (!seen.has(d.documentId)) {
          seen.add(d.documentId);
          all.push(d);
        }
      }
      foldersDone++;
      onProgress?.(all.length, foldersDone, ids.length);
    }
  }

  const workerCount = Math.min(FOLDER_SCAN_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return all;
}

export async function fetchAllDocuments(
  projectId: number,
  onProgress?: (matched: number, scanned: number) => void,
  folderIds?: Set<number> | null,
  signal?: AbortSignal
): Promise<DocumentItem[]> {
  const allDocs: DocumentItem[] = [];
  // A document must appear once: the run tracks files by id, and a repeat
  // would be zipped twice while the totals counted it once.
  const seen = new Set<number>();
  let lastId = 0;
  let scanned = 0;
  let hasMore = true;

  while (hasMore) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const page = await fetchDocumentPage(projectId, lastId, 200, signal);
    scanned += page.items.length;
    for (const doc of page.items) {
      if (seen.has(doc.documentId)) continue;
      seen.add(doc.documentId);
      // Filter by selected folders if provided
      if (!folderIds || folderIds.has(doc.folderId)) allDocs.push(doc);
    }
    onProgress?.(allDocs.length, scanned);
    hasMore = page.hasMore;
    if (!hasMore) break;
    lastId = nextCursor(page, lastId, scanned);
  }

  return allDocs;
}

/* ------------------------------------------------------------ download */

export async function fetchLocators(documentIds: number[]): Promise<LocatorResult[]> {
  const res = await fetchWithAuth("/api/locators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds }),
  });
  if (!res.ok) throw await errorFromResponse(res, "Failed to fetch locators");
  const data = await res.json();
  return data.locators;
}

/** What has arrived of one file so far, across however many requests it takes. */
interface Transfer {
  /** Received bytes in order, already handed to the browser as Blobs. */
  pieces: Blob[];
  received: number;
  /** Size of the whole file as reported by storage, when it says. */
  total: number | null;
  /** Storage's version tag for the file; resuming is only valid against the same one. */
  etag: string | null;
  type: string;
}

function resetTransfer(t: Transfer): void {
  t.pieces = [];
  t.received = 0;
  t.total = null;
  t.etag = null;
}

function headerNumber(res: Response, name: string): number | null {
  const value = res.headers.get(name);
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * One request for a file's bytes, starting at the first byte not yet held.
 * Whatever arrives is kept in `t` even if the request then fails, so the next
 * one continues from there instead of starting the file again.
 */
async function receive(documentId: number, t: Transfer, signal?: AbortSignal): Promise<void> {
  // Abort this request if the transfer stalls, so it can be continued rather
  // than left waiting forever on a connection the server already dropped.
  const attempt = new AbortController();
  const onCancel = () => attempt.abort();
  signal?.addEventListener("abort", onCancel, { once: true });
  if (signal?.aborted) attempt.abort();
  let stalled = false;
  let lastByteAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastByteAt >= DOWNLOAD_STALL_MS) {
      stalled = true;
      attempt.abort();
    }
  }, 5000);

  let pending: Uint8Array<ArrayBuffer>[] = [];
  let pendingBytes = 0;
  // Blob (not ArrayBuffer) so the browser can spill large files to disk
  // instead of holding every byte in JS heap memory.
  const spill = () => {
    if (pendingBytes === 0) return;
    t.pieces.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };

  try {
    const res = await fetchWithAuth("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        offset: t.received,
        ...(t.received > 0 && t.etag ? { etag: t.etag } : {}),
      }),
      signal: attempt.signal,
    });
    if (!res.ok) throw await errorFromResponse(res, `Download failed (HTTP ${res.status})`);

    const start = headerNumber(res, DOWNLOAD_OFFSET_HEADER) ?? 0;
    const total = headerNumber(res, DOWNLOAD_SIZE_HEADER);
    if (start === 0) {
      // The whole file from the top (first request, or storage would not resume).
      if (t.received > 0) resetTransfer(t);
    } else if (start !== t.received || (t.total != null && total != null && total !== t.total)) {
      // Not a continuation of what we hold. Drop it and start the file over.
      await res.body?.cancel().catch(() => {});
      resetTransfer(t);
      throw new TypeError("Download could not be resumed; starting the file again");
    }
    if (total != null) t.total = total;
    t.etag = res.headers.get(DOWNLOAD_ETAG_HEADER) ?? t.etag;
    t.type = res.headers.get("Content-Type") ?? t.type;

    if (!res.body) {
      const blob = await res.blob();
      t.pieces.push(blob);
      t.received += blob.size;
      return;
    }

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByteAt = Date.now();
      pending.push(value);
      pendingBytes += value.byteLength;
      t.received += value.byteLength;
      if (pendingBytes >= DOWNLOAD_SPILL_BYTES) spill();
    }
  } catch (err) {
    // A stall is a network failure: TypeError makes it retryable.
    if (stalled && !signal?.aborted) {
      throw new TypeError(`Download stalled: no data for ${DOWNLOAD_STALL_MS / 1000} seconds`);
    }
    throw err;
  } finally {
    spill();
    clearInterval(watchdog);
    signal?.removeEventListener("abort", onCancel);
  }
}

/**
 * Download one document through the proxy, complete or not at all.
 *
 * A request can end before the file does: the connection drops, the transfer
 * stalls, or a very large file outlasts the proxy's time limit. Each time,
 * the next request asks only for the bytes still missing, so a file of any
 * size gets through as long as requests keep making progress. Only requests
 * that deliver nothing count against the retry budget. The result is checked
 * against the size storage reported, so a file cut short is an error here and
 * never a silently truncated entry in the archive.
 */
export async function downloadFileViaProxy(
  documentId: number,
  signal?: AbortSignal
): Promise<Blob> {
  const t: Transfer = { pieces: [], received: 0, total: null, etag: null, type: "" };
  let idle = 0; // consecutive requests that delivered nothing

  for (let request = 1; ; request++) {
    const before = t.received;
    try {
      await receive(documentId, t, signal);
      if (t.total != null && t.received !== t.total) {
        const got = t.received;
        const want = t.total;
        // More than the file holds cannot be repaired by resuming.
        if (got > want) resetTransfer(t);
        throw new TypeError(
          `Download incomplete: received ${got.toLocaleString()} of ${want.toLocaleString()} bytes`
        );
      }
      return new Blob(t.pieces, { type: t.type });
    } catch (err) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      // The file changed in storage between requests: start it over.
      const changed = err instanceof HttpError && err.status === 409;
      if (changed) resetTransfer(t);
      if (!changed && !isRetryable(err)) throw err;

      idle = t.received > before ? 0 : idle + 1;
      const throttled = err instanceof HttpError && err.status === 429;
      const limit = throttled ? THROTTLE_MAX_RETRIES : MAX_RETRIES;
      if (idle >= limit || request >= DOWNLOAD_MAX_REQUESTS) throw err;

      await waitUntilOnline(signal);
      await sleep(retryDelay(err, Math.max(idle, 1)), signal);
    }
  }
}
