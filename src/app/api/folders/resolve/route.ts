import { NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchFolder, statusForError } from "@/lib/filevine";
import { FOLDER_RESOLVE_BATCH, FOLDER_RESOLVE_CONCURRENCY } from "@/lib/constants";

interface ResolvedFolder {
  name: string;
  parentId: number | null;
}

/**
 * Look up folders by id. Used after a document scan for any folder the
 * project's folder list did not include, so those documents keep their real
 * path instead of falling to the archive root. Ids Filevine no longer knows
 * are returned in `missing`.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  let body: { folderIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const folderIds = Array.isArray(body.folderIds)
    ? body.folderIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    : [];
  if (folderIds.length === 0) {
    return NextResponse.json({ error: "folderIds array is required" }, { status: 400 });
  }
  if (folderIds.length > FOLDER_RESOLVE_BATCH) {
    return NextResponse.json(
      { error: `Max ${FOLDER_RESOLVE_BATCH} folder IDs per request` },
      { status: 400 }
    );
  }

  try {
    const session = await verifySessionToken(token);
    const headers = getFilevineHeaders(session);

    const folders: Record<number, ResolvedFolder> = {};
    const missing: number[] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < folderIds.length) {
        const id = folderIds[cursor++];
        const item = await fetchFolder(id, headers);
        if (!item) {
          missing.push(id);
          continue;
        }
        folders[id] = {
          name: item.name || `Folder ${id}`,
          parentId: item.parentId?.native ?? null,
        };
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(FOLDER_RESOLVE_CONCURRENCY, folderIds.length) }, () => worker())
    );

    return NextResponse.json({ folders, missing });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve folders";
    const status = statusForError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
