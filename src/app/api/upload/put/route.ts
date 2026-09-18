import { NextResponse } from "next/server";
import { filevineHeadersFromRequest } from "@/lib/routeAuth";
import { statusForError } from "@/lib/filevine";
import { verifyUploadTicket } from "@/lib/uploadTicket";
import { putToFilevineStorage } from "@/lib/storageRelay";
import { RELAY_MAX_BYTES } from "@/lib/constants";

export const maxDuration = 60;

/**
 * Step 2 (small files): the browser sends the raw file bytes here with its
 * upload ticket, and we PUT them to Filevine storage. Bounded by Vercel's
 * request-body limit; larger files take the Blob path.
 */
export async function POST(request: Request) {
  const ticketToken = request.headers.get("x-upload-ticket");
  if (!ticketToken) {
    return NextResponse.json({ error: "Missing upload ticket" }, { status: 400 });
  }
  try {
    const authResult = await filevineHeadersFromRequest(request);
    if ("response" in authResult) return authResult.response;
    const ticket = await verifyUploadTicket(ticketToken);

    if (ticket.size > RELAY_MAX_BYTES) {
      return NextResponse.json(
        { error: `Files over ${Math.round(RELAY_MAX_BYTES / 1024 / 1024)} MB must use the large-file path` },
        { status: 413 }
      );
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== ticket.size) {
      return NextResponse.json(
        { error: `Received ${bytes.byteLength} bytes but the file is ${ticket.size} bytes` },
        { status: 400 }
      );
    }
    await putToFilevineStorage(ticket.url, bytes, ticket.size, ticket.contentType);
    return NextResponse.json({ ok: true, documentId: ticket.documentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send the file to Filevine";
    return NextResponse.json({ error: message }, { status: statusForError(err) });
  }
}
