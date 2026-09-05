import { NextResponse } from "next/server";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { exchangeCodeOntoResponse } from "@/lib/auth/code-exchange";
import { SET_PASSWORD_PATH } from "@/lib/auth/routes";

/**
 * ============================================================================
 * /auth/recovery — where a password reset link lands.
 * ============================================================================
 *
 * A dedicated path with NO QUERY STRING of its own, and that is the entire
 * point of it existing.
 *
 * Recovery previously pointed at `/auth/callback?next=/reset-password`. The
 * browser really did request that — `resetPasswordForEmail` transmits
 * `redirectTo` verbatim, since `appendPkceFlowIdToRedirects` is off by default
 * — but the link that arrived pointed at the Site URL ROOT carrying `?code=`,
 * which is what Supabase does when it declines a redirect target. Adding the
 * exact query-string URL to the allowlist did not change it.
 *
 * So recovery stopped asking for a URL with a query string. A path with none
 * cannot be affected by query handling, by glob matching across `?`, or by a
 * parameter appended later.
 *
 * ============================================================================
 * WHERE IT SENDS PEOPLE, AND WHAT IT WILL NOT BE TOLD
 * ============================================================================
 *
 * One fixed same-site destination, compiled in. There is no `next` parameter
 * and no other input read from the URL except `code`, so there is nothing for
 * an emailed link to point somewhere else — an open redirect delivered by
 * email arrives from a real sender on behalf of a real reset, which is worse
 * than one delivered by a link.
 *
 * The code is a single-use credential. It is handed to Supabase and dropped:
 * never logged, never reflected into a message, never returned.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One sentence for every failure. Ours, never the provider's. */
const LINK_SPENT =
  "/login?notice=That%20link%20is%20no%20longer%20valid.%20Request%20a%20new%20one.";

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (!supabasePublicConfigured()) {
    return NextResponse.redirect(
      new URL(
        "/login?notice=Sign-in%20is%20not%20configured%20for%20this%20deployment.",
        url.origin,
      ),
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    /*
     * Supabase reports a rejected link as `error_description` in the query.
     * It is not passed through: it is attacker-influencable text that would be
     * rendered on a page, and it tells a person nothing beyond "the link did
     * not work".
     */
    return NextResponse.redirect(new URL(LINK_SPENT, url.origin));
  }

  // Built before the exchange so the session cookies can be written onto it.
  const response = NextResponse.redirect(new URL(SET_PASSWORD_PATH, url.origin));

  const exchanged = await exchangeCodeOntoResponse(code, response);
  if (!exchanged) {
    return NextResponse.redirect(new URL(LINK_SPENT, url.origin));
  }

  return response;
}
