import { NextResponse } from "next/server";

import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/api/cron-auth";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { runFollowUpNotices } from "@/lib/forms/follow-up-notices";

/**
 * GET /api/forms/follow-up/cron — the daily follow-up notices (`follow-up-notices.ts`): the person who created a form
 * gets a bell on the day its follow-up is due and once it is overdue (Pau, 26 Nov 2026). Runs once a day
 * (`vercel.json`); a second run sends nothing new (`form_follow_up_notice_sends`).
 *
 * CRON_SECRET guards it like every scheduled route. The response carries counts only, never a name, an email or a form.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeCronRequest(request);
  if (auth === "unconfigured") {
    return NextResponse.json(
      { status: "not_configured", code: "cron_secret_missing", reason: `${CRON_SECRET_ENV} is not set, so the follow-up notices are closed.` },
      { status: 503 },
    );
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ status: "unauthorized", code: "invalid_token", reason: "Not authorized." }, { status: 401 });
  }
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json(
      { status: "not_configured", code: "supabase_missing", reason: "Supabase is not configured in this runtime." },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: "sent", ...(await runFollowUpNotices()) });
}
