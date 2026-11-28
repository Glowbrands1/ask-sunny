/**
 * ============================================================================
 * IS THE INVITATION LINK LIVE? — asked before any new hire is emailed
 * ============================================================================
 *
 * Pau, 28 Nov 2026: "auto give them link from their woven email … but can u
 * check first if the link is live?" The invitation email sends the new hire to
 * the accept page (`/auth/accept` on this site). If that page is down, or
 * redirects somewhere else (a sign-in bounce, a protected preview), the email
 * is spent on a link that does not work, and the mailer allows two an hour.
 *
 * So before the hourly run asks the mailer for anything, it opens the accept
 * page once, as the new hire's browser would. Live means: it answered 2xx, and
 * after any redirect it is still the same page. Anything else — an error
 * status, a redirect elsewhere, no answer within the timeout, a URL that does
 * not parse — is not live, and the run stops before sending, spending nobody's
 * attempts.
 *
 * Pure apart from the `fetch` it is handed. Never throws.
 */

export const INVITE_LINK_NOT_LIVE = "invite_link_not_live";

const TIMEOUT_MS = 8000;

export type FetchLike = (url: string, init: { method: "GET"; redirect: "follow"; signal: AbortSignal; cache: "no-store" }) => Promise<{
  ok: boolean;
  url: string;
}>;

export async function inviteLinkIsLive(
  link: string | null,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = TIMEOUT_MS,
): Promise<boolean> {
  if (!link) return false;
  let target: URL;
  try {
    target = new URL(link);
  } catch {
    return false;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target.toString(), { method: "GET", redirect: "follow", signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    // A redirect that left the page (e.g. to /login) means the link would not land where the email says.
    const landed = response.url ? new URL(response.url) : target;
    return landed.origin === target.origin && landed.pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, "");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
