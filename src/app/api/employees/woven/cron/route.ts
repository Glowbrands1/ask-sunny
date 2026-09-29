import { NextResponse } from "next/server";

import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/api/cron-auth";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import {
  readWovenConfig,
  WOVEN_SYNC_ENABLED_ENV,
  WOVEN_SYNC_SCHEDULE_ENABLED_ENV,
} from "@/lib/employees/woven/config";
import { CRON_REQUESTER, outcomeHttpStatus, runWovenEmployeeSync } from "@/lib/employees/woven/sync";

/**
 * GET /api/employees/woven/cron — the scheduled Woven employee sync.
 *
 * ============================================================================
 * SCHEDULED DAILY — 11:17 UTC (`vercel.json`)
 * ============================================================================
 *
 * Enabled after the first manual dry run and the first manual stored run were
 * read and found right (docs/woven-employee-sync.md §8). Once a day suits an
 * employee directory: hires, terminations and moves are daily facts, and a
 * missed day is caught up in full by the next read. The minute is off the hour
 * and away from the other cron entry.
 *
 * It is the SAME sync as the admin screen's: `runWovenEmployeeSync`, with the
 * same read-completeness check, run lock, WOVEN_SYNC_WRITES_ENABLED switch and
 * one-transaction save. A failed or refused run records its code and leaves
 * the last good directory as it was; the next day's run tries again.
 *
 * ============================================================================
 * FIVE LOCKS, ANY ONE OF WHICH STOPS IT
 * ============================================================================
 *
 *   1. `CRON_SECRET` — Vercel's bearer credential for scheduled invocations.
 *      Absent: every call is refused, Vercel's included.
 *   2. `WOVEN_SYNC_ENABLED` — the master switch. Off: nothing reaches Woven.
 *   3. `WOVEN_SYNC_SCHEDULE_ENABLED` — the schedule's own switch. Off: manual
 *      runs from the admin route still work, and this tick starts nothing.
 *   4. `WOVEN_SYNC_WRITES_ENABLED` — enforced inside `runWovenEmployeeSync`.
 *      Off: the tick is refused (409 `writes_disabled`) before Woven or the
 *      store is touched.
 *   5. The run lock — at most one sync at a time, enforced by Postgres.
 *
 * WHAT A RUN DOES NOT DO, even when all five are open: change `app_users`, a
 * role, a scope, a salon assignment or a login; delete anybody; or write to
 * Woven. See `src/lib/employees/woven/sync.ts`.
 *
 * THE RESPONSE carries codes and counts only — never a name or an email.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
 * A full read is paced under Woven's ~100 requests/minute. The sync stops
 * starting requests at 230 s (`DEFAULT_READ_BUDGET_MS`) so the commit has room
 * inside this limit.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json(
      { status: "not_configured", code: "supabase_missing", reason: "Supabase is not configured in this runtime." },
      { status: 503 },
    );
  }

  const auth = await authorizeCronRequest(request);
  if (auth === "unconfigured") {
    return NextResponse.json(
      {
        status: "not_configured",
        code: "cron_secret_missing",
        reason: `${CRON_SECRET_ENV} is not set, so the scheduled Woven sync is closed.`,
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

  const config = readWovenConfig();
  if (!config.enabled) {
    return NextResponse.json({
      status: "disabled",
      reason: `${WOVEN_SYNC_ENABLED_ENV} is not on, so nothing reaches Woven.`,
    });
  }
  if (!config.scheduleEnabled) {
    return NextResponse.json({
      status: "schedule_disabled",
      reason: `${WOVEN_SYNC_SCHEDULE_ENABLED_ENV} is not on, so the scheduled sync starts nothing. Manual runs are unaffected.`,
    });
  }

  const outcome = await runWovenEmployeeSync({ requestedBy: CRON_REQUESTER, config });
  return NextResponse.json(outcome, { status: outcomeHttpStatus(outcome) });
}
