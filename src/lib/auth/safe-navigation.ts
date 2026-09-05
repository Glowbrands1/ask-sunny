/**
 * ============================================================================
 * WHERE AN AUTH FLOW IS ALLOWED TO SEND SOMEBODY.
 * ============================================================================
 *
 * One rule, in one place, for every destination an auth flow computes: the
 * post-sign-in landing, the legacy callback's `next`, and the landing the
 * activation endpoint returns.
 *
 * ============================================================================
 * THE RULE IS ABOUT THE PARSED URL, NOT THE STRING
 * ============================================================================
 *
 * Three copies of this check used to exist, all testing the INPUT:
 * `startsWith("/")` and `!startsWith("//")`. That accepts
 * `/\evil.example` — one leading slash, and the second character is a
 * backslash rather than a slash — and the WHATWG parser then treats
 * backslashes as slashes for special HTTP(S) schemes, resolving it to
 * `https://evil.example/`. Verified against the real parser, along with
 * `/\\evil.example`, `/\/evil.example` and the userinfo form
 * `/\\user:pass@evil.example`.
 *
 * The lesson is not "also reject backslashes". A prefix test asks a question
 * about a STRING while the browser acts on a PARSED URL, and any enumeration
 * of dangerous prefixes is a guess at a normalisation table the parser is free
 * to change. So the prefix check here is only a cheap first pass, and the
 * decision is made by comparing the RESOLVED origin against the trusted one —
 * a whitelist on the outcome, which cannot be out-argued by a spelling.
 *
 * ENVIRONMENT-NEUTRAL ON PURPOSE. The trusted origin is a PARAMETER, not read
 * from `window` or from a request, so this file works identically in a client
 * component, a route handler and a test. A helper that reached for `window`
 * would have had to be duplicated for the server, which is how three copies
 * happened in the first place.
 */

/** Where anything that fails validation goes. */
export const SAFE_FALLBACK_PATH = "/";

/**
 * Resolves a candidate internal destination against a trusted origin, or falls
 * back to the app root.
 *
 * Returns an ABSOLUTE URL string. Callers that need a path can read
 * `.pathname` etc. off it; returning the absolute form means the same value is
 * usable by `window.location.replace` and by `NextResponse.redirect` without
 * either having to re-resolve it — and re-resolving is where a second, subtly
 * different rule would creep back in.
 *
 * Legitimate path, query and hash are preserved untouched.
 */
export function safeInternalUrl(candidate: unknown, trustedOrigin: string): string {
  const home = new URL(SAFE_FALLBACK_PATH, trustedOrigin).toString();

  /*
   * Cheap first pass, and NOT the boundary. It rejects the obvious cases early
   * — a bare relative path, an absolute URL, a scheme — but nothing here is
   * relied upon for safety.
   */
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return home;

  let resolved: URL;
  try {
    resolved = new URL(candidate, trustedOrigin);
  } catch {
    return home;
  }

  /*
   * THE BOUNDARY. Whatever the string looked like, this is where a browser
   * would actually be sent.
   */
  if (resolved.origin !== trustedOrigin) return home;

  /*
   * Credentials cannot survive the origin check above on their own, but a URL
   * carrying userinfo is not something an auth flow has any reason to emit,
   * and refusing it costs nothing.
   */
  if (resolved.username !== "" || resolved.password !== "") return home;

  /*
   * And only a real web scheme. This guards the case where the TRUSTED origin
   * is itself opaque — `origin` is then the string "null", which would compare
   * equal to another opaque origin and let the check above pass.
   */
  if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return home;

  return resolved.toString();
}

/**
 * The same rule, returning a ROOT-RELATIVE path rather than an absolute URL.
 *
 * For callers that hold a path and want one back. It is derived from
 * `safeInternalUrl` rather than implemented alongside it, so there is still
 * exactly one decision being made.
 */
export function safeInternalPath(candidate: unknown, trustedOrigin: string): string {
  const url = new URL(safeInternalUrl(candidate, trustedOrigin));
  return `${url.pathname}${url.search}${url.hash}`;
}
