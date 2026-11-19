import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { FilevineError, getAccessToken, getOrgAndUserIds } from "@/lib/filevine";
import { createSessionToken } from "@/lib/session";
import { SESSION_TTL_SECONDS } from "@/lib/constants";

export async function POST() {
  // Only Entra-authenticated users may obtain a Filevine session token.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pat = process.env.FILEVINE_PAT;
  const clientId = process.env.FILEVINE_CLIENT_ID;
  const clientSecret = process.env.FILEVINE_CLIENT_SECRET;

  if (!pat || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Server credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const accessToken = await getAccessToken(pat, clientId, clientSecret);
    const { orgId, userId } = await getOrgAndUserIds(accessToken);
    const sessionToken = await createSessionToken({ accessToken, orgId, userId });

    // The token is opaque to the client, so its lifetime is stated alongside.
    return NextResponse.json({ sessionToken, expiresIn: SESSION_TTL_SECONDS });
  } catch (err) {
    // Never 401 here: on this route 401 means "your Microsoft sign-in has
    // expired", and the client answers it by leaving the page. A Filevine
    // hiccup while renewing the token in the middle of a long download must
    // stay retryable instead (throttling is passed through as such).
    const message = err instanceof Error ? err.message : "Authentication failed";
    const status = err instanceof FilevineError && err.upstreamStatus === 429 ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
