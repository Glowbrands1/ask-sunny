import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import {
  listWovenPositions,
  parsePositionReview,
  PositionReviewError,
  reviewWovenPosition,
} from "@/lib/employees/woven/positions";
import {
  authorizeWovenPeopleRequest,
  NO_STORE,
  reviewerLabel,
  wovenStoreFailureResponse,
} from "@/lib/employees/woven/route-auth";

/**
 * /api/admin/employees/woven/positions — the Woven position → role map.
 *
 * GET lists every Woven position the sync has seen, with active headcounts.
 * PATCH records a person's decision about one:
 *   { "wovenPositionId": "…", "status": "mapped", "role": "salon_director", "scopeLevel": "salon", "hierarchyRank": 30 }
 *   { "wovenPositionId": "…", "status": "ignored" }
 *   { "wovenPositionId": "…", "status": "unmapped" }
 *
 * `manage_integrations` AND `manage_users`. A mapping is a LABEL in phase one:
 * it classifies position changes and feeds the Access Preview, and it sets
 * nobody's role, scope or salon access.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_STATUS: Record<string, number> = {
  reviewed: 200,
  unknown_position: 404,
  reviewer_required: 400,
  role_and_scope_required: 400,
};

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);
    return NextResponse.json({ status: "ok", positions: await listWovenPositions() }, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/positions");
  }
}

export async function PATCH(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const review = parsePositionReview(await parseJsonBody<Record<string, unknown>>(request));
    const result = await reviewWovenPosition({ ...review, reviewedBy: reviewerLabel(context) });
    return NextResponse.json({ status: result }, { status: REVIEW_STATUS[result] ?? 400, headers: NO_STORE });
  } catch (error) {
    if (error instanceof PositionReviewError) {
      return NextResponse.json({ status: "invalid", reason: error.message }, { status: 400, headers: NO_STORE });
    }
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/positions");
  }
}
