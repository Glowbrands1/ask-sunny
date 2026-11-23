import { NextResponse } from "next/server";

import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/api/cron-auth";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { HR_APPROVAL_FLAG } from "@/lib/forms/hr-approval-rules";
import { runHrReminders } from "@/lib/forms/hr-approval-reminders";

/**
 * GET /api/forms/hr-approval/cron — HR's 6 AM Central reminder of the forms
 * waiting for their approval (`hr-approval-reminders.ts`), weekdays at 11:05
 * and 12:05 UTC (`vercel.json`): one of the two is 6 AM Central in either
 * season, and only that one sends.
 *
 * FORMS_HR_APPROVAL_ENABLED off: answers `disabled` and reads nothing.
 * CRON_SECRET guards it like every scheduled route. The response carries counts
 * only, never a name, an email or a form.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeCronRequest(request);
  if (auth === "unconfigured") {
    return NextResponse.json(
      { status: "not_configured", code: "cron_secret_missing", reason: `${CRON_SECRET_ENV} is not set, so the HR approval reminder is closed.` },
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

  const outcome = await runHrReminders();
  if (outcome.status === "disabled") {
    return NextResponse.json({ status: "disabled", reason: `${HR_APPROVAL_FLAG} is not on, so no reminder is sent.` });
  }
  return NextResponse.json(outcome);
}
