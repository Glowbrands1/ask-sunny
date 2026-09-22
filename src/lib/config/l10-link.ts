/**
 * ============================================================================
 * THE L10 MEETING LINK — ADMINISTRATOR-ONLY, AND RESOLVED ON THE SERVER
 * ============================================================================
 *
 * THE REQUEST, from the Teams test rollout: "The L10 meeting link needs to be
 * restricted to admin accounts only for now."
 *
 * ============================================================================
 * WHY THE DESTINATION IS SERVER-SIDE AND NOT A `NEXT_PUBLIC_` VALUE
 * ============================================================================
 *
 * Because the requirement is authorization, not concealment of a control. A
 * `NEXT_PUBLIC_` variable is inlined into the JavaScript every visitor
 * downloads, so hiding the tile would leave the address in the bundle of every
 * Salon Director who opened the page — restricted on screen and readable in
 * devtools. The same is true of a URL written into a data file.
 *
 * So the address is read HERE, server-side, and reaches a browser only through
 * `GET /api/resources/l10`, which applies `view_l10_meetings` before it
 * redirects. A non-administrator does not see the link, is refused if they type
 * the path, and never receives the destination in the first place.
 *
 * ============================================================================
 * NO URL IS INVENTED, AND UNSET IS A SUPPORTED STATE
 * ============================================================================
 *
 * The only L10 address this repository has ever held is
 * `preview--leadership-sync-tool.lovable.app` — a Lovable PREVIEW host rather
 * than a production domain, which is exactly why `data/resources.ts` refuses to
 * publish it and why it lives behind the demo boundary. That judgement is
 * unchanged: this module reads configuration and guesses nothing.
 *
 * Unset means the deployment has not been given the address. The route says so
 * with a 404 and the surfaces render no tile, which is the same honest empty
 * state the training destinations use rather than a link that goes nowhere.
 */

export const L10_MEETINGS_URL_ENV = "L10_MEETINGS_URL";

/**
 * THE NAME HAS NO `NEXT_PUBLIC_` PREFIX ON PURPOSE, and that is load-bearing
 * rather than stylistic. Next inlines `NEXT_PUBLIC_` values into client
 * JavaScript at build time; an unprefixed one is simply not present there. So
 * even a mistaken import of `readL10Url` from a client component reads
 * `undefined` and returns null — the address cannot reach a browser by
 * accident, only through the route that checks the permission.
 */

/**
 * Accepts only an absolute http(s) URL.
 *
 * A relative value would resolve against Ask Sunny's own origin and redirect
 * the manager back into this app — the same failure `training-links.ts` guards,
 * and worse here because the redirect is issued by the server.
 */
function usableUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The configured L10 destination, or null where this deployment has none.
 *
 * `env` is a parameter so the rule can be tested without mutating the process,
 * which is what every other configuration module here does.
 */
export function readL10Url(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string | null {
  return usableUrl(env[L10_MEETINGS_URL_ENV]);
}

/**
 * THE PATH EVERY SURFACE LINKS TO, and the reason there is a constant for it.
 *
 * Nothing renders the destination. A tile, a shortcut chip or a future surface
 * points at this path, the route resolves the address behind the permission,
 * and a link that escaped its gate still cannot hand anybody the destination.
 */
export const L10_MEETINGS_PATH = "/api/resources/l10";
