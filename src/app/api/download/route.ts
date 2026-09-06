import { NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchLocator, statusForError } from "@/lib/filevine";

export const maxDuration = 60; // Allow up to 60s on Pro tier for large files

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  let body: { documentId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { documentId } = body;
  if (typeof documentId !== "number") {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  try {
    const session = await verifySessionToken(token);
    const headers = getFilevineHeaders(session);

    // Get presigned URL server-side
    const locator = await fetchLocator(documentId, headers);

    // Download the file server-side (bypasses CORS)
    const fileRes = await fetch(locator.url);
    if (!fileRes.ok || !fileRes.body) {
      // Storage throttling is reported as such so the client backs off
      // instead of burning its retries immediately.
      const status = fileRes.status === 429 ? 429 : 502;
      return NextResponse.json(
        { error: `File download failed: storage returned ${fileRes.status}` },
        { status }
      );
    }

    // Stream the file bytes back to the client without buffering the whole
    // file in function memory (concurrent large files OOM the instance).
    const contentLength = fileRes.headers.get("Content-Length");

    return new Response(fileRes.body, {
      status: 200,
      headers: {
        "Content-Type": fileRes.headers.get("Content-Type") || "application/octet-stream",
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    const status = statusForError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
