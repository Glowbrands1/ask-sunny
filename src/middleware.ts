import { NextResponse, type NextRequest } from "next/server";

import { supabasePublicConfigured } from "@/lib/config/runtime";
import { getSupabaseSessionClientFor } from "@/lib/supabase/auth-clients";

/**
 * ============================================================================
 * SESSION REFRESH. The one job this middleware has.
 * ============================================================================
 *
 * Supabase access tokens are short-lived and are refreshed by whichever
 * Supabase client notices they are stale. On the server, the only place a
 * refreshed token can actually be WRITTEN BACK is here: a Server Component
 * cannot set cookies during render, so `auth-clients.ts` deliberately swallows
 * the write there. Without this file, a person would be signed out every time
 * their access token aged out, however active they were.
 *
 * So the sequence is: build a response, hand its cookie jar to a session
 * client, call `getUser()` to trigger any refresh, and return the response
 * carrying whatever cookies that produced.
 *
 * ============================================================================
 * WHAT THIS MIDDLEWARE DELIBERATELY DOES NOT DO
 * ============================================================================
 *
 * IT DOES NOT AUTHORIZE. Not one redirect, not one permission check. Two
 * reasons, and the second is the important one:
 *
 *   Authorization belongs where the data is. The page guards and
 *   `authorizeRequest()` run next to the queries they protect, so a screen
 *   cannot be added without a decision about who may see it. A middleware
 *   matcher is a second, parallel description of the same rules — and when the
 *   two disagree, the pattern list is the one that gets forgotten.
 *
 *   Middleware runs before the request reaches the route, which makes it look
 *   like the strongest place to enforce. It is not: it is the place most likely
 *   to be bypassed by a path nobody added to the matcher.
 *
 * IT DOES NOT TOUCH `/api/reporting/inbound-email`. That endpoint is
 * authenticated by RESEND'S WEBHOOK SIGNATURE, not by an Ask Sunny session, and
 * it must keep working with no user signed in — a report arriving at 6am has
 * nobody's cookie attached. The matcher excludes `/api` entirely, and a test
 * asserts it, because breaking the reporting pipeline by adding auth
 * middleware is the exact regression this comment exists to prevent.
 */

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // Nothing to refresh where there is no provider. Also keeps demo mode from
  // paying for a client construction on every request.
  if (!supabasePublicConfigured()) return response;

  try {
    const client = getSupabaseSessionClientFor({
      getAll: () => request.cookies.getAll(),
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

    /*
     * The call itself is the point — its RESULT is not used. `getUser()`
     * validates the token with the auth server and rotates it if needed, and
     * the rotation is what lands in `response.cookies` above. Nothing is read
     * from it here, and nothing is logged: this runs on every request, so a log
     * line would emit at the rate of the whole application's traffic.
     */
    await client.auth.getUser();
  } catch {
    /*
     * A refresh failure must never block a request. The page guards and route
     * guards make their own decision from whatever the cookie still proves; a
     * middleware that threw would turn an expired session into a 500 on every
     * screen, including the login screen somebody needs to get back in.
     */
  }

  return response;
}

export const config = {
  /*
   * Everything EXCEPT api routes, Next's internals and static files.
   *
   * `/api` is excluded on purpose and not as an optimisation — see the note
   * above about the reporting webhook. The static exclusions keep this off the
   * path of assets, where there is no session to refresh.
   */
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
