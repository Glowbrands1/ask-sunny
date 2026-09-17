import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import {
  applyAnchors,
  MAX_ANCHORS_PER_REQUEST,
  normaliseAnchorRequests,
} from "@/lib/reviews/anchors";

/**
 * POST /api/admin/reviews/anchor — an administrator sets a listing's baseline.
 *
 * ============================================================================
 * WHY THIS EXISTS BESIDE `/api/reviews/anchor`
 * ============================================================================
 *
 * They are the same capability reached by two different kinds of caller, and
 * the difference is entirely in who is asking:
 *
 *   `/api/reviews/anchor` authenticates a MACHINE with the review-sync
 *   credential. It is for automation, and a browser must never hold that token.
 *
 *   THIS ROUTE authenticates a PERSON, through the same session every other
 *   admin screen uses. The anchor setup screen calls it, and the alternative —
 *   putting the machine token into a browser so the UI could call the other
 *   route — would be handing a page a credential that can file reviews for the
 *   whole estate, to save writing one route handler.
 *
 * BOTH END IN `applyAnchors`, so the rules that matter are stated once: the
 * store-code allowlist, the refusal to replace an existing anchor without being
 * asked, and the promotion rule itself. Nothing about reporting assignment is
 * duplicated here or in the client.
 *
 * ============================================================================
 * THE GATE IS `manage_integrations`, WHICH IS ADMINISTRATION-ONLY
 * ============================================================================
 *
 * Held by `admin`, `owner` and `developer` and by nobody else. A Salon Director
 * or District Manager reaching this route is refused with 403 by
 * `authorizeRequest` before a store code is read — and that is the right line:
 * `view_google_reviews` is held by most of the org chart and lets somebody READ
 * the dashboard, while moving an anchor changes what the business counts.
 *
 * It is the same permission the Integrations screen is gated by, deliberately.
 * Connecting Google and telling ASK Sunny where last week's count ended are one
 * setup job, and splitting them would create a role that can do half of it.
 *
 * `authorizeRequest` RUNS BEFORE THE PRIVILEGED CLIENT IS TOUCHED, which is the
 * ordering every admin route here keeps: `applyAnchors` holds a client that
 * bypasses row level security, so nothing may reach it that has not already
 * been authorized against a verified identity and the server's own matrix.
 *
 * ============================================================================
 * REPLACING AN ANCHOR IS A DIFFERENT REQUEST FROM SETTING ONE
 * ============================================================================
 *
 * A listing that already has an anchor is refused with `anchor_exists` unless
 * the body says `replace: true` for that listing. The screen only sends it
 * after showing the current anchor and making somebody tick a box, but the
 * refusal is in `applyAnchors` rather than in the screen — a UI is not a
 * boundary, and a bulk baseline that quietly moved fourteen settled anchors
 * would be the worst possible outcome of a convenience button.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    /* After authorization, so an unauthorized caller cannot spend an admin's budget. */
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ anchors?: unknown }>(request);
    const requests = normaliseAnchorRequests(body.anchors ?? []);

    if (requests.length > MAX_ANCHORS_PER_REQUEST) {
      throw new AiError(
        "bad_request",
        `At most ${MAX_ANCHORS_PER_REQUEST} listings may be anchored in one request.`,
        400,
      );
    }

    const anchors = await applyAnchors(requests, {
      /*
       * THE AUDIT LABEL IS THE PERSON, TAKEN FROM THE SESSION. It lands in
       * `counted_through_set_by`, so "who moved this boundary" has an answer —
       * and there is no field in the body a caller could put somebody else's
       * name in, which is the only thing that makes it worth reading.
       */
      credentialId: `admin:${context.identity.email || context.identity.subject}`.slice(0, 64),
    });

    return NextResponse.json({ status: "ok", anchors });
  } catch (error) {
    return errorResponse(error, "admin/reviews/anchor");
  }
}
