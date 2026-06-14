import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Clear the signed auth cookie set by /api/verify-passphrase.
  response.cookies.set("fvd-auth", "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return response;
}
