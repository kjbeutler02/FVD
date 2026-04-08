import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the passphrase verification endpoint and static assets through
  if (
    pathname === "/api/verify-passphrase" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const passphrase = process.env.APP_PASSPHRASE;
  if (!passphrase) {
    // If no passphrase is set, allow all access (dev mode)
    return NextResponse.next();
  }

  const cookie = request.cookies.get("fvd-auth");
  if (cookie?.value === passphrase) {
    return NextResponse.next();
  }

  // For API routes, return 401
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For page requests, let through but the client-side will show the gate
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
