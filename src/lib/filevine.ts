import { API_ROOT, IDENTITY_URL } from "./constants";

interface TokenResponse {
  access_token: string;
}

interface OrgUserInfo {
  orgId: string;
  userId: string;
}

export async function getAccessToken(
  pat: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const body = new URLSearchParams({
    token: pat,
    grant_type: "personal_access_token",
    scope:
      "fv.api.gateway.access tenant filevine.v2.api.* openid email fv.auth.tenant.read",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(IDENTITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Filevine auth failed: ${res.status} ${res.statusText}`);
  }

  const data: TokenResponse = await res.json();
  if (!data.access_token) {
    throw new Error("access_token missing from token response");
  }
  return data.access_token;
}

export async function getOrgAndUserIds(
  accessToken: string
): Promise<OrgUserInfo> {
  const res = await fetch(`${API_ROOT}/utils/GetUserOrgsWithToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to get org/user IDs: ${res.status}`);
  }

  const info = await res.json();

  function pickId(data: Record<string, unknown>, key: string): string | null {
    const val = data[key] ?? data[key.toLowerCase()];
    if (val && typeof val === "object" && val !== null) {
      const obj = val as Record<string, unknown>;
      return String(obj.native ?? obj.partner ?? "");
    }
    return val ? String(val) : null;
  }

  const user = (info.user ?? {}) as Record<string, unknown>;
  const userId = pickId(user, "userId") || pickId(info, "userId");
  if (!userId) throw new Error("Unable to parse userId");

  const orgs = (info.orgs ?? []) as Record<string, unknown>[];
  const orgId = orgs.length > 0 ? pickId(orgs[0], "orgId") : pickId(info, "orgId");
  if (!orgId) throw new Error("Unable to parse orgId");

  return { orgId, userId };
}

export async function fetchFolderTree(
  projectId: number,
  headers: Record<string, string>
): Promise<unknown[]> {
  const url = `${API_ROOT}/Folders/list?projectId=${projectId}&includeArchivedFolders=false`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch folders: ${res.status}`);
  }
  const data = await res.json();
  return data.items ?? [];
}

export interface RawFolderItem {
  folderId?: { native?: number };
  parentId?: { native?: number } | null;
  name?: string;
}

export interface FolderTreeNode {
  id: number;
  name: string;
  parentId: number | null;
  children: FolderTreeNode[];
}

export function buildFolderTree(items: RawFolderItem[]): FolderTreeNode[] {
  const map = new Map<number, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];

  for (const item of items) {
    const id = item.folderId?.native;
    if (id == null) continue;
    map.set(id, {
      id,
      name: item.name || `Folder ${id}`,
      parentId: item.parentId?.native ?? null,
      children: [],
    });
  }

  for (const node of map.values()) {
    if (node.parentId != null && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function fetchDocumentPage(
  projectId: number,
  lastId: number,
  limit: number,
  headers: Record<string, string>
): Promise<{ items: unknown[]; hasMore: boolean; lastId: number | null }> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    lastId: String(lastId),
    limit: String(limit),
    requestedFields: "*",
  });
  const res = await fetch(`${API_ROOT}/DocumentSeries?${params}`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch documents: ${res.status}`);
  }
  const data = await res.json();
  const items = data.items ?? [];
  const hasMore = data.hasMore ?? false;

  let nextLastId: number | null = null;
  if (items.length > 0) {
    const lastDoc = items[items.length - 1];
    nextLastId = lastDoc?.documentId?.native ?? null;
  }

  return { items, hasMore, lastId: nextLastId };
}

export async function fetchLocator(
  docId: number,
  headers: Record<string, string>
): Promise<{ url: string }> {
  const res = await fetch(`${API_ROOT}/Documents/${docId}/locator`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to get locator for doc ${docId}: ${res.status}`);
  }
  return res.json();
}
