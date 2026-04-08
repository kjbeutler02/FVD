import { NextResponse } from "next/server";
import { getAccessToken, getOrgAndUserIds } from "@/lib/filevine";
import { createSessionToken } from "@/lib/session";

export async function POST() {
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

    return NextResponse.json({ sessionToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
