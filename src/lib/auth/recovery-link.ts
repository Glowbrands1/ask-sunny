/**
 * ============================================================================
 * READING WHAT A RECOVERY LINK CAME BACK WITH.
 * ============================================================================
 *
 * Supabase hands a recovery session back in one of TWO shapes, and which one
 * arrives is decided by the client that ASKED for the link — not by anything
 * configured in the dashboard:
 *
 *   `?code=…`          PKCE. A query string, so a server can read it. Produced
 *                      when the requesting client sent a code challenge, which
 *                      `@supabase/ssr`'s `createBrowserClient` does by default
 *                      (`flowType: "pkce"`).
 *
 *   `#access_token=…`  IMPLICIT. A URL fragment, which a browser NEVER
 *                      transmits to a server. Produced by a plain
 *                      `createClient`, whose default is `flowType: "implicit"`
 *                      — so every link sent from our server is this shape, and
 *                      so is any link Supabase issues without a flow state.
 *
 * BOTH SHAPES REACH THIS PROJECT. That is measured, not assumed: the auth
 * schema holds PKCE flow states for recovery AND an outstanding recovery token
 * with no `pkce_` prefix. A landing page that understands only one of them
 * fails roughly half the time, and the failure is silent — the person is shown
 * a sign-in form while holding a perfectly valid recovery credential.
 *
 * Which is exactly how this broke. Recovery pointed at `/auth/recovery`, a
 * route handler, which correctly concluded "no `code`, so the link is dead"
 * and redirected to `/login`. Browsers carry a fragment onto a redirect target
 * that has none, so the session rode along to the sign-in screen and sat there
 * unread.
 *
 * ============================================================================
 * WHY THIS IS A PURE FUNCTION
 * ============================================================================
 *
 * It takes two strings and reads nothing from `window`. That keeps the one
 * decision that has to be right — "what did this link actually carry?" —
 * testable without a DOM, and stops a second, subtly different copy of it
 * appearing in the component that needs the answer.
 *
 * NOTHING HERE LOGS, and the provider's own `error_description` is discarded
 * rather than carried. It is attacker-influencable text that would be rendered
 * on a page, and it tells a person nothing beyond "the link did not work".
 */

/**
 * What a recovery URL carried.
 *
 * Four outcomes rather than a nullable token, because they need four different
 * screens and distinguishing them at the call site is how one of them ends up
 * forgotten.
 */
export type RecoveryLink =
  /** Implicit flow. The session itself, in the fragment. */
  | { kind: "implicit"; accessToken: string; refreshToken: string }
  /** PKCE flow. A single-use code to exchange for a session. */
  | { kind: "pkce"; code: string }
  /** The provider said the link is spent, expired or otherwise refused. */
  | { kind: "rejected" }
  /** No recovery material at all — a direct visit, or a link already consumed. */
  | { kind: "none" };

/**
 * The query parameter `/auth/recovery` sets when a code it read would not
 * exchange. Exported so the route that writes it and the parser that reads it
 * cannot drift apart.
 */
export const EXPIRED_MARKER = "link";

/** The full query string to append when sending somebody to a spent link. */
export const EXPIRED_QUERY = `?${EXPIRED_MARKER}=expired`;

/** Tolerates the leading `?`/`#` a browser includes, and an empty string. */
function params(raw: string): URLSearchParams {
  const trimmed = raw.startsWith("?") || raw.startsWith("#") ? raw.slice(1) : raw;
  return new URLSearchParams(trimmed);
}

/** Supabase reports a refused link the same way in both shapes. */
function refused(source: URLSearchParams): boolean {
  return Boolean(source.get("error") || source.get("error_code"));
}

/**
 * Classifies a recovery landing URL from its query string and its fragment.
 *
 * THE FRAGMENT IS READ FIRST, deliberately. When both are somehow present the
 * fragment is the one that already contains a session, so preferring it avoids
 * a pointless exchange round trip — and a `?code=` left over from an earlier
 * navigation cannot override a session that is actually in hand.
 *
 * `type=recovery` is NOT required. Invitations and administrator-sent sign-in
 * links arrive in the same fragment shape and legitimately end at this screen,
 * and the token is validated by Supabase either way — refusing on the label
 * would reject real links to enforce something the label cannot prove.
 */
export function readRecoveryLink(search: string, hash: string): RecoveryLink {
  const fragment = params(hash);

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "implicit", accessToken, refreshToken };
  }

  if (refused(fragment)) return { kind: "rejected" };

  const query = params(search);

  const code = query.get("code");
  if (code) return { kind: "pkce", code };

  if (refused(query)) return { kind: "rejected" };

  /*
   * OUR OWN MARKER, set by `/auth/recovery` when a code it did read failed to
   * exchange. Deliberately not called `error`: it is not a provider value and
   * carries no provider text, only the fact that the exchange already happened
   * and already failed — which lets this screen say so without a round trip
   * that is certain to come back empty.
   */
  if (query.get(EXPIRED_MARKER) === "expired") return { kind: "rejected" };

  return { kind: "none" };
}
