import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { loadChangePage } from "@/lib/employees/woven/directory";
import { authorizeWovenPeopleRequest, NO_STORE, wovenStoreFailureResponse } from "@/lib/employees/woven/route-auth";
import { parseChangeQuery } from "@/lib/employees/woven/views";

/**
 * GET /api/admin/employees/woven/changes — the Change Feed.
 *
 * Query: `kind` (one change type), `review` (unreviewed, acknowledged,
 * dismissed), `page`. Newest first. Carries employee names, so
 * `manage_integrations` AND `manage_users`. Read-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);
    const url = new URL(request.url);
    const page = await loadChangePage(
      parseChangeQuery({
        kind: url.searchParams.get("kind") ?? undefined,
        review: url.searchParams.get("review") ?? undefined,
        page: url.searchParams.get("page") ?? undefined,
      }),
    );
    return NextResponse.json({ status: "ok", ...page }, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/changes");
  }
}
