import "server-only";

import { ACCEPT_PATH, RECOVERY_START_PATH, recoveryUrlFor } from "@/lib/auth/routes";

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
 *     store a code verifier — which means a browser `@supabase/ssr` client.
 *     `/forgot-password` USED to be this path; it now asks from the server
 *     (`/api/auth/forgot-password`) with an implicit-flow client, because a
 *     PKCE link only completes in the browser that asked for it.
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
 * The landing page for a PASSWORD RECOVERY link: `<site>/reset-password`.
 *
 * Used by the public `/api/auth/forgot-password` endpoint, which asks Supabase
 * for the reset email server-side with an IMPLICIT-flow client, so the link
 * comes back as a `#access_token=` fragment. `/reset-password` is a client page
 * and reads it; a route handler never could, because a browser does not send a
 * fragment to a server.
 *
 * NO QUERY STRING: the destination is compiled in rather than carried in a
 * parameter an emailed link could point elsewhere.
 */
export function recoveryRedirectTarget(request: Request): string {
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

/**
 * The SCANNER-SAFE recovery link for a recovery token hash, on this site.
 *
 * `/auth/recovery-start?token_hash=…&type=recovery` — the same URL shape the
 * Reset Password email template links to, so an administrator-generated link
 * enters exactly the same flow: a GET only parks the token, and nothing is
 * spent until the person presses Continue.
 *
 * Same origin rule as every other emailed link (configured site URL, else the
 * request's own origin), so a link generated on a deployment opens on it.
 *
 * The result is a CREDENTIAL. Callers return it to the one administrator who
 * asked, and never log or store it.
 */
export function recoveryStartUrlFor(request: Request, tokenHash: string): string {
  const url = new URL(RECOVERY_START_PATH, `${siteOrigin(request)}/`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "recovery");
  return url.toString();
}
