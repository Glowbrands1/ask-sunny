import { NextResponse } from "next/server";

import { APP_USER_COLUMNS, toAppUserProfile } from "@/lib/auth/app-user";
import type { AuthenticatedIdentity } from "@/lib/auth/types";
import { getRateLimiter } from "@/lib/api/rate-limit";
import { loadCalendarFor } from "@/lib/calendar/load.server";
import { MAX_BODY, handlePartnerCalendar } from "@/lib/calendar/partner";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/partner/calendar — the Leadership Hub's Calendar reads one person's follow-ups, HR approvals, Google
 * Reviews checks and reminders from this app (`lib/calendar/partner.ts` says how it is signed and scoped). Not behind
 * the middleware (it skips /api); fails closed with 404 without HUB_PARTNER_SECRET or NEXT_PUBLIC_SITE_URL.
 */
export const dynamic = "force-dynamic";

const RULE = { limit: 120, windowSeconds: 60 };

async function identityByEmail(email: string): Promise<AuthenticatedIdentity | null> {
  const exact = email.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await getSupabaseAdmin().from("app_users").select(APP_USER_COLUMNS).ilike("email", exact).limit(2);
  if (error || !data || data.length !== 1) return null;
  const lookup = toAppUserProfile(data[0]);
  if (!lookup.ok) return null;
  const p = lookup.profile;
  return { subject: p.id, email: p.email, displayName: p.displayName, role: p.role, scope: p.scope, verified: true } as AuthenticatedIdentity;
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const answer = await handlePartnerCalendar(request.headers, body, {
    secret: process.env.HUB_PARTNER_SECRET,
    origin: process.env.NEXT_PUBLIC_SITE_URL,
    now: Date.now(),
    claimNonce: async (nonce) => {
      const supabase = getSupabaseAdmin();
      await supabase.from("calendar_partner_nonces").delete().lt("seen_at", new Date(Date.now() - 10 * 60_000).toISOString());
      const { error } = await supabase.from("calendar_partner_nonces").insert({ nonce });
      return !error;
    },
    rateLimited: (email) => !getRateLimiter().check(`partner-calendar:${email}`, RULE).allowed,
    identityByEmail,
    load: (identity, range, origin) => loadCalendarFor(identity, range, { origin, includeHub: false }),
  });
  return NextResponse.json(answer.body, { status: answer.status, headers: { "cache-control": "no-store" } });
}
