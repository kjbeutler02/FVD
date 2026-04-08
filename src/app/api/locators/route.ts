import { NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchLocator } from "@/lib/filevine";
import { LOCATOR_BATCH_SIZE } from "@/lib/constants";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  let body: { documentIds?: number[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { documentIds } = body;
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return NextResponse.json({ error: "documentIds array is required" }, { status: 400 });
  }
  if (documentIds.length > LOCATOR_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Max ${LOCATOR_BATCH_SIZE} document IDs per request` },
      { status: 400 }
    );
  }

  try {
    const session = await verifySessionToken(token);
    const headers = getFilevineHeaders(session);

    const results = await Promise.allSettled(
      documentIds.map(async (docId) => {
        const data = await fetchLocator(docId, headers);
        return { documentId: docId, url: data.url };
      })
    );

    const locators = results.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        documentId: documentIds[i],
        url: undefined,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      };
    });

    return NextResponse.json({ locators });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch locators";
    const status = message.includes("expired") || message.includes("JWS") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
