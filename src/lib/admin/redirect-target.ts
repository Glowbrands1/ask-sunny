import "server-only";

import { ACCEPT_PATH, recoveryUrlFor } from "@/lib/auth/routes";

/**
 * ============================================================================
 * WHERE AN EMAILED SIGN-IN LINK LANDS — and why there are two answers.
 * ============================================================================
 *
 * Supabase hands a session back in one of two shapes, decided by WHICH CLIENT
 * asked for the link, not by anything we configure:
 *
 *   PKCE, `?code=…` in the QUERY STRING.
 *     Produced only when the requesting client has `flowType: "pkce"` and can
 *     store a code verifier — which means the BROWSER. `/forgot-password` is
 *     the one path like this, since `@supabase/ssr`'s `createBrowserClient`
 *     sets that flow type itself.
 *
 *   IMPLICIT, `#access_token=…` in the URL FRAGMENT.
 *     Produced by everything sent from the SERVER. `inviteUserByEmail` never
 *     sends a code challenge at all — there is no PKCE branch in it — so an
 *     admin invitation is always implicit, whatever the project settings say.
 *     `resetPasswordForEmail` called on the admin client is implicit too,
 *     because plain `createClient` defaults to `flowType: "implicit"`.
 *
 * A FRAGMENT IS NEVER SENT TO A SERVER. Pointing an implicit link at a route
 * handler gives it a request with no `code` and no fragment, so it correctly
 * concludes the link is invalid and bounces the person to sign-in — which is
 * exactly the failure observed first on the initial invitation, and again on
 * password recovery.
 *
 * So every emailed link goes to a CLIENT page that can read
 * `window.location.hash`. Both functions below now return one; they stay
 * separate because the two link kinds land on DIFFERENT pages — an invitation
 * is greeted with "accept your invitation", a reset with "create a new
 * password" — and collapsing them would put the wrong words in front of one of
 * the two.
 */

/** The origin an emailed link should point back at. */
function siteOrigin(request: Request): string {
  /*
   * The REQUEST's own origin unless one is configured, because every Vercel
   * preview deployment has its own hostname: a fixed origin would send somebody
   * clicking a link in their email to a different deployment than the
   * administrator invited them from, where the session they are handed is
   * useless. The origin still has to be registered in Supabase Auth's redirect
   * allowlist — that list is the real restriction, this only chooses which of
   * the allowed origins to ask for.
   */
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = configured || new URL(request.url).origin;
  return origin.replace(/\/$/, "");
}

/**
 * The landing page for a PASSWORD RECOVERY link.
 *
 * Only `/forgot-password` produces one today, and it runs in the browser, so
 * nothing on the server calls this. It exists so that a future server-side
 * sender has one obvious place to ask, rather than writing the path out again.
 *
 * IT IS THE CLIENT PASSWORD SCREEN, not a route handler, and that is the fix
 * this milestone is about. A route handler can read the `?code=` a PKCE link
 * carries and can NEVER read the `#access_token=` an implicit one carries,
 * because a browser does not transmit fragments — so the old landing answered
 * every implicit link with "this link is spent" and bounced a live recovery
 * session onto the sign-in screen. `/reset-password` reads both.
 *
 * NO QUERY STRING, which the earlier fix established and this keeps: the
 * destination afterwards is compiled into the page rather than carried in a
 * parameter an emailed link could point elsewhere.
 */
export function pkceRedirectTarget(request: Request): string {
  return recoveryUrlFor(siteOrigin(request));
}

/**
 * The landing page for an IMPLICIT link — a `#access_token=` only a browser can
 * read.
 *
 * Used by invitations and by administrator-sent sign-in links. Deliberately
 * NOT named for invitations: it serves both, and a route named `invite` that
 * quietly also handles password resets is the same class of mismatch that
 * caused this bug in the first place.
 *
 * No `next` parameter. The destination after a fragment is consumed is always
 * "set a password", and making it configurable would put a redirect target in a
 * URL that arrives by email — an open redirect delivered by a message from a
 * real sender, which is worse than one delivered by a link.
 */
export function implicitRedirectTarget(request: Request): string {
  return `${siteOrigin(request)}${ACCEPT_PATH}`;
}

/**
 * The same implicit target, built from a bare origin rather than a request.
 *
 * For callers with no inbound request of their own — the bootstrap script,
 * which is handed an origin on the command line.
 */
export function implicitRedirectTargetFor(origin: string): string {
  return `${new URL(origin).origin.replace(/\/$/, "")}${ACCEPT_PATH}`;
}
