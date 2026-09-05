/**
 * ============================================================================
 * THE AUTH ROUTE PATHS, in one place both halves of the app can read.
 * ============================================================================
 *
 * Client-safe on purpose. `forgot-password-form.tsx` runs in the browser and
 * cannot import `lib/admin/redirect-target.ts`, which is `server-only` — so
 * before this file existed it built its redirect URL by hand, as a string
 * literal, and the two descriptions of "where a recovery link lands" sat in
 * different files with nothing tying them together.
 *
 * ============================================================================
 * WHY RECOVERY HAS NO QUERY STRING
 * ============================================================================
 *
 * `/auth/callback?next=/reset-password` was requested by the browser and
 * verified as such: `appendPkceFlowIdToRedirects` is off by default, so
 * `resetPasswordForEmail` transmits `redirectTo` verbatim. The link that came
 * back nonetheless pointed at the Site URL ROOT with `?code=` — the signature
 * of Supabase declining the redirect target and falling back — and adding the
 * exact query-string URL to the allowlist did not change it.
 *
 * Rather than keep guessing at which of Supabase's redirect-matching rules
 * dislikes a query string, recovery now asks for a path that HAS none. A URL
 * with no query cannot be affected by query handling, by glob matching across
 * `?`, or by a parameter something appends later: the whole class of ambiguity
 * stops applying.
 *
 * The destination after the exchange is fixed in the route rather than carried
 * in the URL, which also means there is no redirect parameter for anyone to
 * point somewhere else.
 */

/**
 * Where a PASSWORD RECOVERY link lands. Exact path, no query, no fragment.
 *
 * The one entry an operator has to add to Supabase's redirect allowlist for
 * recovery to work.
 */
export const RECOVERY_PATH = "/auth/recovery";

/**
 * Where an INVITATION lands — and any sign-in link an administrator sent.
 *
 * A client page, because those arrive as a `#access_token=…` fragment and a
 * fragment is never transmitted to a server.
 */
export const ACCEPT_PATH = "/auth/accept";

/**
 * The original PKCE callback. KEPT, and not because anything still points at
 * it.
 *
 * Recovery links already sitting in somebody's inbox point here, and they stay
 * valid until they expire. Deleting the route to tidy up would turn every one
 * of those into a broken link for no benefit.
 */
export const CALLBACK_PATH = "/auth/callback";

/** Where somebody goes to choose a password, after either link type. */
export const SET_PASSWORD_PATH = "/reset-password";

/** Builds the absolute recovery target for a given origin. */
export function recoveryUrlFor(origin: string): string {
  return `${origin.replace(/\/$/, "")}${RECOVERY_PATH}`;
}
