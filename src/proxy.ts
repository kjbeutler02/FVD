import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Gate every API route behind the Entra session except Auth.js's own
 * endpoints. Pages are not matched — the landing page ("/") renders either
 * the sign-in CTA or the app based on its own server-side auth() check.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (!req.auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/api/:path*"],
};
