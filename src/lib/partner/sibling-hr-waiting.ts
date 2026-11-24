import "server-only";

import { fetchSiblingHrQueue, type SiblingHrQueue } from "./sibling-hr-queue";

/**
 * THE SIBLING APP'S WAITING FORMS, AS A NUMBER FOR THE NOTIFICATIONS BAR (Pau, 24 Nov 2026: "can u please not remove
 * the notification in the bar on the left side if there are still pending inside", then "fix" when told the bar counted
 * only this app's forms, not the other app's approvals tab).
 *
 * The same signed request, and the same count, as the sibling's tab on Form Monitoring: forms waiting for this approver
 * there, or sent back and replied to since. The rail is on every page, so the answer is kept for a minute per approver
 * (`TTL_MS`): a page never waits on the sibling more than once a minute, and a sibling that is down costs one timeout a
 * minute, not one per click. Null when the sibling is off, did not answer, or this email is not an approver there.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: SiblingHrWaiting | null }>();

export interface SiblingHrWaiting {
  /** The sibling's own name, from its answer: this app never spells it. */
  app: string;
  count: number;
}

/** Waiting for this approver, or replied to since it was sent back: what the sibling's tab counts. */
export function siblingWaitingCount(queue: SiblingHrQueue): SiblingHrWaiting | null {
  if (queue.status !== "ok" || !queue.approver) return null;
  return { app: queue.app, count: queue.forms.filter((form) => form.state === "pending" || form.managerReplied).length };
}

/** Call only for a VERIFIED identity that is an active HR approver here (it sends that email, as the tab does). */
export async function siblingHrWaiting(
  email: string,
  options: { fetchQueue?: (email: string) => Promise<SiblingHrQueue>; now?: number } = {},
): Promise<SiblingHrWaiting | null> {
  const key = email.trim().toLowerCase();
  const now = options.now ?? Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = siblingWaitingCount(await (options.fetchQueue ?? fetchSiblingHrQueue)(key));
  cache.set(key, { at: now, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

/** Tests only. */
export function clearSiblingHrWaitingCache(): void {
  cache.clear();
}
