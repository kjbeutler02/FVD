import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { SessionError } from "./session";

/**
 * A signed, short-lived pass that lets the browser ask our server to push a
 * specific file's bytes to a specific Filevine storage URL. The URL itself
 * never has to be trusted from the client: it is sealed into the ticket when
 * the upload slot is created. Tickets expire with Filevine's 5-hour URL.
 */
export interface UploadTicket {
  url: string;
  documentId: number;
  size: number;
  contentType: string;
}

const TICKET_TTL_SECONDS = 5 * 60 * 60;
const STORAGE_HOST = /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i;

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

export async function signUploadTicket(ticket: UploadTicket): Promise<string> {
  const host = new URL(ticket.url).host;
  if (!STORAGE_HOST.test(host)) {
    throw new Error(`Unexpected storage host for upload: ${host}`);
  }
  return new SignJWT({ ...ticket, kind: "upload" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyUploadTicket(token: string): Promise<UploadTicket> {
  const secret = getSecret();
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new SessionError("Upload ticket expired", true);
    throw new SessionError("Invalid upload ticket", false);
  }
  if (payload.kind !== "upload" || typeof payload.url !== "string") {
    throw new SessionError("Invalid upload ticket", false);
  }
  return {
    url: payload.url,
    documentId: Number(payload.documentId),
    size: Number(payload.size),
    contentType: String(payload.contentType || "application/octet-stream"),
  };
}
