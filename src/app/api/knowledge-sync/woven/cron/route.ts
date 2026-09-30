import { NextResponse } from "next/server";

import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/api/cron-auth";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { outcomeHttpStatus } from "@/lib/knowledge-sync/engine";
import { runScheduledWovenKnowledgeTick } from "@/lib/knowledge-sync/woven/sync";

/**
 * GET /api/knowledge-sync/woven/cron — the hourly tick behind "every 30 days".
 *
 * ============================================================================
 * SCHEDULED DAILY, INERT UNTIL AN ADMINISTRATOR TURNS IT ON
 * ============================================================================
 *
 * `vercel.json` runs this at :40 every hour. It does nothing — and does
 * not sign in to Woven — until the initial sync has been run from the admin
 * screen AND an administrator has pressed "Enable Automatic Sync" (which the
 * API refuses before the initial sync).
 *
 * WHY HOURLY, FOR A MONTHLY SYNC. Vercel cron has no "every 30 days", and a
 * large sync finishes in several time-boxed runs. The tick runs hourly and
 * decides (`decideScheduledWork`): a full sync in the 09:40 UTC run once 30
 * days have passed since the last COMPLETE scan; otherwise finish deferred
 * work or retry failed items; otherwise nothing — without even signing in to
 * Woven. A monthly sync that fails is simply tried again the next day.
 *
 * LOCKS, ANY ONE OF WHICH STOPS IT: `CRON_SECRET`; `WOVEN_KNOWLEDGE_SYNC_ENABLED`;
 * the administrator's "Automatic sync" setting; the initial sync having been
 * completed from the admin screen; and the run lock.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json({ status: "not_configured", code: "supabase_missing" }, { status: 503 });
  }
  const auth = await authorizeCronRequest(request);
  if (auth === "unconfigured") {
    return NextResponse.json(
      { status: "not_configured", code: "cron_secret_missing", reason: `${CRON_SECRET_ENV} is not set, so the scheduled Woven knowledge sync is closed.` },
      { status: 503 },
    );
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ status: "unauthorized", code: "invalid_token", reason: "Not authorized." }, { status: 401 });
  }

  const outcome = await runScheduledWovenKnowledgeTick();
  const status =
    outcome.status === "skipped" || outcome.status === "disabled" ? 200 : outcome.status === "not_configured" ? 503 : outcomeHttpStatus(outcome);
  return NextResponse.json(outcome, { status });
}
