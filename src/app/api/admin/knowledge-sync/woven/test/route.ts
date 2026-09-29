import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { testWovenConnection } from "@/lib/knowledge-sync/woven/sync";

/**
 * POST /api/admin/knowledge-sync/woven/test — "Test Connection".
 *
 * Signs in to Woven Team with the configured integration account, confirms the
 * company is JB & Associates, and reads one small list. Writes nothing to Woven
 * or to Ask Sunny. The answer is a status, the company name and a count.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");
    const result = await testWovenConnection();
    const status = result.status === "ok" || result.status === "disabled" ? 200 : result.status === "not_configured" ? 503 : 502;
    return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "admin/knowledge-sync/woven/test");
  }
}
