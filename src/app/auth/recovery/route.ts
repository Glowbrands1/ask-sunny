import { NextResponse } from "next/server";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { exchangeCodeOntoResponse } from "@/lib/auth/code-exchange";
import { EXPIRED_QUERY } from "@/lib/auth/recovery-link";
import { SET_PASSWORD_PATH } from "@/lib/auth/routes";

/**
 * ============================================================================
 * /auth/recovery — the PREVIOUS password-reset landing, kept for links in
 * flight.
 * ============================================================================
 *
 * Nothing points here any more. `resetPasswordForEmail` now asks for
 * `/reset-password`, a CLIENT page, because only a client page can read the
 * `#access_token=…` fragment that an implicit recovery link carries — and this
 * project demonstrably receives both link shapes.
 *
 * The route stays because recovery links already sitting in somebody's inbox
 * point at it and remain valid until they expire. Deleting it to tidy up would
 * turn every one of those into a broken link for no benefit.
 *
 * ============================================================================
 * WHY A REQUEST WITH NO CODE NOW GOES TO THE PASSWORD SCREEN
 * ============================================================================
 *
 * This is the fix for the reported bug, in the one place an old link can still
 * hit it.
 *
 * A fragment is never transmitted to a server, so an IMPLICIT link arriving
 * here looks exactly like an empty request: no `code`, nothing to read. This
 * route used to answer that by redirecting to `/login?notice=…` — and browsers
 * carry a fragment onto a redirect target that has none, so the live recovery
 * session rode along to the SIGN-IN SCREEN, where nothing was ever going to
 * consume it. A person holding a perfectly valid link was shown a password
 * prompt they could not satisfy.
 *
 * Forwarding to `/reset-password` instead costs nothing when the link really
 * is spent — that page says so and offers a fresh one — and rescues the case
 * where it is not. The fragment rides the redirect to a page that can read it.
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

/**
 * Where anything that is not a working `?code=` goes.
 *
 * No query string, so a fragment the browser is still holding survives the
 * redirect intact and reaches the page that can read it.
 */
const PASSWORD_SCREEN = SET_PASSWORD_PATH;

/**
 * The same screen, told the exchange already failed.
 *
 * Only for a code this route DID read and Supabase DID refuse — there is no
 * fragment in that case, and no point making the page ask the auth server a
 * question whose answer is already known.
 */
const SPENT_LINK = `${SET_PASSWORD_PATH}${EXPIRED_QUERY}`;

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
     * Either an implicit link whose fragment this server cannot see, or a
     * genuinely empty request. Both are answered by the page: it reads the
     * fragment if there is one and says the link is spent if there is not.
     *
     * Supabase reports a rejected link as `error_description` in the query.
     * It is not passed through: it is attacker-influencable text that would be
     * rendered on a page, and it tells a person nothing beyond "the link did
     * not work".
     */
    return NextResponse.redirect(new URL(PASSWORD_SCREEN, url.origin));
  }

  // Built before the exchange so the session cookies can be written onto it.
  const response = NextResponse.redirect(new URL(PASSWORD_SCREEN, url.origin));

  const exchanged = await exchangeCodeOntoResponse(code, response);
  if (!exchanged) {
    return NextResponse.redirect(new URL(SPENT_LINK, url.origin));
  }

  return response;
}
