import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { getSupabaseSessionClientFor } from "@/lib/supabase/auth-clients";

/**
 * ============================================================================
 * THE AUTH CALLBACK. Where an emailed link becomes a session.
 * ============================================================================
 *
 * Supabase sends recovery and invitation links pointing here with a one-time
 * `code`. This route exchanges that code for a session and sets the session
 * cookies on the RESPONSE — which is why it is a route handler rather than a
 * page. A Server Component cannot write cookies during render, so the exchange
 * would succeed and the cookies would be dropped, leaving somebody who clicked
 * a valid link with no session and no explanation.
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

  /*
   * The response is created FIRST so the Supabase client can write the session
   * cookies onto it. Writing to the `cookies()` store instead would be lost:
   * the redirect below is a new response, and the store's mutations do not
   * follow it.
   */
  const response = NextResponse.redirect(new URL(next, url.origin));
  const store = await cookies();

  const client = getSupabaseSessionClientFor({
    getAll: () => store.getAll(),
    setAll: (entries) => {
      for (const entry of entries) {
        response.cookies.set({
          name: entry.name,
          value: entry.value,
          ...(entry.options as Record<string, unknown>),
        });
      }
    },
  });

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
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
