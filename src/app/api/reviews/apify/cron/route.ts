import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { verifyIngestSecret, parseIngestCredentials } from "@/lib/reporting/ingest-credential";
import { APIFY_SCHEDULE_ENABLED_ENV, readApifyConfig } from "@/lib/reviews/apify/config";
import {
  SYNC_LOCAL_HOUR,
  SYNC_TIME_ZONE,
  scheduleWindow,
} from "@/lib/reviews/apify/schedule";
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
 * ONCE A DAY, AT SIX IN THE MORNING WHERE THE SALONS ARE
 * ============================================================================
 *
 * The cron entry fires TWICE in UTC — 11:00 and 12:00 — and that is not two
 * syncs. Vercel Cron has no time zone field: a `schedule` in `vercel.json` is a
 * bare cron expression evaluated in UTC, so a single fixed hour is 06:00
 * America/Chicago for one half of the year and 05:00 or 07:00 for the other.
 * Exactly one of those two ticks is 06:00 Central on any given day, and
 * `scheduleWindow` is what tells them apart. The other one starts nothing.
 *
 * So: ONE Apify run a day, at 06:00 US Central, through both clock changes.
 * `src/lib/reviews/apify/schedule.ts` owns that arithmetic and asserts it over
 * seven years of calendar rather than by argument.
 *
 * ============================================================================
 * THREE THINGS PER TICK, AND ONLY ONE OF THEM SPENDS MONEY
 * ============================================================================
 *
 *   RECONCILE FIRST. A run whose completion webhook never arrived is asked
 *   about, once, and settled. This is a read of Apify's API — it starts
 *   nothing and costs no credit — and doing it first means a stuck lock is
 *   cleared before the new run tries to take it, rather than a tick later.
 *
 *   THEN CHECK THE CLOCK. A tick landing outside the 06:00 hour in
 *   America/Chicago is the DST partner of the one that is due. It answers 200
 *   `outside_window` and starts nothing — having already reconciled, which is
 *   the only work it was ever there to do.
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
 *
 * ============================================================================
 * AND THE SCHEDULE IS SWITCHED ON SEPARATELY FROM THE INTEGRATION
 * ============================================================================
 *
 * `APIFY_SCHEDULE_ENABLED` must ALSO be true before this route starts anything.
 * That is what lets QA turn the integration on, press Discover and Sync by
 * hand, and still have this tick start nothing at 06:00 the next morning.
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

  /*
   * RECONCILIATION RUNS EVEN WHEN THE SCHEDULE DOES NOT.
   *
   * It settles a run whose completion webhook was lost — including a MANUAL one
   * started from the admin screen during QA — and it is a read of Apify's API
   * that starts nothing and spends no credit. Gating it behind the schedule
   * switch would mean a manual run whose webhook went missing stayed `running`
   * until somebody noticed, which is the opposite of what the switch is for.
   */
  const reconciled = await reconcileStaleRuns();

  /*
   * ============================================================================
   * THE SCHEDULE HAS ITS OWN SWITCH, AND IT IS OFF UNLESS SET
   * ============================================================================
   *
   * `APIFY_SYNC_ENABLED` is the master switch: with it off, nothing anywhere
   * reaches Apify. But QA needs a state that one switch cannot express — manual
   * discovery and manual sync working while this daily tick starts
   * nothing — because otherwise turning the integration on to test it for an
   * afternoon also arms an unattended run at 06:00 the next morning, and the
   * first anybody knows of it is the usage figure.
   *
   * So the schedule is gated separately and checked HERE, before
   * `startApifySync`, which is the only thing on this route that can spend
   * money. The admin routes do not consult it: pressing a button is somebody
   * deciding, and that is exactly the difference being drawn.
   *
   * 200, not an error. A cron tick that correctly declined to start a run is a
   * successful tick; a non-2xx would show in Vercel as a broken cron and send
   * somebody hunting a fault that is not there.
   */
  const config = readApifyConfig();
  if (!config.scheduleEnabled) {
    return NextResponse.json({
      status: "schedule_disabled",
      reason: `${APIFY_SCHEDULE_ENABLED_ENV} is not true, so the scheduled sync starts nothing. Manual discovery and manual sync are unaffected.`,
      reconciled,
    });
  }

  /*
   * ============================================================================
   * AND ONLY ONE OF THE DAY'S TWO UTC TICKS IS SIX O'CLOCK CENTRAL
   * ============================================================================
   *
   * `vercel.json` fires this route at 11:00 and 12:00 UTC. That is one schedule
   * expressed twice, not two schedules: Vercel Cron is UTC-only and has no time
   * zone field, so 06:00 America/Chicago is 11:00 UTC under CDT and 12:00 UTC
   * under CST. Whichever tick lands in the 06:00 hour locally is the day's run;
   * its partner has already reconciled above and stops here.
   *
   * CHECKED BEFORE THE CALLBACK URL AND BEFORE `startApifySync`, because it is
   * the cheapest of the three and it is the one that is false half the time.
   *
   * 200, like the other guardrails. A tick that correctly declined is a
   * successful tick; a non-2xx would show in Vercel as a broken cron every
   * single day and teach whoever watches it to ignore the alert.
   */
  const dailyWindow = scheduleWindow();

  if (dailyWindow.status === "timezone_unavailable") {
    /*
     * FAIL CLOSED, AND LOUDLY. A runtime that cannot resolve America/Chicago
     * cannot tell 06:00 from 07:00, and a schedule nobody can predict is worse
     * than a sync that is late. 503 rather than 200 because, unlike the guard
     * rails, this one IS a fault and should show as one.
     */
    return NextResponse.json(
      {
        status: "not_configured",
        code: "timezone_unavailable",
        reason: `This runtime cannot resolve ${SYNC_TIME_ZONE}, so the tick cannot tell whether it is the ${SYNC_LOCAL_HOUR}:00 one. No run was started.`,
        reconciled,
      },
      { status: 503 },
    );
  }

  if (dailyWindow.status === "outside_window") {
    return NextResponse.json({
      status: "outside_window",
      reason: `The daily sync runs at ${SYNC_LOCAL_HOUR}:00 ${SYNC_TIME_ZONE}. This tick landed at ${dailyWindow.localTime}, so it reconciled and started nothing.`,
      localTime: dailyWindow.localTime,
      reconciled,
    });
  }

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
