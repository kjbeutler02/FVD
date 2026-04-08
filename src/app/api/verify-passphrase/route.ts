import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const passphrase = process.env.APP_PASSPHRASE;
  if (!passphrase) {
    return NextResponse.json(
      { error: "APP_PASSPHRASE not configured on server" },
      { status: 500 }
    );
  }

  let body: { passphrase?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body.passphrase || body.passphrase !== passphrase) {
    return NextResponse.json({ error: "Invalid passphrase" }, { status: 401 });
  }

  // Set an httpOnly cookie so the user stays authenticated
  const response = NextResponse.json({ ok: true });
  response.cookies.set("fvd-auth", passphrase, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return response;
}
