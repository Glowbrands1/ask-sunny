import { z } from "zod";

import { PARTNER_HEADERS, verifyPartnerRequest } from "@/features/l10/partner/signature";
import type { AuthenticatedIdentity } from "@/lib/auth/types";
import { validRange } from "./range";
import type { CalendarView } from "./types";

/**
 * POST /api/partner/calendar: the Leadership Hub reads ONE person's events from this app for its Calendar
 * (Glowbrands1/leadership-hub docs/calendar-design.md §3b).
 *
 * - Signed exactly like the L10 partner API (`features/l10/partner/signature.ts`, one test vector in both repos), with
 *   the same shared secret (HUB_PARTNER_SECRET), but the signer must be partner id "leadership-hub": the id is in the
 *   signed text, so this app's own signature can never pass here.
 * - One-time nonce (calendar_partner_nonces), a per-person rate limit, a 62-day range.
 * - The person is this app's ACTIVE account with that email (case-insensitive), read with that account's own role and
 *   salons, exactly as the /calendar page reads it for them. Unknown email, unsigned, stale or replayed: 404, the
 *   Hub's "nothing for you here". This app's data only (never Ask Bubbles'), never time off, never L10 data (the Hub
 *   has that).
 * Kept free of server-only imports so it is tested with fakes; the route passes the real reads.
 */
export const HUB_CALLER_ID = "leadership-hub";
export const MAX_BODY = 2_000;
const BODY = z.object({
  email: z.string().trim().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  from: z.string(),
  to: z.string(),
});

export interface PartnerCalendarDeps {
  secret: string | undefined;
  /** This app's https origin (NEXT_PUBLIC_SITE_URL): event links must open here, not in the Hub. */
  origin: string | undefined;
  now: number;
  claimNonce: (nonce: string) => Promise<boolean>;
  rateLimited: (email: string) => boolean;
  identityByEmail: (email: string) => Promise<AuthenticatedIdentity | null>;
  load: (identity: AuthenticatedIdentity, range: { from: string; to: string }, origin: string) => Promise<{ ok: true; view: CalendarView } | { ok: false }>;
}

export type PartnerAnswer = { status: number; body: Record<string, unknown> };
const notFound: PartnerAnswer = { status: 404, body: { error: "not_found" } };

export async function handlePartnerCalendar(headers: Headers, body: string, deps: PartnerCalendarDeps): Promise<PartnerAnswer> {
  const secret = deps.secret?.trim();
  const origin = deps.origin?.trim().replace(/\/+$/, "");
  if (!secret || !origin || !/^https:\/\/[^/\s]+$/.test(origin)) return notFound;
  if (body.length > MAX_BODY) return { status: 413, body: { error: "too_large" } };
  const ok = verifyPartnerRequest({
    secret,
    partnerId: headers.get(PARTNER_HEADERS.partner) === HUB_CALLER_ID ? HUB_CALLER_ID : null,
    timestamp: headers.get(PARTNER_HEADERS.timestamp),
    signature: headers.get(PARTNER_HEADERS.signature),
    body,
    now: deps.now,
  });
  if (!ok) return notFound;
  let parsed: z.infer<typeof BODY>;
  try {
    const r = BODY.safeParse(JSON.parse(body));
    if (!r.success) return { status: 400, body: { error: "invalid" } };
    parsed = r.data;
  } catch {
    return { status: 400, body: { error: "invalid" } };
  }
  if (!validRange(parsed.from, parsed.to)) return { status: 400, body: { error: "invalid" } };
  if (deps.rateLimited(parsed.email.toLowerCase())) return { status: 429, body: { error: "rate_limited" } };
  if (!(await deps.claimNonce(parsed.nonce))) return notFound;
  const identity = await deps.identityByEmail(parsed.email);
  if (!identity) return notFound;
  const result = await deps.load(identity, { from: parsed.from, to: parsed.to }, origin);
  if (!result.ok) return notFound;
  // This app's events only: the Hub already has its own meetings and reminders.
  const events = result.view.events.filter((e) => e.source === "ask-sunny");
  return { status: 200, body: { ok: true, events, ...(result.view.notes.length ? { partial: true } : {}) } };
}
