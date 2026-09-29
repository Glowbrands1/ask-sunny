import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { loadDirectoryRows } from "@/lib/employees/woven/directory";
import { authorizeWovenPeopleRequest, NO_STORE, wovenStoreFailureResponse } from "@/lib/employees/woven/route-auth";
import { parseDirectoryQuery, queryDirectory } from "@/lib/employees/woven/views";

/**
 * GET /api/admin/employees/woven/directory — the Employee Directory.
 *
 * Query: `q` (name, email or Woven ID), `filter` (repeatable: active,
 * terminated, new_hire, position_changed, transfer, multiple_locations,
 * missing_email, unmapped_position, unmapped_location), `location`,
 * `position`, `page`. Filtering is `views.ts`, the same rules the page uses.
 *
 * Returns names and email addresses, so `manage_integrations` AND
 * `manage_users`. Read-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);
    const url = new URL(request.url);
    const params: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      params[key] = values.length > 1 ? values : values[0];
    }
    const page = queryDirectory(await loadDirectoryRows(), parseDirectoryQuery(params));
    return NextResponse.json({ status: "ok", ...page }, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/directory");
  }
}
