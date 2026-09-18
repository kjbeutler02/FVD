import { NextResponse } from "next/server";
import { verifySessionToken, getFilevineHeaders } from "@/lib/session";

/**
 * Shared prologue for API routes: read the bearer session token and turn it
 * into Filevine headers. Returns a 401 response instead when it is missing.
 * (Invalid or expired tokens throw SessionError from verifySessionToken; the
 * route's catch maps that to 401 via statusForError.)
 */
export async function filevineHeadersFromRequest(
  request: Request
): Promise<{ headers: Record<string, string> } | { response: NextResponse }> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return { response: NextResponse.json({ error: "Missing session token" }, { status: 401 }) };
  }
  const session = await verifySessionToken(token);
  return { headers: getFilevineHeaders(session) };
}
