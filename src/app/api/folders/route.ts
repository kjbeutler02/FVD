import { type NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchFolderTree, buildFolderTree, type RawFolderItem } from "@/lib/filevine";

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
    const rawItems = await fetchFolderTree(Number(projectId), headers);
    const tree = buildFolderTree(rawItems as RawFolderItem[]);

    // Also return a flat map for building folder paths on the client
    const flatMap: Record<number, { name: string; parentId: number | null }> = {};
    for (const item of rawItems as RawFolderItem[]) {
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
    const status = message.includes("expired") || message.includes("JWS") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
