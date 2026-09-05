import { NextResponse } from "next/server";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { exchangeCodeOntoResponse } from "@/lib/auth/code-exchange";

/**
 * ============================================================================
 * THE AUTH CALLBACK. Where an emailed link becomes a session.
 * ============================================================================
 *
 * THE ORIGINAL PKCE CALLBACK, KEPT FOR LINKS ALREADY IN FLIGHT.
 *
 * Nothing points here any more. Password recovery asks for `/auth/recovery`
 * instead — a path with no query string, because the `?next=` this route
 * relies on is what Supabase declined — and invitations go to `/auth/accept`,
 * because they arrive as a fragment no server can read.
 *
 * It stays because recovery links already sitting in somebody's inbox point
 * here and remain valid until they expire. Deleting the route to tidy up would
 * turn every one of those into a broken link for no benefit. The exchange
 * itself is shared with `/auth/recovery`, so there is one implementation of it.
 *
 * A route handler rather than a page: a Server Component cannot write cookies
 * during render, so the exchange would succeed and the cookies would be
 * dropped, leaving somebody who clicked a valid link with no session and no
 * explanation.
 *
 * NOTHING FROM THE URL IS LOGGED OR REFLECTED. The `code` is a single-use
 * credential: a console line or an error page carrying it would be a
 * credential in a log aggregator or in a browser history. The redirect target
 * is validated as a same-site path, so this cannot be used to bounce somebody
 * to another host with their new session in tow.
 */

export const dynamic = "force-dynamic";

/**
 * Only a same-site path is allowed as a destination.
 *
 * OPEN REDIRECT IS THE ONE THING A CALLBACK LIKE THIS MUST NOT BE. `next` comes
 * from the URL, so without this an emailed link could carry
 * `?next=https://evil.example` and send a freshly-authenticated person
 * somewhere else. Requiring a leading single slash rejects absolute URLs,
 * protocol-relative `//host` and anything with a scheme.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));

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
     * Supabase reports a rejected link as `error_description` in the query. It
     * is NOT passed through: it is attacker-influencable text that would land
     * in a page, and it says nothing a person can act on beyond "the link did
     * not work". Our own sentence says that, and says what to do next.
     */
    return NextResponse.redirect(
      new URL(
        "/login?notice=That%20link%20is%20no%20longer%20valid.%20Request%20a%20new%20one.",
        url.origin,
      ),
    );
  }

  // Built before the exchange so the session cookies can be written onto it.
  const response = NextResponse.redirect(new URL(next, url.origin));

  const exchanged = await exchangeCodeOntoResponse(code, response);
  if (!exchanged) {
    // Same reasoning as above: our sentence, not the provider's.
    return NextResponse.redirect(
      new URL(
        "/login?notice=That%20link%20is%20no%20longer%20valid.%20Request%20a%20new%20one.",
        url.origin,
      ),
    );
  }

  return response;
}
