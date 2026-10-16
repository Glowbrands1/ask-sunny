/**
 * SAME-ORIGIN GUARD for the state-changing admin routes.
 *
 * Sessions here are cookies (Supabase, SameSite=Lax), which already keeps a
 * cross-site POST from carrying the session. This is the second layer: a browser
 * always sends `Origin` on a POST, and `Sec-Fetch-Site` on every request, so a
 * request that declares itself cross-site is refused whatever it carries.
 *
 * A request with neither header (curl, a server) is not a browser and cannot be
 * riding somebody's session, so it is allowed through to the normal checks.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";
  return true;
}
