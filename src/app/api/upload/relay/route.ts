import { NextResponse } from "next/server";
import { get, del } from "@vercel/blob";
import { filevineHeadersFromRequest } from "@/lib/routeAuth";
import { statusForError } from "@/lib/filevine";
import { verifyUploadTicket } from "@/lib/uploadTicket";
import { putToFilevineStorage } from "@/lib/storageRelay";

// Streaming a multi-gigabyte file Blob → Filevine can take a while.
export const maxDuration = 300;

/**
 * Step 2 (large files): the file is already staged in Vercel Blob. Stream it
 * from Blob to Filevine storage, then delete the staged copy. Nothing is
 * buffered in memory.
 */
export async function POST(request: Request) {
  let body: { ticket?: unknown; blobUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { ticket: ticketToken, blobUrl } = body;
  if (typeof ticketToken !== "string" || typeof blobUrl !== "string") {
    return NextResponse.json({ error: "ticket and blobUrl are required" }, { status: 400 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Large-file uploads are not set up" }, { status: 501 });
  }

  try {
    const authResult = await filevineHeadersFromRequest(request);
    if ("response" in authResult) return authResult.response;
    const ticket = await verifyUploadTicket(ticketToken);

    // Only blobs in our own store are readable with our token, so a foreign
    // URL simply fails here rather than being fetched.
    const staged = await get(blobUrl, { access: "private", useCache: false });
    if (!staged || staged.statusCode !== 200 || !staged.stream) {
      return NextResponse.json({ error: "The staged file could not be read" }, { status: 400 });
    }
    // Private-store reads report size 0 in `blob`; the response header is the
    // reliable figure. If it disagrees with the ticket, refuse rather than
    // send a truncated or padded file (S3 would also reject a length mismatch).
    const headerLength = Number(staged.headers.get("content-length"));
    const stagedSize = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : staged.blob.size;
    if (stagedSize > 0 && stagedSize !== ticket.size) {
      await del(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: `Staged file is ${stagedSize} bytes but the upload was declared as ${ticket.size}` },
        { status: 400 }
      );
    }

    try {
      await putToFilevineStorage(ticket.url, staged.stream, ticket.size, ticket.contentType);
    } finally {
      // The staged copy has served its purpose either way.
      await del(blobUrl).catch(() => {});
    }
    return NextResponse.json({ ok: true, documentId: ticket.documentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send the file to Filevine";
    return NextResponse.json({ error: message }, { status: statusForError(err) });
  }
}
