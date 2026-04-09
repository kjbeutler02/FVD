import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

async function verifyAuthCookieInMiddleware(cookie: string): Promise<boolean> {
  // Replicate the HMAC check from lib/users.ts
  // (middleware runs in edge runtime, so we inline it here)
  const colonIndex = cookie.indexOf(":");
  if (colonIndex === -1) return false;

  const username = cookie.slice(0, colonIndex);
  const providedHmac = cookie.slice(colonIndex + 1);

  const secret = process.env.SESSION_SECRET || "dev-secret";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(username)
  );
  const expectedHmac = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return providedHmac === expectedHmac;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the login endpoint and static assets through
  if (
    pathname === "/api/verify-passphrase" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const usersConfigured = !!process.env.APP_USERS;
  if (!usersConfigured) {
    // No users configured -- allow all access (dev mode)
    return NextResponse.next();
  }

  const cookie = request.cookies.get("fvd-auth");
  if (cookie?.value && (await verifyAuthCookieInMiddleware(cookie.value))) {
    return NextResponse.next();
  }

  // For API routes, return 401
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For page requests, let through -- client-side shows the login gate
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
