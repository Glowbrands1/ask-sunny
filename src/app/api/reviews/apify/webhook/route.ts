import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { completeApifyRun } from "@/lib/reviews/apify/sync";
import { authorizeApifyWebhook } from "@/lib/reviews/apify/webhook-credential";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";

/**
 * POST /api/reviews/apify/webhook — Apify says a run it was given has finished.
 *
 * ============================================================================
 * THE REQUEST IS A DOORBELL, NOT A DELIVERY
 * ============================================================================
 *
 * Everything this route acts on, it fetches itself:
 *
 *   THE BODY CARRIES  a run id this system generated, and Apify's own run id.
 *   THE BODY DOES NOT CARRY  a single review, a place id, a store code, a
 *                            rating, a reviewer name, or a dataset's contents.
 *
 * `completeApifyRun` looks the run up in this system's own ledger, asks Apify's
 * API whether it really finished and which dataset holds the records, and reads
 * that dataset with this system's own token. So the strongest thing a caller
 * who holds the shared secret can do is ask ASK Sunny to re-read a dataset it
 * started and already owns — and because deduplication is by Google's review
 * id, doing that twice creates nothing.
 *
 * That is the answer to "do not trust location identity from arbitrary webhook
 * input": there is no location identity in the input to trust.
 *
 * ============================================================================
 * THREE CHECKS, IN THIS ORDER
 * ============================================================================
 *
 *   1. `APIFY_WEBHOOK_SECRET`, constant-time, rate limited on failures. The
 *      same machinery every other machine credential here uses.
 *   2. The run id must name a run this system started and is STILL WAITING ON.
 *      A replayed delivery for a settled run is a no-op, which is what makes
 *      Apify's at-least-once delivery safe.
 *   3. Apify's own API must agree the run succeeded. A webhook claiming success
 *      for a run Apify says failed imports nothing.
 *
 * ============================================================================
 * AND IT ANSWERS 200 FOR THINGS IT DID NOT DO
 * ============================================================================
 *
 * A duplicate delivery, a run that no longer exists, a run that Apify says is
 * still going: all 200 with a status saying what was ignored. Apify retries a
 * non-2xx, and retrying any of those would achieve nothing except more
 * deliveries. A genuine fault — the dataset unreadable, the database
 * unavailable — is still an error status, because that one IS worth retrying.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
 * A backfill's dataset can be fifteen listings deep, and the work is a dataset
 * read plus one upsert per listing. Sixty seconds is comfortably more than that
 * takes and within every current Vercel plan's ceiling. If a much larger
 * backfill limit is ever configured, this is the number to raise.
 */
export const maxDuration = 60;

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
      return NextResponse.json(
        {
          status: "not_configured",
          code: "supabase_missing",
          reason: "Supabase is not configured in this runtime, so no review can be stored.",
        },
        { status: 503 },
      );
    }

    const auth = await authorizeApifyWebhook(request.headers);

    if (auth.status === "unconfigured") {
      return NextResponse.json(
        { status: "not_configured", code: "webhook_secret_missing", reason: auth.problem },
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
      /*
       * ONE ANSWER FOR EVERY FAILURE, and deliberately not "which half was
       * wrong". The same rule the extension's ingestion route states.
       */
      return NextResponse.json(
        {
          status: "unauthorized",
          code: "invalid_token",
          reason: "This webhook credential is not accepted.",
        },
        { status: 401 },
      );
    }

    const body = await parseJsonBody<{ askSunnyRunId?: unknown }>(request);
    const runId = typeof body.askSunnyRunId === "string" ? body.askSunnyRunId.trim() : "";

    if (!RUN_ID.test(runId)) {
      /*
       * 200, NOT 400. A malformed id is nothing this system can act on and
       * nothing Apify can fix by sending it again; a 4xx would only buy a
       * retry storm. It is logged as a code and answered as ignored.
       */
      console.warn("[reviews/apify/webhook] delivery carried no usable run id");
      return NextResponse.json({ status: "ignored", reason: "no_run_id" });
    }

    const result = await completeApifyRun(runId);

    return NextResponse.json({
      status: result.status,
      /*
       * COUNTS ONLY. No reviewer name, no review text, no place id — a webhook
       * response is written into a third party's run log.
       */
      reviewsFetched: result.reviewsFetched,
      created: result.created,
      updated: result.updated,
      duplicates: result.duplicates,
      countedIntoPeriod: result.countedIntoPeriod,
      storedAsHistorical: result.storedAsHistorical,
      locationsReturned: result.locationsReturned,
      missingStoreCodes: result.missingStoreCodes,
    });
  } catch (error) {
    return errorResponse(error, "reviews/apify/webhook");
  }
}
