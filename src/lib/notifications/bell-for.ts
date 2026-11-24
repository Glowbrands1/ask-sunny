import "server-only";

import { listNotifications } from "./repository";
import type { BellData } from "./types";

/**
 * THE BELL — the signed-in person's own notifications (`app_notifications`), as the layout hands them to the rail.
 *
 * EVERYONE SIGNED IN HAS IT (owner, 24 Nov 2026: "i need a bell for all users/managers for when HR send back their
 * forms", then "and also when HR approved it, need notification", "should be all for users"). It used to show only to
 * someone who already had a notification, or was an HR approver or on the AI Training list, "rather than one that is always empty". But the people
 * HR writes to are managers who have never had one, and a manager who pressed Clear all has none again, so the "You
 * sent a form for HR approval" / "HR added a note" / "HR sent your form back" / "HR approved your form" items landed in
 * a bell nobody could open. An empty bell says "Nothing yet".
 *
 * `waitingHr` is the HR approver's count of forms still waiting (null for everyone else), kept on the bar's badge.
 * Still scoped to the caller's own email; no email (a preview with no account) means no bell. A failed read (the table
 * not yet migrated, say) hides it instead of taking down every page.
 */
export async function bellFor(
  identity: { email?: string | null } | null,
  waitingHr: () => Promise<number | null> = async () => null,
): Promise<BellData | null> {
  try {
    const email = identity?.email?.trim().toLowerCase();
    if (!email) return null;
    const [data, waiting] = await Promise.all([listNotifications(email), waitingHr()]);
    return waiting ? { ...data, waitingHr: waiting } : data;
  } catch {
    return null;
  }
}
