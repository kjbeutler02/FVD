import type { FolderNode, DocumentItem, DocumentPage, LocatorResult } from "@/types/filevine";
import { FOLDER_SCAN_CONCURRENCY } from "@/lib/constants";

let sessionToken: string | null = null;

async function refreshSession(): Promise<string> {
  const res = await fetch("/api/fv-session", { method: "POST" });
  if (res.status === 401) {
    // The Entra session expired — send the user back through sign-in.
    window.location.assign("/");
    throw new Error("Session expired — signing in again");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Authentication failed");
  }
  const data = await res.json();
  sessionToken = data.sessionToken;
  return sessionToken!;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!sessionToken) {
    await refreshSession();
  }
  return { Authorization: `Bearer ${sessionToken}` };
}

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const headers = await authHeaders();
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });

  // Auto-refresh on 401 (don't retry if the caller already aborted)
  if (res.status === 401 && !init?.signal?.aborted) {
    await refreshSession();
    const newHeaders = await authHeaders();
    return fetch(url, {
      ...init,
      headers: { ...newHeaders, ...init?.headers },
    });
  }

  return res;
}

export interface FolderResponse {
  tree: FolderNode[];
  flatMap: Record<number, { name: string; parentId: number | null }>;
  totalCount: number;
}

export async function fetchFolders(projectId: number): Promise<FolderResponse> {
  const res = await fetchWithAuth(`/api/folders?projectId=${projectId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch folders");
  }
  return res.json();
}

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
  const res = await fetchWithAuth(`/api/documents?${params}`, { signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch documents");
  }
  return res.json();
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

export async function fetchLocators(documentIds: number[]): Promise<LocatorResult[]> {
  const res = await fetchWithAuth("/api/locators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch locators");
  }
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
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Download failed for doc ${documentId}`);
  }
  // Blob (not ArrayBuffer) so the browser can spill large files to disk
  // instead of holding every byte in JS heap memory.
  return res.blob();
}

export function buildFolderPath(
  folderId: number,
  flatMap: Record<number, { name: string; parentId: number | null }>
): string {
  const parts: string[] = [];
  let cur: number | null = folderId;
  const visited = new Set<number>();

  while (cur != null && !visited.has(cur) && flatMap[cur]) {
    visited.add(cur);
    parts.push(flatMap[cur].name);
    cur = flatMap[cur].parentId;
  }

  return parts.reverse().join("/");
}
