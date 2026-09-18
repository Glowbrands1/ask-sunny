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
 * WHY RECOVERY LANDS ON A CLIENT PAGE
 * ============================================================================
 *
 * Recovery used to land on `/auth/recovery`, a ROUTE HANDLER that reads
 * `?code=` off the query string. That works for a PKCE link and cannot ever
 * work for an implicit one: `#access_token=…` is a URL fragment, and a browser
 * never transmits a fragment to a server. The handler therefore saw a request
 * with no `code`, concluded the link was spent, and redirected to `/login` —
 * and because browsers carry a fragment onto a redirect target that has none,
 * the live recovery session rode along to the sign-in screen and sat there
 * unread. That is the bug, and no allowlist entry could have fixed it.
 *
 * BOTH SHAPES REACH THIS PROJECT — the browser's own `resetPasswordForEmail`
 * sends a PKCE challenge, while every link sent from our server is implicit —
 * so recovery now lands somewhere that can read either. Only a client page can
 * read a fragment, so that is what `/reset-password` is.
 *
 * NO QUERY STRING IS REQUESTED, and that part of the earlier fix is kept. The
 * destination after the link is consumed is compiled in rather than carried in
 * the URL, so there is no redirect parameter for an emailed link to point
 * somewhere else — an open redirect delivered by a real sender on behalf of a
 * real reset is worse than one delivered by a link somebody had to click.
 */

/** Where somebody goes to choose a password. */
export const SET_PASSWORD_PATH = "/reset-password";

/**
 * Where a PASSWORD RECOVERY link lands. Exact path, no query, no fragment.
 *
 * The same page that sets the password, because the page is what consumes the
 * link. One of the two entries an operator has to add to Supabase's redirect
 * allowlist.
 */
export const RECOVERY_PATH = SET_PASSWORD_PATH;

/**
 * Where an INVITATION lands — and any sign-in link an administrator sent.
 *
 * A client page, because those arrive as a `#access_token=…` fragment and a
 * fragment is never transmitted to a server. The other allowlist entry.
 */
export const ACCEPT_PATH = "/auth/accept";

/**
 * The PREVIOUS recovery landing. KEPT, and not because anything still points
 * at it.
 *
 * Recovery links already sitting in somebody's inbox point here and stay valid
 * until they expire. The route now forwards to `SET_PASSWORD_PATH` rather than
 * to sign-in, so an implicit fragment arriving on an old link rides the
 * redirect to a page that can actually read it.
 */
export const LEGACY_RECOVERY_PATH = "/auth/recovery";

/**
 * The original PKCE callback. KEPT for the same reason, and for the same
 * links.
 */
export const CALLBACK_PATH = "/auth/callback";

/** Builds the absolute recovery target for a given origin. */
export function recoveryUrlFor(origin: string): string {
  return `${origin.replace(/\/$/, "")}${RECOVERY_PATH}`;
}
