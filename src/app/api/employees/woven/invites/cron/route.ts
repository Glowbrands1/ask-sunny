import { NextResponse } from "next/server";

import { authorizeCronRequest, CRON_SECRET_ENV } from "@/lib/api/cron-auth";
import { implicitRedirectTarget } from "@/lib/admin/redirect-target";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { runNewHireInvites } from "@/lib/employees/woven/access/apply-run";
import { NEW_HIRE_INVITES_ENABLED_ENV, readNewHireConfig } from "@/lib/employees/woven/access/new-hire";
import { CRON_REQUESTER } from "@/lib/employees/woven/sync";

/**
 * GET /api/employees/woven/invites/cron — the hourly new-hire invitation
 * (`access/new-hire-invites.ts`), at minute 23 (`vercel.json`).
 *
 * NEW_HIRE_INVITES_ENABLED off (the default): it answers `disabled` and reads
 * nothing. On, it sends at most NEW_HIRE_INVITES_PER_HOUR (1 or 2) invitations
 * to new hires the lifecycle already created accounts for — never a batch.
 * CRON_SECRET guards it like every scheduled route. The response carries
 * codes and counts only, never a name or an email.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeCronRequest(request);
  if (auth === "unconfigured") {
    return NextResponse.json(
      { status: "not_configured", code: "cron_secret_missing", reason: `${CRON_SECRET_ENV} is not set, so the scheduled new-hire invitation is closed.` },
      { status: 503 },
    );
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ status: "unauthorized", code: "invalid_token", reason: "Not authorized." }, { status: 401 });
  }

  const config = readNewHireConfig();
  if (!config.enabled) {
    return NextResponse.json({
      status: "disabled",
      reason: config.problem ?? `${NEW_HIRE_INVITES_ENABLED_ENV} is not on, so no new-hire invitation is sent.`,
    });
  }
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json(
      { status: "not_configured", code: "supabase_missing", reason: "Supabase is not configured in this runtime." },
      { status: 503 },
    );
  }

  const outcome = await runNewHireInvites(CRON_REQUESTER, implicitRedirectTarget(request));
  return NextResponse.json(outcome);
}
