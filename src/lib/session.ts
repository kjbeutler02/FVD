import { SignJWT, jwtVerify } from "jose";
import { SESSION_TTL_SECONDS } from "./constants";

interface SessionPayload {
  accessToken: string;
  orgId: string;
  userId: string;
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
  const { payload } = await jwtVerify(token, getSecret());
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
