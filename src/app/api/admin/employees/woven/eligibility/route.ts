import { NextResponse } from "next/server";

import { assertLiveMode, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { loadAccessPreviewRows } from "@/lib/employees/woven/access-preview";
import { readWovenConfig } from "@/lib/employees/woven/config";
import { authorizeWovenPeopleRequest, NO_STORE, wovenStoreFailureResponse } from "@/lib/employees/woven/route-auth";
import { evaluateEligibility } from "@/lib/employees/woven/views";

/**
 * POST /api/admin/employees/woven/eligibility — the active-employee check.
 *
 *   { "email": "name@company.com" }
 *
 * A PREVIEW of what first-login provisioning would say. It reads the synced
 * directory and the login-email rule and CREATES NOTHING: phase one has no
 * code path that creates, enables or disables a login.
 *
 * POST, not GET, so an email address never sits in a URL or an access log.
 * `manage_integrations` AND `manage_users`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ email?: unknown }>(request);
    const email = typeof body.email === "string" ? body.email.slice(0, 254) : "";
    if (email.trim().length === 0) {
      return NextResponse.json({ status: "invalid", reason: "An email address is required." }, { status: 400, headers: NO_STORE });
    }
    const domains = readWovenConfig().loginEmailDomains;
    const result = evaluateEligibility(email, await loadAccessPreviewRows(domains), domains);
    return NextResponse.json({ status: "ok", result }, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/eligibility");
  }
}
