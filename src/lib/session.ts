import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
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

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  // Resolve the secret outside the try so a missing SESSION_SECRET surfaces as
  // a server misconfiguration (500), not as a client session problem (401).
  const secret = getSecret();
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new SessionError("Session token expired", true);
    }
    throw new SessionError("Invalid session token", false);
  }
  return {
    accessToken: payload.accessToken as string,
    orgId: payload.orgId as string,
    userId: payload.userId as string,
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
