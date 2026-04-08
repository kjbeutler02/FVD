import { NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchLocator } from "@/lib/filevine";

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
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `File download failed: ${fileRes.status}` },
        { status: 502 }
      );
    }

    // Stream the file bytes back to the client
    const fileBlob = await fileRes.arrayBuffer();

    return new Response(fileBlob, {
      status: 200,
      headers: {
        "Content-Type": fileRes.headers.get("Content-Type") || "application/octet-stream",
        "Content-Length": String(fileBlob.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    const status = message.includes("expired") || message.includes("JWS") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
