import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import {
  listWovenLocations,
  LocationReviewError,
  parseLocationReview,
  reviewWovenLocation,
} from "@/lib/employees/woven/locations";
import { EmployeeStoreError } from "@/lib/employees/woven/store";

/**
 * /api/admin/employees/woven/locations — the Woven location crosswalk.
 *
 * GET lists every Woven location the sync has seen, unmapped first.
 * PATCH records a person's decision about one:
 *   { "wovenLocationId": "…", "status": "mapped", "salonNumber": "0306" }
 *   { "wovenLocationId": "…", "status": "ignored" }
 *   { "wovenLocationId": "…", "status": "unmapped" }
 *
 * A mapping says which Ask Sunny salon a Woven location is. It changes nobody's
 * access. `manage_integrations` only; the reviewer is the verified session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const REVIEW_STATUS: Record<string, number> = {
  reviewed: 200,
  unknown_location: 404,
  unknown_salon: 422,
  reviewer_required: 400,
};

function storeFailure(error: EmployeeStoreError) {
  return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
}

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    return NextResponse.json({ status: "ok", locations: await listWovenLocations() }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmployeeStoreError) return storeFailure(error);
    return errorResponse(error, "admin/employees/woven/locations");
  }
}

export async function PATCH(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const review = parseLocationReview(await parseJsonBody<Record<string, unknown>>(request));
    const result = await reviewWovenLocation({
      ...review,
      reviewedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
    });
    return NextResponse.json({ status: result }, { status: REVIEW_STATUS[result] ?? 400, headers: NO_STORE });
  } catch (error) {
    if (error instanceof LocationReviewError) {
      return NextResponse.json({ status: "invalid", reason: error.message }, { status: 400, headers: NO_STORE });
    }
    if (error instanceof EmployeeStoreError) return storeFailure(error);
    return errorResponse(error, "admin/employees/woven/locations");
  }
}
