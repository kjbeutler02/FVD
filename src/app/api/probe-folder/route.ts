import { type NextRequest, NextResponse } from "next/server";
import { getAccessToken, getOrgAndUserIds } from "@/lib/filevine";
import { getFilevineHeaders } from "@/lib/session";
import { API_ROOT } from "@/lib/constants";

/**
 * TEMPORARY, READ-ONLY diagnostic. Confirms whether Filevine's document list
 * endpoint can be scoped to a folder server-side, so we can stop scanning the
 * whole project for single-folder downloads. Protected by the same login as
 * the rest of the app. Delete once the folder-scoped scan is implemented.
 *
 * Usage (while signed in):  /api/probe-folder?projectId=12225015
 */

type Probe = {
  label: string;
  url: string;
  status: number;
  count: number | null;
  hasMore: boolean | null;
  distinctFolderIds: number[];
  error?: string;
};

async function probe(
  label: string,
  url: string,
  headers: Record<string, string>
): Promise<Probe> {
  try {
    const res = await fetch(url, { headers });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    const data = (body ?? {}) as { items?: unknown[]; hasMore?: boolean };
    const items = Array.isArray(data.items) ? data.items : [];
    const folderIds = items
      .map((d) => (d as { folderId?: { native?: number } })?.folderId?.native)
      .filter((n): n is number => typeof n === "number");
    return {
      label,
      url: url.replace(API_ROOT, "…"),
      status: res.status,
      count: items.length,
      hasMore: data.hasMore ?? null,
      distinctFolderIds: [...new Set(folderIds)].slice(0, 12),
      error: res.ok ? undefined : JSON.stringify(body).slice(0, 300),
    };
  } catch (err) {
    return {
      label,
      url: url.replace(API_ROOT, "…"),
      status: 0,
      count: null,
      hasMore: null,
      distinctFolderIds: [],
      error: err instanceof Error ? err.message : "request failed",
    };
  }
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId || isNaN(Number(projectId))) {
    return NextResponse.json(
      { error: "Pass ?projectId=<number>" },
      { status: 400 }
    );
  }

  const pat = process.env.FILEVINE_PAT;
  const clientId = process.env.FILEVINE_CLIENT_ID;
  const clientSecret = process.env.FILEVINE_CLIENT_SECRET;
  if (!pat || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Server Filevine credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const accessToken = await getAccessToken(pat, clientId, clientSecret);
    const { orgId, userId } = await getOrgAndUserIds(accessToken);
    const headers = getFilevineHeaders({ accessToken, orgId, userId });

    const base = (extra: string) =>
      `${API_ROOT}/DocumentSeries?projectId=${projectId}&limit=25&requestedFields=*${extra}`;

    // 1) Unfiltered baseline — find a folder that actually contains a document.
    const baseline = await probe("baseline (no filter)", base(""), headers);
    const target = baseline.distinctFolderIds[0] ?? null;

    const candidates: Probe[] = [];
    if (target != null) {
      candidates.push(
        await probe(`DocumentSeries?folderId=${target}`, base(`&folderId=${target}`), headers),
        await probe(`DocumentSeries?folderIds=${target}`, base(`&folderIds=${target}`), headers),
        await probe(
          `Folders/${target}/DocumentSeries`,
          `${API_ROOT}/Folders/${target}/DocumentSeries?limit=25&requestedFields=*`,
          headers
        ),
        await probe(
          `Documents?projectId&folderId=${target}`,
          `${API_ROOT}/Documents?projectId=${projectId}&folderId=${target}&requestedPage=1&pageSize=25`,
          headers
        )
      );
    }

    // For each candidate: did the filter actually scope results to one folder?
    const interpretation = candidates.map((c) => {
      const scoped =
        c.status >= 200 &&
        c.status < 300 &&
        c.distinctFolderIds.length > 0 &&
        c.distinctFolderIds.every((id) => id === target);
      const verdict =
        c.status >= 400 || c.status === 0
          ? "rejected/error"
          : scoped
          ? "✅ SCOPED to the folder — usable"
          : "ignored (returned mixed folders)";
      return { tried: c.label, status: c.status, verdict };
    });

    return NextResponse.json(
      {
        note: "Read-only probe. Compare distinctFolderIds: if a candidate returns only the target folder id, that filter works.",
        projectId: Number(projectId),
        targetFolderId: target,
        baseline,
        candidates,
        interpretation,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "probe failed" },
      { status: 500 }
    );
  }
}
