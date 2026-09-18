import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { LARGE_FILE_MAX_BYTES } from "@/lib/constants";

/**
 * Large files: issue a short-lived token so the browser can stage the file in
 * Vercel Blob (which allows cross-origin uploads of any size). The server then
 * relays Blob → Filevine in /api/upload/relay. Requires a Blob store connected
 * to the project (BLOB_READ_WRITE_TOKEN).
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Large-file uploads are not set up: no Blob store is connected to this project" },
      { status: 501 }
    );
  }
  // Entra session only; the Filevine session token is not sent on this call
  // because the Blob SDK owns the request body.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        maximumSizeInBytes: LARGE_FILE_MAX_BYTES,
        addRandomSuffix: true,
        // Staged files live only until the relay finishes; give the token an hour.
        validUntil: Date.now() + 60 * 60 * 1000,
        tokenPayload: JSON.stringify({ email: session.user?.email ?? null }),
      }),
      // The relay route deletes the staged blob; nothing to do on completion.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start the large-file upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
