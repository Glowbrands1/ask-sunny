import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/api/cron-auth";
import { errorResponse } from "@/lib/api/respond";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { readSyncMode } from "@/lib/reviews/gbp/config";
import { buildGbpRuntime } from "@/lib/reviews/gbp/runtime";
import { runGbpSync } from "@/lib/reviews/gbp/sync";

/**
 * GET /api/reviews/gbp/cron — the scheduled reconciliation fallback.
 *
 * Pub/Sub is the fast path for new and edited reviews; this is the safety net
 * for the notification that never arrived. It reads the newest pages for every
 * CONFIRMED listing and reconciles, so a missed message costs one day, not a
 * review.
 *
 * INERT UNTIL SWITCHED ON. With `GBP_SYNC_MODE` unset or `off` it answers 200
 * `disabled` without touching Google or the database. With `dry_run` it reads
 * and reports and writes nothing; only `live` files reviews. It never runs a
 * backfill — that is an admin action — and it has no Apify dependency.
 *
 * AUTH: `CRON_SECRET`, the same constant-time bearer check the other cron route
 * uses. A deployment without it refuses everyone, Vercel included.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request) {
  const authorization = await authorizeCronRequest(request);
  if (authorization === "unconfigured") {
    return NextResponse.json({ status: "not_configured", code: "cron_secret_missing" }, { status: 503 });
  }
  if (authorization !== "ok") {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  if (readSyncMode() === "off") {
    return NextResponse.json({ status: "disabled", reason: "GBP_SYNC_MODE is off." });
  }
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json({ status: "not_configured", code: "supabase_missing" }, { status: 503 });
  }

  try {
    const report = await runGbpSync(
      { requestedMode: "live", scope: "incremental", trigger: "cron" },
      buildGbpRuntime(),
    );
    /* Counts only: no review text and no names leave through a cron response. */
    return NextResponse.json({
      status: report.status,
      mode: report.mode,
      requests: report.requests,
      totals: report.totals,
      failed: report.locations.filter((l) => l.status !== "ok").map((l) => ({ storeCode: l.storeCode, code: l.errorCode })),
    });
  } catch (error) {
    return errorResponse(error, "reviews/gbp/cron");
  }
}

export const GET = handle;
export const POST = handle;
