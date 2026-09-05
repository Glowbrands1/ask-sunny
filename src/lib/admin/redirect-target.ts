import "server-only";

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
 *     the one path like this. A query string reaches the server, so the code is
 *     exchanged for a session in a route handler: `/auth/callback`.
 *
 *   IMPLICIT, `#access_token=…` in the URL FRAGMENT.
 *     Produced by everything sent from the SERVER. `inviteUserByEmail` never
 *     sends a code challenge at all — there is no PKCE branch in it — so an
 *     admin invitation is always implicit, whatever the project settings say.
 *     `resetPasswordForEmail` called on the admin client is implicit too,
 *     because plain `createClient` defaults to `flowType: "implicit"`.
 *
 * A FRAGMENT IS NEVER SENT TO A SERVER. That is the whole reason this file has
 * two functions instead of one: pointing an implicit link at `/auth/callback`
 * gives a route handler a request with no `code` and no fragment, so it
 * correctly concludes the link is invalid and bounces the person to sign-in —
 * which is exactly the failure that was observed on the first real invitation.
 *
 * So implicit links go to a CLIENT page that can read `window.location.hash`.
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
 * The landing page for a PKCE link — a `?code=` the server can exchange.
 *
 * Used only by `/forgot-password`, which runs in the browser. Nothing on the
 * server can produce a link of this shape, so nothing on the server should
 * point at this route.
 */
export function pkceRedirectTarget(request: Request, next = "/reset-password"): string {
  return `${siteOrigin(request)}/auth/callback?next=${encodeURIComponent(next)}`;
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
  return `${siteOrigin(request)}/auth/accept`;
}

/**
 * The same implicit target, built from a bare origin rather than a request.
 *
 * For callers with no inbound request of their own — the bootstrap script,
 * which is handed an origin on the command line.
 */
export function implicitRedirectTargetFor(origin: string): string {
  return `${new URL(origin).origin.replace(/\/$/, "")}/auth/accept`;
}
