import { NextResponse } from "next/server";
import { filevineHeadersFromRequest } from "@/lib/routeAuth";
import { commitDocument, statusForError } from "@/lib/filevine";

/** Step 3 of an upload: make the uploaded bytes a real document in the folder. */
export async function POST(request: Request) {
  let body: { projectId?: unknown; folderId?: unknown; documentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, folderId, documentId } = body;
  if (typeof projectId !== "number" || typeof folderId !== "number" || typeof documentId !== "number") {
    return NextResponse.json(
      { error: "projectId, folderId and documentId are required" },
      { status: 400 }
    );
  }

  try {
    const authResult = await filevineHeadersFromRequest(request);
    if ("response" in authResult) return authResult.response;
    const result = await commitDocument({ projectId, folderId, documentId }, authResult.headers);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to complete upload";
    return NextResponse.json({ error: message }, { status: statusForError(err) });
  }
}
