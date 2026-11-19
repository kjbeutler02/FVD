import { NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";
import { fetchLocator, statusForError } from "@/lib/filevine";
import {
  DOWNLOAD_ETAG_HEADER,
  DOWNLOAD_OFFSET_HEADER,
  DOWNLOAD_SIZE_HEADER,
} from "@/lib/constants";

// Large files (600+ page PDFs) can take well over a minute to stream from
// Filevine; matches the upload relay's limit. A file too large to finish in
// one request is continued by the client from the byte it stopped at.
export const maxDuration = 300;

/** Total object size from a `Content-Range: bytes 0-99/1234` header, if stated. */
function parseContentRange(value: string | null): { start: number; total: number | null } | null {
  const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(value?.trim() ?? "");
  if (!match) return null;
  return { start: Number(match[1]), total: match[2] === "*" ? null : Number(match[2]) };
}

function byteCount(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });
  }

  let body: { documentId?: number; offset?: number; etag?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { documentId } = body;
  if (typeof documentId !== "number") {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }
  // Resuming an interrupted transfer: the client already holds `offset` bytes
  // of the object identified by `etag`.
  const offset = body.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "offset must be a non-negative integer" }, { status: 400 });
  }
  const etag = typeof body.etag === "string" && body.etag !== "" ? body.etag : null;

  try {
    const session = await verifySessionToken(token);
    const headers = getFilevineHeaders(session);

    // Get presigned URL server-side
    const locator = await fetchLocator(documentId, headers);

    // Download the file server-side (bypasses CORS)
    const rangeHeaders: Record<string, string> = {};
    if (offset > 0) {
      rangeHeaders.Range = `bytes=${offset}-`;
      // Only continue the same object: if it changed, storage answers 412.
      if (etag && !etag.startsWith("W/")) rangeHeaders["If-Match"] = etag;
    }
    const fileRes = await fetch(locator.url, { headers: rangeHeaders });

    if (offset > 0 && fileRes.status === 412) {
      await fileRes.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: "The file changed in Filevine during the download" },
        { status: 409 }
      );
    }

    // Asked to resume at (or past) the end: nothing left to send.
    if (offset > 0 && fileRes.status === 416) {
      await fileRes.body?.cancel().catch(() => {});
      const total = parseContentRange(fileRes.headers.get("Content-Range"))?.total ?? null;
      if (total !== offset) {
        return NextResponse.json(
          { error: "The file changed in Filevine during the download" },
          { status: 409 }
        );
      }
      return new Response(null, {
        status: 200,
        headers: {
          [DOWNLOAD_OFFSET_HEADER]: String(offset),
          [DOWNLOAD_SIZE_HEADER]: String(total),
        },
      });
    }

    if (!fileRes.ok || !fileRes.body) {
      await fileRes.body?.cancel().catch(() => {});
      // Storage throttling is reported as such so the client backs off
      // instead of burning its retries immediately.
      const status = fileRes.status === 429 ? 429 : 502;
      return NextResponse.json(
        { error: `File download failed: storage returned ${fileRes.status}` },
        { status }
      );
    }

    // Where this response starts within the file, and how long the whole
    // file is. The client checks the bytes it ends up with against the size,
    // so a transfer cut short is never mistaken for a complete file.
    // (fetch transparently decodes a Content-Encoding, after which the
    // upstream Content-Length no longer describes the bytes we pass on.)
    const encoded = fileRes.headers.has("Content-Encoding");
    const contentLength = encoded ? null : byteCount(fileRes.headers.get("Content-Length"));
    let start = 0;
    let total: number | null = contentLength;
    if (fileRes.status === 206) {
      const range = parseContentRange(fileRes.headers.get("Content-Range"));
      if (!range || range.start !== offset) {
        await fileRes.body.cancel().catch(() => {});
        return NextResponse.json(
          { error: "File download failed: storage returned an unexpected byte range" },
          { status: 502 }
        );
      }
      start = range.start;
      total = range.total;
    }
    // A plain 200 to a ranged request means storage ignored the range and is
    // sending the whole file; `start` stays 0 and the client starts over.

    const upstreamEtag = fileRes.headers.get("ETag");

    // Stream the file bytes back to the client without buffering the whole
    // file in function memory (concurrent large files OOM the instance).
    return new Response(fileRes.body, {
      status: 200,
      headers: {
        "Content-Type": fileRes.headers.get("Content-Type") || "application/octet-stream",
        "Cache-Control": "no-store",
        ...(contentLength != null ? { "Content-Length": String(contentLength) } : {}),
        [DOWNLOAD_OFFSET_HEADER]: String(start),
        ...(total != null ? { [DOWNLOAD_SIZE_HEADER]: String(total) } : {}),
        ...(upstreamEtag ? { [DOWNLOAD_ETAG_HEADER]: upstreamEtag } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    const status = statusForError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
