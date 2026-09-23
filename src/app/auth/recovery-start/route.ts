import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { EXPIRED_QUERY } from "@/lib/auth/recovery-link";
import { RECOVERY_CONTINUE_PATH, SET_PASSWORD_PATH } from "@/lib/auth/routes";
import {
  RECOVERY_TOKEN_COOKIE,
  heldRecoveryToken,
  holdRecoveryToken,
  readRecoveryStart,
  releaseRecoveryToken,
  verifyRecoveryTokenOntoResponse,
} from "@/lib/auth/recovery-token";

/**
 * ============================================================================
 * /auth/recovery-start — THE SCANNER-SAFE PASSWORD RECOVERY LANDING.
 * ============================================================================
 *
 * The Reset Password email links here:
 *
 *   /auth/recovery-start?token_hash={{ .TokenHash }}&type=recovery
 *
 * GET NEVER SPENDS THE TOKEN. This is the entire point of the route. A mail
 * security scanner (Defender Safe Links and similar) fetches the link before
 * the person sees it; with Supabase's stock link that fetch WAS the
 * verification, and the person's own click then reported a brand-new link as
 * expired. Here a GET — from a scanner, a prefetch, a link preview, or the
 * person — only:
 *
 *   1. moves the token into a short-lived HttpOnly cookie, and
 *   2. 303-redirects to `/auth/recovery-continue`, whose URL has no token,
 *
 * so the credential is out of the address bar and history after one hop. No
 * Supabase client is even constructed on GET.
 *
 * POST SPENDS IT. Only the Continue button on `/auth/recovery-continue`
 * submits here. `verifyOtp({ token_hash, type: "recovery" })` runs, the
 * session cookies are written onto the redirect to `/reset-password`, and that
 * page carries on exactly as before: it finds the session with `getUser()` and
 * sets the password with `updateUser({ password })`.
 *
 * "Expired" is shown ONLY when Supabase actually refuses the token on that
 * POST. A missing cookie goes back to the Continue page, which explains there
 * is no link to open; an unreachable Supabase goes back there with the token
 * still held, so the person can retry.
 *
 * ============================================================================
 * WHAT IT WILL NOT DO
 * ============================================================================
 *
 * No redirect parameter is read. Every destination is compiled in, so an
 * emailed link cannot point anywhere else.
 *
 * A cross-site POST is refused twice over: the SameSite=Lax cookie is not sent
 * with one, and an `Origin` naming another site is rejected before anything is
 * read.
 *
 * The token is never logged, reflected, or returned.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nothing here may be cached by the browser or an intermediary. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function redirectTo(path: string, origin: string): NextResponse {
  // 303 so a POST is always followed by a GET, never replayed as a POST.
  return noStore(NextResponse.redirect(new URL(path, origin), 303));
}

function notConfigured(origin: string): NextResponse {
  return redirectTo(
    "/login?notice=Sign-in%20is%20not%20configured%20for%20this%20deployment.",
    origin,
  );
}

/**
 * GET: hold the token, scrub the URL. NOTHING ELSE.
 *
 * Also serves HEAD, which Next derives from this handler.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (!supabasePublicConfigured()) return notConfigured(url.origin);

  const response = redirectTo(RECOVERY_CONTINUE_PATH, url.origin);
  /*
   * The token-bearing URL must not leak as a referrer from the hop, even though
   * the next page has nothing to load from elsewhere.
   */
  response.headers.set("Referrer-Policy", "no-referrer");

  const tokenHash = readRecoveryStart(url);
  if (tokenHash) holdRecoveryToken(response, tokenHash, url);

  return response;
}

/** POST: the person pressed Continue. Spend the token. */
export async function POST(request: Request) {
  const url = new URL(request.url);

  if (!supabasePublicConfigured()) return notConfigured(url.origin);

  /*
   * A form POST from our own page carries our origin. `null` is tolerated
   * because some privacy settings send it for same-origin posts; the
   * SameSite=Lax cookie is what actually stops a cross-site submission.
   */
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== url.origin) {
    return redirectTo(RECOVERY_CONTINUE_PATH, url.origin);
  }

  const store = await cookies();
  const tokenHash = heldRecoveryToken(store.get(RECOVERY_TOKEN_COOKIE)?.value);

  if (!tokenHash) {
    // Nothing to spend. The Continue page explains; it does NOT say "expired".
    return redirectTo(RECOVERY_CONTINUE_PATH, url.origin);
  }

  // Built before verification so the session cookies can be written onto it.
  const success = redirectTo(SET_PASSWORD_PATH, url.origin);
  const outcome = await verifyRecoveryTokenOntoResponse(tokenHash, success);

  if (outcome === "verified") {
    releaseRecoveryToken(success, url);
    return success;
  }

  if (outcome === "unavailable") {
    // Token untouched and still held: the person can press Continue again.
    return redirectTo(`${RECOVERY_CONTINUE_PATH}?retry=1`, url.origin);
  }

  // Supabase answered and refused. The one case that is really "expired".
  const refused = redirectTo(`${SET_PASSWORD_PATH}${EXPIRED_QUERY}`, url.origin);
  releaseRecoveryToken(refused, url);
  return refused;
}
