import { NextResponse } from "next/server";
import { validateCredentials, hasUsersConfigured, createAuthCookie } from "@/lib/users";

export async function POST(request: Request) {
  if (!hasUsersConfigured()) {
    return NextResponse.json(
      { error: "APP_USERS not configured on server" },
      { status: 500 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body.username || !body.password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const username = validateCredentials(body.username, body.password);
  if (!username) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  // Set a signed httpOnly cookie
  const cookieValue = await createAuthCookie(username);
  const response = NextResponse.json({ ok: true, username });
  response.cookies.set("fvd-auth", cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
