import { NextResponse } from "next/server";
import { RELAY_MAX_BYTES, LARGE_FILE_MAX_BYTES } from "@/lib/constants";

/** What this deployment can accept, so the review screen can say so up front. */
export async function GET() {
  return NextResponse.json({
    relayMaxBytes: RELAY_MAX_BYTES,
    largeFiles: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    largeFileMaxBytes: LARGE_FILE_MAX_BYTES,
  });
}
