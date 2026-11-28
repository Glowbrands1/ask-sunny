import "server-only";

import { whatsNewEnabled } from "@/config/whats-new";

/**
 * WHO SEES WHAT'S NEW (NEXT_PUBLIC_WHATS_NEW_ENABLED, WHATS_NEW_USERS). The owner, 27 Nov 2026: "live but on my own
 * page only".
 *
 *   NEXT_PUBLIC_WHATS_NEW_ENABLED on   everyone (the rollout)
 *   off, WHATS_NEW_USERS "a@x, B@y"    only those verified sign-in emails (letter case and spaces do not matter)
 *   off, WHATS_NEW_USERS unset / empty nobody
 *
 * One answer for the sidebar entry, search, the page and read_whats_new. `WHATS_NEW_USERS` is server-only: never
 * logged, never sent to the browser (the layout hands down one yes/no, `WhatsNewAccessProvider`), and the email
 * checked against it is always the verified session's (`pageIdentity()`, the loop's actor), never one the browser sends.
 */
export function whatsNewVisibleFor({ email, verified }: { readonly email?: string | null; readonly verified?: boolean | null }): boolean {
  if (whatsNewEnabled()) return true;
  if (verified !== true) return false;
  const signedIn = (email ?? "").trim().toLowerCase();
  if (!signedIn) return false;
  return whatsNewUsers().includes(signedIn);
}

function whatsNewUsers(): string[] {
  return (process.env.WHATS_NEW_USERS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Is this verified sign-in on HR's notice list (WOVEN_HR_NOTIFY_EMAILS: the people who hear of every Woven hire and
 * termination)? What's New shows them the entries meant for admins and HR (`audience: "admins_and_hr"`). Server-only,
 * like WHATS_NEW_USERS; the email is always the verified session's.
 */
export function wovenHrNotifyFor({ email, verified }: { readonly email?: string | null; readonly verified?: boolean | null }): boolean {
  if (verified !== true) return false;
  const signedIn = (email ?? "").trim().toLowerCase();
  if (!signedIn) return false;
  return (process.env.WOVEN_HR_NOTIFY_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .includes(signedIn);
}
