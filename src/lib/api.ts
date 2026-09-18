import type { FolderNode, DocumentItem, DocumentPage, LocatorResult } from "@/types/filevine";
import {
  FOLDER_RESOLVE_BATCH,
  FOLDER_SCAN_CONCURRENCY,
  SCAN_RETRIES,
  SESSION_REFRESH_MARGIN_SECONDS,
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
// Expiry (ms since epoch) of `sessionToken`, read from its `exp` claim; 0 if unknown.
let sessionExpiresAt = 0;
// Concurrent 401s (four downloads hitting an expired token at once) share a
// single refresh instead of each minting a new session.
let refreshInFlight: Promise<string> | null = null;

/** The `exp` claim of a JWT as ms since epoch, or 0 if it can't be read. */
function tokenExpiry(token: string): number {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload));
    return typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

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
    refreshInFlight = (async () => {
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
      sessionToken = data.sessionToken;
      sessionExpiresAt = tokenExpiry(sessionToken!);
      return sessionToken!;
    })().finally(() => {
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
    if (page.lastId == null || page.lastId === lastId) break;
    lastId = page.lastId;
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
  let lastId = 0;
  let scanned = 0;
  let hasMore = true;

  while (hasMore) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const page = await fetchDocumentPage(projectId, lastId, 200, signal);
    scanned += page.items.length;
    // Filter by selected folders if provided
    const filtered = folderIds
      ? page.items.filter((d) => folderIds.has(d.folderId))
      : page.items;
    allDocs.push(...filtered);
    onProgress?.(allDocs.length, scanned);
    hasMore = page.hasMore;

    // Stop if the cursor can't advance, to avoid an infinite scan loop.
    if (page.lastId == null || page.lastId === lastId) break;
    lastId = page.lastId;
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

export async function downloadFileViaProxy(
  documentId: number,
  signal?: AbortSignal
): Promise<Blob> {
  const res = await fetchWithAuth("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId }),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res, `Download failed (HTTP ${res.status})`);
  // Blob (not ArrayBuffer) so the browser can spill large files to disk
  // instead of holding every byte in JS heap memory.
  return res.blob();
}
