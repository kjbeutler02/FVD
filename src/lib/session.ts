import { EncryptJWT, jwtDecrypt, errors as joseErrors } from "jose";
import { SESSION_TTL_SECONDS } from "./constants";

interface SessionPayload {
  accessToken: string;
  orgId: string;
  userId: string;
}

/**
 * The client's Filevine session token is missing, expired, or invalid. API
 * routes turn this into a 401 so the client mints a fresh token and retries.
 * (jose's own error messages — e.g. `"exp" claim timestamp check failed` —
 * don't say "expired", so routes must not rely on message matching.)
 */
export class SessionError extends Error {
  constructor(
    message: string,
    public readonly expired: boolean
  ) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * The session token carries the Filevine access token for the firm's shared
 * API account, and it is handed to the browser. It is therefore encrypted,
 * not merely signed: a signed JWT's payload is readable by anyone holding it,
 * which would give every signed-in user a bearer token for the Filevine API
 * itself. The key is derived from SESSION_SECRET (any length) by SHA-256.
 */
async function getKey(): Promise<Uint8Array> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET environment variable is required");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new EncryptJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuedAt()
    .encrypt(await getKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  // Resolve the key outside the try so a missing SESSION_SECRET surfaces as
  // a server misconfiguration (500), not as a client session problem (401).
  const key = await getKey();
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtDecrypt(token, key, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new SessionError("Session token expired", true);
    }
    throw new SessionError("Invalid session token", false);
  }
  if (
    typeof payload.accessToken !== "string" ||
    typeof payload.orgId !== "string" ||
    typeof payload.userId !== "string"
  ) {
    throw new SessionError("Invalid session token", false);
  }
  return {
    accessToken: payload.accessToken,
    orgId: payload.orgId,
    userId: payload.userId,
  };
}

export function getFilevineHeaders(session: SessionPayload): Record<string, string> {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "x-fv-orgid": session.orgId,
    "x-fv-userid": session.userId,
    Accept: "application/json",
  };
}
