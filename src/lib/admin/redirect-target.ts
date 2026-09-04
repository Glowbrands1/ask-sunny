import "server-only";

/**
 * Where an invitation or recovery link should land.
 *
 * Built from the REQUEST's own origin, not from a configured site URL. Every
 * Vercel preview deployment has its own hostname, so a fixed origin would send
 * somebody clicking a link in their email to a different deployment than the
 * administrator invited them from — where the session they are handed is
 * useless.
 *
 * The origin still has to be registered in Supabase Auth's redirect allowlist;
 * that list is the actual restriction, and this only decides which of the
 * allowed origins to ask for.
 *
 * NEXT_PUBLIC_SITE_URL is honoured when set, for the one case the request
 * cannot answer: a link sent by something with no inbound request of its own.
 */
export function recoveryRedirectTarget(request: Request, next = "/reset-password"): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = configured || new URL(request.url).origin;
  return `${origin.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
}
