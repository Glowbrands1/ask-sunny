import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { LinkReviewError, parseLinkReview } from "@/lib/employees/woven/access/link-review";
import { recordLinkReview } from "@/lib/employees/woven/access/link-store";
import {
  authorizeWovenPeopleRequest,
  NO_STORE,
  reviewerLabel,
  wovenStoreFailureResponse,
} from "@/lib/employees/woven/route-auth";

/**
 * POST /api/admin/employees/woven/links — a person's link-review decision.
 *
 *   { "appUserId": "…", "externalEmployeeId": "…", "decision": "confirm", "samePersonConfirmed": true,
 *     "managedStatus": false, "managedLocation": false, "managedRole": false }
 *   { "appUserId": "…", "externalEmployeeId": "…", "decision": "not_woven_managed" }
 *
 * `manage_integrations` AND `manage_users`, live mode only, rate-limited. The
 * reviewer comes from the session. Accepted only for a match the planner is
 * proposing right now. Records a link; changes nobody's access.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const input = parseLinkReview(await parseJsonBody<Record<string, unknown>>(request));
    const link = await recordLinkReview(input, reviewerLabel(context));
    return NextResponse.json(
      {
        status: link.management === "woven_linked" ? "linked" : "marked_not_woven_managed",
        link: {
          appUserId: link.app_user_id,
          externalEmployeeId: link.external_employee_id,
          managedStatus: link.managed_status,
          managedLocation: link.managed_location,
          managedRole: link.managed_role,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof LinkReviewError) {
      return NextResponse.json({ status: error.code, reason: error.message }, { status: error.status, headers: NO_STORE });
    }
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/links");
  }
}
