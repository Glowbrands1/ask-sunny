import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import {
  listWovenLocations,
  LocationReviewError,
  parseLocationReview,
  reviewWovenLocation,
} from "@/lib/employees/woven/locations";
import {
  authorizeWovenPeopleRequest,
  NO_STORE,
  reviewerLabel,
  wovenStoreFailureResponse,
} from "@/lib/employees/woven/route-auth";

/**
 * /api/admin/employees/woven/locations — the Woven location crosswalk.
 *
 * GET lists every Woven location the sync has seen, with Woven's catalog
 * facts, headcounts and exact-number salon suggestions.
 * PATCH records a person's decision about one:
 *   { "wovenLocationId": "…", "status": "mapped", "salonNumber": "0306" }
 *   { "wovenLocationId": "…", "status": "ignored" }
 *   { "wovenLocationId": "…", "status": "unmapped" }
 *
 * PERMISSION: `manage_integrations` AND `manage_users` (raised from
 * `manage_integrations` alone, 29 September 2026). A mapping is a decision
 * about where people work, so it sits with the people permission. Both
 * already exist; the matrix is unchanged. The reviewer is the verified
 * session, never the body.
 *
 * A mapping says which Ask Sunny salon a Woven location is. It changes nobody's
 * access in phase one.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_STATUS: Record<string, number> = {
  reviewed: 200,
  unknown_location: 404,
  unknown_salon: 422,
  reviewer_required: 400,
};

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);
    return NextResponse.json({ status: "ok", locations: await listWovenLocations() }, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/locations");
  }
}

export async function PATCH(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const review = parseLocationReview(await parseJsonBody<Record<string, unknown>>(request));
    const result = await reviewWovenLocation({ ...review, reviewedBy: reviewerLabel(context) });
    return NextResponse.json({ status: result }, { status: REVIEW_STATUS[result] ?? 400, headers: NO_STORE });
  } catch (error) {
    if (error instanceof LocationReviewError) {
      return NextResponse.json({ status: "invalid", reason: error.message }, { status: 400, headers: NO_STORE });
    }
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/locations");
  }
}
