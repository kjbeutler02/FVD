import type { FolderNode, DocumentItem, DocumentPage, LocatorResult } from "@/types/filevine";

let sessionToken: string | null = null;

async function refreshSession(): Promise<string> {
  const res = await fetch("/api/auth", { method: "POST" });
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
  signal?: AbortSignal
): Promise<DocumentPage> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    lastId: String(lastId),
    limit: String(limit),
  });
  const res = await fetchWithAuth(`/api/documents?${params}`, { signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch documents");
  }
  return res.json();
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
): Promise<ArrayBuffer> {
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
  return res.arrayBuffer();
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
