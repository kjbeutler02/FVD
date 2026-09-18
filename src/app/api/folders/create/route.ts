import { NextResponse } from "next/server";
import { filevineHeadersFromRequest } from "@/lib/routeAuth";
import { createFolder, statusForError } from "@/lib/filevine";

/** Create one folder under a parent so uploads can mirror a local folder tree. */
export async function POST(request: Request) {
  let body: { projectId?: unknown; parentId?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, parentId, name } = body;
  if (typeof projectId !== "number" || typeof parentId !== "number" || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "projectId, parentId and name are required" }, { status: 400 });
  }

  try {
    const authResult = await filevineHeadersFromRequest(request);
    if ("response" in authResult) return authResult.response;
    const folderId = await createFolder(
      { projectId, parentId, name: name.trim() },
      authResult.headers
    );
    return NextResponse.json({ folderId, name: name.trim(), parentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create folder";
    return NextResponse.json({ error: message }, { status: statusForError(err) });
  }
}
