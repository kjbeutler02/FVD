import { API_ROOT, IDENTITY_URL, FOLDER_PAGE_SIZE } from "./constants";
import { SessionError } from "./session";

/**
 * A failed Filevine API call. `upstreamStatus` lets API routes translate the
 * failure into a status the client can act on (throttling vs. hard error).
 */
export class FilevineError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number
  ) {
    super(message);
    this.name = "FilevineError";
  }
}

/**
 * HTTP status for a route to return for `err`. Session problems are 401 so the
 * client refreshes its token; Filevine throttling is passed through as 429;
 * other upstream failures are 502; anything else is a 500.
 */
export function statusForError(err: unknown): number {
  // Match by name as well as class so a duplicated module instance (bundler
  // chunking, test runners) can never turn a session problem into a 500.
  if (err instanceof SessionError || (err instanceof Error && err.name === "SessionError")) {
    return 401;
  }
  const message = err instanceof Error ? err.message : "";
  if (message.includes("expired") || message.includes("JWS") || message.includes("JWT")) return 401;
  if (err instanceof FilevineError) {
    if (err.upstreamStatus === 429) return 429;
    if (err.upstreamStatus === 401 || err.upstreamStatus === 403) return 401;
    return 502;
  }
  return 500;
}

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

// Filevine throttles bursts (HTTP 429) even at modest rates. Paging a folder
// list or resolving folders one by one can trip it, so upstream calls that
// run in loops back off and retry a few times before giving up.
const THROTTLE_RETRIES = 4;
const THROTTLE_BASE_DELAY_MS = 1500;

async function fetchWithBackoff(
  url: string,
  headers: Record<string, string>,
  init: RequestInit = {}
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: init.body ? { ...headers, "Content-Type": "application/json" } : headers,
    });
    if (res.status !== 429 || attempt > THROTTLE_RETRIES) return res;
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : THROTTLE_BASE_DELAY_MS * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, Math.min(delay, 20_000)));
  }
}

/**
 * Every folder in a project, archived ones included. Filevine pages this list
 * (`hasMore` + `offset`); stopping after the first page silently dropped the
 * paths of every document in a folder beyond it. Archived folders are
 * included so documents inside them still get a real path; callers that
 * present a browsable tree filter them out.
 */
export async function fetchFolderTree(
  projectId: number,
  headers: Record<string, string>,
  pageSize: number = FOLDER_PAGE_SIZE
): Promise<RawFolderItem[]> {
  const items: RawFolderItem[] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      projectId: String(projectId),
      includeArchivedFolders: "true",
      limit: String(pageSize),
      offset: String(offset),
    });
    const res = await fetchWithBackoff(`${API_ROOT}/Folders/list?${params}`, headers);
    if (!res.ok) {
      throw new FilevineError(`Failed to fetch folders: ${res.status}`, res.status);
    }
    const data = await res.json();
    const page: RawFolderItem[] = data.items ?? [];
    items.push(...page);
    if (!data.hasMore || page.length === 0) break;
    offset += page.length;
  }
  return items;
}

/** One folder by id, or null if Filevine no longer has it. */
export async function fetchFolder(
  folderId: number,
  headers: Record<string, string>
): Promise<RawFolderItem | null> {
  const res = await fetchWithBackoff(`${API_ROOT}/Folders/${folderId}`, headers);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new FilevineError(`Failed to fetch folder ${folderId}: ${res.status}`, res.status);
  }
  return res.json();
}

export interface RawFolderItem {
  folderId?: { native?: number };
  parentId?: { native?: number } | null;
  name?: string;
  isArchived?: boolean;
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
  headers: Record<string, string>,
  folderId?: number
): Promise<{ items: unknown[]; hasMore: boolean; lastId: number | null }> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    lastId: String(lastId),
    limit: String(limit),
    requestedFields: "*",
  });
  // Server-side folder scoping (confirmed supported as a singular `folderId`).
  if (folderId != null) params.set("folderId", String(folderId));
  const res = await fetch(`${API_ROOT}/DocumentSeries?${params}`, { headers });
  if (!res.ok) {
    throw new FilevineError(`Failed to fetch documents: ${res.status}`, res.status);
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
    throw new FilevineError(`Failed to get locator for doc ${docId}: ${res.status}`, res.status);
  }
  const data = await res.json();
  if (typeof data?.url !== "string" || data.url === "") {
    // Happens for documents whose file is missing in storage or still processing.
    throw new FilevineError(`Filevine did not provide a download link for doc ${docId}`, 404);
  }
  return data;
}

/* ------------------------------------------------------------- uploads */

export interface UploadSlot {
  documentId: number;
  /** Pre-signed storage URL; PUT the file bytes here. Expires in 5 hours. */
  url: string;
  /** MIME type Filevine expects on the PUT, when it specifies one. */
  contentType: string | null;
}

interface RawIdentifier {
  native?: number;
  Native?: number;
}

function nativeId(v: RawIdentifier | undefined | null): number | undefined {
  return v?.native ?? v?.Native;
}

/**
 * Step 1 of an upload: register a pending document and get a pre-signed URL
 * to PUT the bytes to. The document stays pending (invisible in Filevine)
 * until `commitDocument` is called.
 */
export async function createUploadSlot(
  params: {
    projectId: number;
    folderId: number;
    filename: string;
    size: number;
    uploaderId?: number;
  },
  headers: Record<string, string>
): Promise<UploadSlot> {
  const body: Record<string, unknown> = {
    Filename: params.filename,
    Size: params.size,
    ProjectId: { Native: params.projectId },
    FolderId: { Native: params.folderId },
  };
  if (params.uploaderId) body.UploaderId = { Native: params.uploaderId };

  const res = await fetchWithBackoff(`${API_ROOT}/Documents`, headers, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new FilevineError(
      `Filevine refused the upload of "${params.filename}": ${res.status}${await errorDetail(res)}`,
      res.status
    );
  }
  const data = await res.json();
  const documentId = nativeId(data.documentId ?? data.DocumentId);
  const url = data.url ?? data.Url;
  if (documentId == null || typeof url !== "string" || url === "") {
    throw new FilevineError("Filevine did not return an upload URL", 502);
  }
  return { documentId, url, contentType: data.contentType ?? data.ContentType ?? null };
}

/**
 * Step 3 of an upload: commit the pending document to the project and folder
 * so it appears in Filevine. Returns the committed document's id.
 */
export async function commitDocument(
  params: { projectId: number; documentId: number; folderId: number },
  headers: Record<string, string>
): Promise<{ documentId: number; filename: string }> {
  const url = `${API_ROOT}/Projects/${params.projectId}/Documents/${params.documentId}?folderId=${params.folderId}`;
  const res = await fetchWithBackoff(url, headers, { method: "POST" });
  if (!res.ok) {
    throw new FilevineError(
      `Filevine could not file the uploaded document: ${res.status}${await errorDetail(res)}`,
      res.status
    );
  }
  const data = await res.json();
  return {
    documentId: nativeId(data.documentId ?? data.DocumentId) ?? params.documentId,
    filename: data.filename ?? data.Filename ?? "",
  };
}

/** Create a folder under `parentId` in a project. Returns the new folder's id. */
export async function createFolder(
  params: { projectId: number; parentId: number; name: string },
  headers: Record<string, string>
): Promise<number> {
  const body = {
    Name: params.name,
    ProjectId: { Native: params.projectId },
    ParentId: { Native: params.parentId },
  };
  const res = await fetchWithBackoff(`${API_ROOT}/Folders`, headers, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new FilevineError(
      `Filevine could not create folder "${params.name}": ${res.status}${await errorDetail(res)}`,
      res.status
    );
  }
  const data = await res.json();
  const id = nativeId(data.folderId ?? data.FolderId);
  if (id == null) throw new FilevineError("Filevine did not return the new folder's id", 502);
  return id;
}

/** Filevine's user record for an email address, if one exists in the org. */
export async function findUserIdByEmail(
  email: string,
  headers: Record<string, string>
): Promise<number | null> {
  // The Users list accepts an email filter; items are org-user records that
  // wrap the user (and its userId) one level down.
  const res = await fetchWithBackoff(
    `${API_ROOT}/Users?limit=5&email=${encodeURIComponent(email)}`,
    headers
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const items: { email?: string; user?: { email?: string; userId?: RawIdentifier } }[] =
    data.items ?? [];
  const wanted = email.toLowerCase();
  const match = items.find(
    (u) => (u.email ?? u.user?.email ?? "").toLowerCase() === wanted
  );
  return match ? (nativeId(match.user?.userId) ?? null) : null;
}

/** Short, safe excerpt of an upstream error body for the message a user sees. */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return "";
  try {
    const json = JSON.parse(text);
    const msg = json.message ?? json.detail ?? json.title;
    return typeof msg === "string" && msg ? ` — ${msg.slice(0, 200)}` : "";
  } catch {
    return "";
  }
}
