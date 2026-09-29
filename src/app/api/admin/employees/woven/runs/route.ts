import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { loadRuns } from "@/lib/employees/woven/directory";
import { NO_STORE, wovenStoreFailureResponse } from "@/lib/employees/woven/route-auth";

/**
 * GET /api/admin/employees/woven/runs — Sync History.
 *
 * One row per run: counts, codes and the run's own sentence. No person
 * appears, so `manage_integrations` alone, like the sync status. Read-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    return NextResponse.json({ status: "ok", runs: await loadRuns() }, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/runs");
  }
}
