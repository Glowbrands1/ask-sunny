import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  applyAnchors,
  MAX_ANCHORS_PER_REQUEST,
  normaliseAnchorRequests,
} from "@/lib/reviews/anchors";
import { authorizeReviewSync } from "@/lib/reviews/sync-credential";

/**
 * POST /api/reviews/anchor — tell ASK Sunny where last week's count ended.
 *
 * ============================================================================
 * WHY THIS ROUTE EXISTS
 * ============================================================================
 *
 * Nothing counts until a listing has a reporting anchor: an import lands as
 * historical and stays there. That is the safety property, and this is the one
 * door through it. Two shapes, per listing:
 *
 *   { "storeCode": "306", "externalReviewId": "0389…" }
 *       The old spreadsheet's last-counted review. Everything held above it,
 *       on the page where it was seen, joins the open period.
 *
 *   { "storeCode": "306", "fromNewestHeld": true }
 *       "Everything we hold is history; count from the next one." Assigns
 *       nothing, and is the safe way to start a listing from scratch.
 *
 * ============================================================================
 * THE SAME CREDENTIAL AS THE SYNC, AND WHY
 * ============================================================================
 *
 * Both are the same act by the same person on the same afternoon — importing
 * reviews and telling the system which of them were already counted — and
 * splitting them across two credentials would mean two secrets to rotate for
 * one job. It is still the narrow machine credential: it can file reviews and
 * move an anchor, and it can do nothing else.
 *
 * MOVING AN ANCHOR CANNOT UNCOUNT ANYTHING. `reporting_period_id` is write-once
 * once set, enforced by a trigger — so the worst a wrong anchor can do is
 * promote reviews that should have stayed historical, or fail to promote ones
 * that should have counted. Both are visible on the dashboard and correctable
 * by anchoring again; neither can silently rewrite a closed week.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/reviews/anchor",
    method: "POST",
    authorization: "Bearer <token>",
    maxAnchorsPerRequest: MAX_ANCHORS_PER_REQUEST,
    shapes: [
      { storeCode: "306", externalReviewId: "<google review id>" },
      { storeCode: "306", fromNewestHeld: true },
    ],
  });
}

export async function POST(request: Request) {
  try {
    if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
      return NextResponse.json(
        {
          status: "not_configured",
          code: "supabase_missing",
          reason: "Supabase is not configured in this runtime, so no anchor can be set.",
        },
        { status: 503 },
      );
    }

    /* Same order as the sync route: credential before body. */
    const auth = await authorizeReviewSync(request.headers);

    if (auth.status === "unconfigured") {
      return NextResponse.json(
        { status: "not_configured", code: "sync_token_missing", reason: auth.problem },
        { status: 503 },
      );
    }
    if (auth.status === "rate_limited") {
      return NextResponse.json(
        {
          status: "rate_limited",
          code: "too_many_attempts",
          reason: `Too many failed attempts. Try again in ${auth.retryAfterSeconds} seconds.`,
        },
        { status: 429, headers: { "Retry-After": String(auth.retryAfterSeconds) } },
      );
    }
    if (auth.status === "unauthorized") {
      return NextResponse.json(
        {
          status: "unauthorized",
          code: "invalid_token",
          reason: "This sync token is not accepted.",
        },
        { status: 401 },
      );
    }

    const body = await parseJsonBody<{ anchors?: unknown }>(request);
    const requests = normaliseAnchorRequests(body.anchors ?? []);
    const outcomes = await applyAnchors(requests, { credentialId: auth.credentialId });

    return NextResponse.json({
      status: "ok",
      credentialId: auth.credentialId,
      anchors: outcomes,
    });
  } catch (error) {
    return errorResponse(error, "reviews/anchor");
  }
}
