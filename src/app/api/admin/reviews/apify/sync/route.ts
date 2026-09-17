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
import { readApifySourceStatus } from "@/lib/reviews/apify/status";
import { completeApifyRun, startApifySync } from "@/lib/reviews/apify/sync";
import {
  resolveCallbackBaseUrl,
  webhookSecretForOutboundUse,
} from "@/lib/reviews/apify/webhook-credential";

/**
 * POST /api/admin/reviews/apify/sync — "Sync Google Reviews Now", and the
 * manual historical import behind "Import Google Review History via Apify".
 *
 * ============================================================================
 * WHY A SEPARATE ROUTE FROM THE CRON ONE
 * ============================================================================
 *
 * Same capability, two kinds of caller, and the difference is entirely in who
 * is asking — which is the reason `/api/admin/reviews/anchor` already sits
 * beside `/api/reviews/anchor` in this codebase.
 *
 *   THE CRON ROUTE authenticates a MACHINE with `CRON_SECRET`. A browser must
 *   never hold that value.
 *
 *   THIS ROUTE authenticates a PERSON, through the same session every other
 *   admin screen uses, and records that person's email as the run's requester.
 *
 * BOTH END IN `startApifySync`, so the single-run lock, the daily budget, the
 * verified-mapping requirement and the Actor input are stated once. The
 * alternative — putting a machine credential into a page so the UI could call
 * the other route — would hand a browser something that can spend money.
 *
 * ============================================================================
 * THE DOUBLE-CLICK IS HANDLED IN POSTGRES, NOT IN THE BUTTON
 * ============================================================================
 *
 * `google_review_apify_claim_run` inserts into a table with a partial unique
 * index over the live run. Two clicks a moment apart race inside one
 * transaction each; one wins, the other is told a run is already going. A
 * disabled button is a courtesy on top of that, not the mechanism — two tabs,
 * a cron tick landing at the same moment, and a retried request all get past a
 * disabled button and none of them gets past the index.
 *
 * ============================================================================
 * AND THE TOKEN NEVER LEAVES THE SERVER
 * ============================================================================
 *
 * The response carries a run id, counts and a sentence. No Apify token, no
 * webhook secret, no callback URL — the browser is told what happened, not how
 * it was done.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    /*
     * `manage_integrations` — Administration only: admin, owner, developer.
     * The same gate the Integrations screen and the anchor setup already use,
     * and deliberately not `view_google_reviews`, which most of the org chart
     * holds. Reading the dashboard and spending Apify credits are different
     * privileges.
     */
    const context = await authorizeRequest(request, "manage_integrations");
    /* After authorization, so an unauthorized caller cannot spend an admin's budget. */
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ mode?: unknown }>(request);
    const mode = typeof body.mode === "string" ? body.mode.trim() : "incremental";

    if (mode !== "incremental" && mode !== "backfill") {
      throw new AiError(
        "bad_request",
        "A sync is either `incremental` or `backfill`.",
        400,
      );
    }

    const baseUrl = resolveCallbackBaseUrl();
    if (!baseUrl) {
      throw new AiError(
        "bad_request",
        "NEXT_PUBLIC_SITE_URL is not set for this deployment, so Apify would have nowhere to report the finished run. Nothing has been started.",
        503,
      );
    }

    const result = await startApifySync({
      kind: mode,
      /*
       * THE AUDIT LABEL IS THE PERSON, TAKEN FROM THE VERIFIED SESSION. It
       * lands in `google_review_apify_runs.requested_by`, so "who started this
       * run" has an answer — and there is no body field a caller could put
       * somebody else's name in, which is the only thing that makes it worth
       * reading.
       */
      requestedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
      baseUrl,
      webhookSecret: webhookSecretForOutboundUse(),
    });

    return NextResponse.json({ status: "ok", run: result });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/sync");
  }
}

/**
 * GET — what the status area shows, and what the button polls while a run is up.
 *
 * A READ, GATED THE SAME WAY. It reports configuration by variable NAME and
 * never by value: which variables are set, the Actor id, the limits in force,
 * and the run ledger. Nothing here can start a run.
 */
export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    return NextResponse.json({ status: "ok", source: await readApifySourceStatus() });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/sync");
  }
}

/**
 * PATCH — settle a run whose completion webhook has not arrived.
 *
 * ============================================================================
 * THE ESCAPE HATCH FOR A DEMO, AND IT CANNOT START ANYTHING
 * ============================================================================
 *
 * Webhook delivery is best-effort. A Preview deployment that rolled while a run
 * was in flight, or a delivery that was simply lost, leaves a run showing
 * `running` until the next scheduled tick reconciles it — which is fine for a
 * production schedule and unhelpful when somebody is standing in front of a
 * demo.
 *
 * So this asks Apify about the run and settles it, using exactly the same
 * `completeApifyRun` the webhook uses: same verification against Apify's API,
 * same server-side dataset read, same idempotence. It starts no run and spends
 * no credit, which is why it is safe to expose as a button.
 */
export async function PATCH(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ runId?: unknown }>(request);
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      throw new AiError("bad_request", "That is not a run id.", 400);
    }

    return NextResponse.json({ status: "ok", result: await completeApifyRun(runId) });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/sync");
  }
}
