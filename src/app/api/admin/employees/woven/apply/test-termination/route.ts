import { NextResponse } from "next/server";

import { DirectoryError } from "@/lib/admin/user-directory";
import { applyDisableTerminatedForTestAccount } from "@/lib/admin/woven-termination";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeWovenPeopleRequest, NO_STORE } from "@/lib/employees/woven/route-auth";

/**
 * POST /api/admin/employees/woven/apply/test-termination
 *   { "appUserId": "…", "confirm": true }
 *
 * Runs the real DISABLE_TERMINATED path for ONE disposable test account — an
 * account linked to a test employee whose Woven EmployeeID starts
 * `ASK-SUNNY-TEST-` (real EmployeeIDs are UUIDs). Every planner rule, guard and
 * re-check applies exactly as in the scheduled run; only the switches are not
 * required. Any other account is refused before anything is planned or
 * touched.
 *
 * `manage_users` AND `manage_integrations`, live mode, rate-limited, explicit
 * confirmation. Returns counts and the recorded run id — no names or emails.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<Record<string, unknown>>(request);
    if (typeof body?.appUserId !== "string" || !UUID.test(body.appUserId)) {
      return NextResponse.json({ status: "invalid_input", reason: "appUserId must be an account id." }, { status: 400, headers: NO_STORE });
    }
    if (body.confirm !== true) {
      return NextResponse.json(
        { status: "confirmation_required", reason: "Confirm that this disposable test account should be disabled for real." },
        { status: 400, headers: NO_STORE },
      );
    }

    const outcome = await applyDisableTerminatedForTestAccount(body.appUserId.toLowerCase());
    return NextResponse.json(outcome, { status: outcome.status === "failed" ? 409 : 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof DirectoryError) {
      return NextResponse.json({ status: error.code, reason: error.message }, { status: error.status, headers: NO_STORE });
    }
    return errorResponse(error, "admin/employees/woven/apply/test-termination");
  }
}
