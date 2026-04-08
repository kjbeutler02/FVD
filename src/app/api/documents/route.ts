import { type NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchDocumentPage } from "@/lib/filevine";

interface RawDocItem {
  documentId?: { native?: number };
  filename?: string;
  folderId?: { native?: number };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const projectId = params.get("projectId");
  const lastId = params.get("lastId") ?? "0";
  const limit = params.get("limit") ?? "200";

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
    const page = await fetchDocumentPage(
      Number(projectId),
      Number(lastId),
      Number(limit),
      headers
    );

    const items = (page.items as RawDocItem[]).map((doc) => ({
      documentId: doc.documentId?.native ?? 0,
      filename: doc.filename ?? "unknown",
      folderId: doc.folderId?.native ?? 0,
    }));

    return NextResponse.json({
      items,
      hasMore: page.hasMore,
      lastId: page.lastId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch documents";
    const status = message.includes("expired") || message.includes("JWS") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
