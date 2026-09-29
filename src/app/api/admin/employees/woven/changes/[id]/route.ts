import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { ChangeReviewError, parseChangeReview, reviewChange } from "@/lib/employees/woven/directory";
import {
  authorizeWovenPeopleRequest,
  NO_STORE,
  reviewerLabel,
  wovenStoreFailureResponse,
} from "@/lib/employees/woven/route-auth";

/**
 * PATCH /api/admin/employees/woven/changes/{id} — a person's review of one change.
 *
 *   { "reviewStatus": "acknowledged" | "dismissed" | "unreviewed" }
 *
 * Writes the change's review columns and nothing else; the append-only
 * trigger refuses any other edit, even under the secret key. Reviewing a
 * change grants, removes or alters no access. `manage_integrations` AND
 * `manage_users`; the reviewer is the verified session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const { id } = await params;
    const review = parseChangeReview(id, await parseJsonBody<Record<string, unknown>>(request));
    const result = await reviewChange({ ...review, reviewedBy: reviewerLabel(context) });
    return NextResponse.json({ status: result }, { status: result === "reviewed" ? 200 : 404, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChangeReviewError) {
      return NextResponse.json({ status: "invalid", reason: error.message }, { status: 400, headers: NO_STORE });
    }
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/changes/[id]");
  }
}
