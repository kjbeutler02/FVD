import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { filevineHeadersFromRequest } from "@/lib/routeAuth";
import { createUploadSlot, findUserIdByEmail, statusForError } from "@/lib/filevine";
import { signUploadTicket } from "@/lib/uploadTicket";

// Filevine user ids by signed-in email, so uploads are attributed to the
// person who sent them rather than to the shared API credential. Cached per
// server instance; a miss is cached too so we never re-scan for every file.
const uploaderCache = new Map<string, { id: number | null; at: number }>();
const UPLOADER_CACHE_MS = 60 * 60 * 1000;

async function uploaderIdFor(
  email: string | null | undefined,
  headers: Record<string, string>
): Promise<number | undefined> {
  if (!email) return undefined;
  const key = email.toLowerCase();
  const hit = uploaderCache.get(key);
  if (hit && Date.now() - hit.at < UPLOADER_CACHE_MS) return hit.id ?? undefined;
  let id: number | null = null;
  try {
    id = await findUserIdByEmail(email, headers);
  } catch {
    id = null;
  }
  uploaderCache.set(key, { id, at: Date.now() });
  return id ?? undefined;
}

/**
 * Step 1 of an upload: ask Filevine for a pending document and a pre-signed
 * storage URL. The URL is sealed into a signed ticket; the browser then sends
 * the bytes to /api/upload/put (small files) or stages them in Vercel Blob and
 * calls /api/upload/relay (large files), and finally /api/upload/commit.
 * Filevine's storage bucket allows no cross-origin requests, so the browser
 * can never PUT to it directly.
 */
export async function POST(request: Request) {
  let body: { projectId?: unknown; folderId?: unknown; filename?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, folderId, filename, size } = body;
  if (
    typeof projectId !== "number" ||
    typeof folderId !== "number" ||
    typeof filename !== "string" ||
    filename.trim() === "" ||
    typeof size !== "number" ||
    size < 0
  ) {
    return NextResponse.json(
      { error: "projectId, folderId, filename and size are required" },
      { status: 400 }
    );
  }

  try {
    const authResult = await filevineHeadersFromRequest(request);
    if ("response" in authResult) return authResult.response;
    const { headers } = authResult;

    const session = await auth();
    const uploaderId = await uploaderIdFor(session?.user?.email, headers);

    const slot = await createUploadSlot(
      { projectId, folderId, filename: filename.trim(), size, uploaderId },
      headers
    );
    const contentType = slot.contentType || "application/octet-stream";
    const ticket = await signUploadTicket({
      url: slot.url,
      documentId: slot.documentId,
      size,
      contentType,
    });
    return NextResponse.json({
      documentId: slot.documentId,
      contentType,
      ticket,
      attributed: uploaderId != null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start upload";
    return NextResponse.json({ error: message }, { status: statusForError(err) });
  }
}
