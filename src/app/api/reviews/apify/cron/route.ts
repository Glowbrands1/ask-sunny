import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { verifyIngestSecret, parseIngestCredentials } from "@/lib/reporting/ingest-credential";
import { CRON_REQUESTER, reconcileStaleRuns, startApifySync } from "@/lib/reviews/apify/sync";
import {
  resolveCallbackBaseUrl,
  webhookSecretForOutboundUse,
} from "@/lib/reviews/apify/webhook-credential";

/**
 * GET /api/reviews/apify/cron — the scheduled server-side sync.
 *
 * ============================================================================
 * THIS IS THE PART THAT MAKES THE LAPTOP IRRELEVANT
 * ============================================================================
 *
 * A Vercel Cron entry calls this on a schedule. It takes the single run lock,
 * builds the Actor input from the verified location mapping, starts one Apify
 * run and returns. Nothing about it needs a browser to be open, a Google
 * session to be live, or anybody to be at a desk.
 *
 * ============================================================================
 * WHY THE SCHEDULE LIVES HERE AND NOT IN APIFY
 * ============================================================================
 *
 * Apify can hold a schedule of its own, and that design was rejected: the
 * Actor's input would then live on Apify, so the fifteen-location mapping would
 * exist in two places and the copy a scheduled run actually used would be the
 * one nobody could see from ASK Sunny. Correcting a salon here would not
 * correct what was scraped. Owning the input is worth owning the schedule.
 *
 * ============================================================================
 * TWO THINGS PER TICK, AND ONLY ONE OF THEM SPENDS MONEY
 * ============================================================================
 *
 *   RECONCILE FIRST. A run whose completion webhook never arrived is asked
 *   about, once, and settled. This is a read of Apify's API — it starts
 *   nothing and costs no credit — and doing it first means a stuck lock is
 *   cleared before the new run tries to take it, rather than a tick later.
 *
 *   THEN START ONE RUN. Which is refused by the database if another is live or
 *   if the day's run budget is spent. A tick that starts nothing is a normal,
 *   successful tick and answers 200 saying which.
 *
 * NO LOOP, NO SLEEP, NO POLLING. The tick returns as soon as Apify accepts the
 * run; completion arrives as a webhook on that run.
 *
 * ============================================================================
 * THE CREDENTIAL
 * ============================================================================
 *
 * `CRON_SECRET`, which is Vercel's own convention: Vercel sends it as
 * `Authorization: Bearer …` on scheduled invocations. It is verified with the
 * same constant-time comparison every other machine credential here uses.
 *
 * NOT OPTIONAL. An unauthenticated cron route is a public button that spends
 * money, so a deployment without the variable refuses every call — including
 * Vercel's — rather than running open.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const CRON_SECRET_ENV = "CRON_SECRET";

async function authorizeCron(request: Request): Promise<"ok" | "unauthorized" | "unconfigured"> {
  const credentials = parseIngestCredentials(process.env[CRON_SECRET_ENV], "cron");
  if (credentials.length === 0) return "unconfigured";

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const presented = bearer ? bearer[1].trim() : null;

  const { authorized } = await verifyIngestSecret(presented, credentials);
  return authorized ? "ok" : "unauthorized";
}

async function handle(request: Request) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json(
      {
        status: "not_configured",
        code: "supabase_missing",
        reason: "Supabase is not configured in this runtime.",
      },
      { status: 503 },
    );
  }

  const auth = await authorizeCron(request);

  if (auth === "unconfigured") {
    return NextResponse.json(
      {
        status: "not_configured",
        code: "cron_secret_missing",
        reason: `${CRON_SECRET_ENV} is not set, so the scheduled Google review sync is closed. Set it and redeploy.`,
      },
      { status: 503 },
    );
  }

  if (auth === "unauthorized") {
    return NextResponse.json(
      { status: "unauthorized", code: "invalid_token", reason: "Not authorized." },
      { status: 401 },
    );
  }

  /* Costs nothing and clears a stuck lock before the start below needs it. */
  const reconciled = await reconcileStaleRuns();

  const baseUrl = resolveCallbackBaseUrl();
  if (!baseUrl) {
    /*
     * WITHOUT A CALLBACK URL, A RUN WOULD FINISH AND NOBODY WOULD BE TOLD.
     * Reconciliation would eventually pick it up, twenty minutes later, on the
     * next tick — so this refuses rather than starting a run that will be slow
     * to land and hard to explain.
     */
    return NextResponse.json(
      {
        status: "not_configured",
        code: "callback_url_missing",
        reason:
          "NEXT_PUBLIC_SITE_URL is not set and VERCEL_URL is unavailable, so Apify has nowhere to report a finished run.",
        reconciled,
      },
      { status: 503 },
    );
  }

  const result = await startApifySync({
    kind: "incremental",
    requestedBy: CRON_REQUESTER,
    baseUrl,
    webhookSecret: webhookSecretForOutboundUse(),
  });

  /*
   * 200 EVEN WHEN NOTHING STARTED. "A run was already going" and "the day's
   * budget is spent" are the guardrails doing their job, not failures — and a
   * non-2xx here would show up in Vercel as a broken cron and send somebody
   * looking for a fault that is not there.
   */
  return NextResponse.json({ ...result, reconciled });
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    return errorResponse(error, "reviews/apify/cron");
  }
}

/** Vercel Cron issues a GET; POST is here so the same trigger can be scripted. */
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    return errorResponse(error, "reviews/apify/cron");
  }
}
