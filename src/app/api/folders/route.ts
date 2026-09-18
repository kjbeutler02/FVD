import { type NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchFolderTree, buildFolderTree, type RawFolderItem, statusForError } from "@/lib/filevine";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId || isNaN(Number(projectId))) {
    return NextResponse.json({ error: "Valid projectId is required" }, { status: 400 });
  }

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  try {
    const session = await verifySessionToken(token);
    const headers = getFilevineHeaders(session);
    const rawItems: RawFolderItem[] = await fetchFolderTree(Number(projectId), headers);
    // The browsable tree hides archived folders; the path map keeps them so
    // documents inside archived folders still land in the right place.
    const tree = buildFolderTree(rawItems.filter((item) => !item.isArchived));

    // Also return a flat map for building folder paths on the client
    const flatMap: Record<number, { name: string; parentId: number | null }> = {};
    for (const item of rawItems) {
      const id = item.folderId?.native;
      if (id != null) {
        flatMap[id] = {
          name: item.name || `Folder ${id}`,
          parentId: item.parentId?.native ?? null,
        };
      }
    }

    return NextResponse.json({ tree, flatMap, totalCount: Object.keys(flatMap).length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch folders";
    const status = statusForError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
