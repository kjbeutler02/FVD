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

  // Auto-refresh on 401
  if (res.status === 401) {
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
  limit: number = 200
): Promise<DocumentPage> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    lastId: String(lastId),
    limit: String(limit),
  });
  const res = await fetchWithAuth(`/api/documents?${params}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch documents");
  }
  return res.json();
}

export async function fetchAllDocuments(
  projectId: number,
  onProgress?: (loaded: number) => void
): Promise<DocumentItem[]> {
  const allDocs: DocumentItem[] = [];
  let lastId = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await fetchDocumentPage(projectId, lastId, 200);
    allDocs.push(...page.items);
    onProgress?.(allDocs.length);
    hasMore = page.hasMore;
    if (page.lastId != null) {
      lastId = page.lastId;
    } else {
      break;
    }
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
