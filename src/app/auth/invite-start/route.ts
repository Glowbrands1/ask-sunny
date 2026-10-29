import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { inviteLinkHoldEnabled } from "@/lib/auth/invite-hold-flag";
import { EXPIRED_QUERY } from "@/lib/auth/recovery-link";
import { INVITE_CONTINUE_PATH, SET_PASSWORD_PATH } from "@/lib/auth/routes";
import {
  INVITE_TOKEN_COOKIE,
  heldInviteToken,
  holdInviteToken,
  readInviteStart,
  releaseInviteToken,
  verifyInviteTokenOntoResponse,
} from "@/lib/auth/invite-token";

/**
 * ============================================================================
 * /auth/invite-start — THE SCANNER-SAFE INVITATION LANDING
 * (INVITE_LINK_HOLD_ENABLED, default off)
 * ============================================================================
 *
 * `/auth/recovery-start`, for the Invite user email, once that template links
 * here (`docs/supabase-invite-template.html`):
 *
 *   /auth/invite-start?token_hash={{ .TokenHash }}&type=invite
 *
 * GET NEVER SPENDS THE TOKEN. It moves the token into a short-lived HttpOnly
 * cookie and 303-redirects to `/auth/invite-continue`, whose URL has no token.
 * No Supabase client is even constructed on GET — a mail scanner, a prefetch
 * or a link preview leaves the invitation exactly as it was.
 *
 * POST SPENDS IT. Only the Continue button submits here. `verifyOtp({
 * token_hash, type: "invite" })` runs, the session cookies are written onto
 * the redirect to `/reset-password`, and that page sets the password and then
 * accepts the invitation (`/api/auth/accept-invitation`), as it does today.
 *
 * OFF: neither method holds or verifies anything; both send the visitor to
 * sign in. No redirect parameter is read; a cross-site POST is refused by the
 * SameSite=Lax cookie and by the `Origin` check.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function redirectTo(path: string, origin: string): NextResponse {
  // 303 so a POST is always followed by a GET, never replayed as a POST.
  return noStore(NextResponse.redirect(new URL(path, origin), 303));
}

function notConfigured(origin: string): NextResponse {
  return redirectTo("/login?notice=Sign-in%20is%20not%20configured%20for%20this%20deployment.", origin);
}

/** GET: hold the token, scrub the URL. NOTHING ELSE. Also serves HEAD. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!inviteLinkHoldEnabled()) return redirectTo("/login", url.origin);
  if (!supabasePublicConfigured()) return notConfigured(url.origin);

  const response = redirectTo(INVITE_CONTINUE_PATH, url.origin);
  response.headers.set("Referrer-Policy", "no-referrer");

  const tokenHash = readInviteStart(url);
  if (tokenHash) holdInviteToken(response, tokenHash, url);

  return response;
}

/** POST: the person pressed Continue. Spend the token. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!inviteLinkHoldEnabled()) return redirectTo("/login", url.origin);
  if (!supabasePublicConfigured()) return notConfigured(url.origin);

  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== url.origin) {
    return redirectTo(INVITE_CONTINUE_PATH, url.origin);
  }

  const store = await cookies();
  const tokenHash = heldInviteToken(store.get(INVITE_TOKEN_COOKIE)?.value);
  if (!tokenHash) return redirectTo(INVITE_CONTINUE_PATH, url.origin);

  const success = redirectTo(SET_PASSWORD_PATH, url.origin);
  const outcome = await verifyInviteTokenOntoResponse(tokenHash, success);

  if (outcome === "verified") {
    releaseInviteToken(success, url);
    return success;
  }

  if (outcome === "unavailable") {
    // Token untouched and still held: the person can press Continue again.
    return redirectTo(`${INVITE_CONTINUE_PATH}?retry=1`, url.origin);
  }

  // Supabase answered and refused: spent or expired.
  const refused = redirectTo(`${SET_PASSWORD_PATH}${EXPIRED_QUERY}`, url.origin);
  releaseInviteToken(refused, url);
  return refused;
}
