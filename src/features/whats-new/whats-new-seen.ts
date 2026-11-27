"use client";

import { useEffect, useState } from "react";

/**
 * ============================================================================
 * HAS THIS PERSON SEEN THE NEWEST WHAT'S NEW? (the owner, 27 Nov 2026: "create an animation for whats new when
 * something is new like the shaking")
 * ============================================================================
 *
 * The sidebar's What's New entry shakes and shows a "New" dot while the newest entry this person may see is newer than
 * the newest one they have opened the page on. Kept per person, in this browser only (localStorage, keyed by the user
 * id), as the latest entry date seen: a convenience, not a record. Storage that is missing or throws (a private
 * window, blocked site data) counts as not seen, so the dot shows rather than hiding news. Opening What's New marks
 * the newest date seen and tells the sidebar at once (WHATS_NEW_SEEN_EVENT), so the dot goes without a reload.
 */

export const WHATS_NEW_SEEN_EVENT = "whats-new-seen";

export function whatsNewSeenKey(userId: string): string {
  return `whats-new-seen:${userId || "anonymous"}`;
}

/** Unseen when there is a newest date and nothing stored, or the stored date is older. */
export function hasUnseenWhatsNew(latest: string | null, seen: string | null): boolean {
  if (!latest) return false;
  return !seen || seen < latest;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored date, or null when nothing is stored or storage cannot be read. */
export function readWhatsNewSeen(userId: string, store: Store | null = browserStore()): string | null {
  try {
    const value = store?.getItem(whatsNewSeenKey(userId)) ?? null;
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stores `latest` as seen (never moving it backwards). False when storage cannot be written. */
export function markWhatsNewSeen(userId: string, latest: string | null, store: Store | null = browserStore()): boolean {
  if (!latest) return false;
  try {
    const seen = readWhatsNewSeen(userId, store);
    if (!seen || seen < latest) store?.setItem(whatsNewSeenKey(userId), latest);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WHATS_NEW_SEEN_EVENT, { detail: latest }));
    return Boolean(store);
  } catch {
    return false;
  }
}

/**
 * Whether the sidebar should show the dot. False on the server and the first render (no flash of a wrong answer, and
 * the dot is placed so it never moves anything), then the stored answer. False while on What's New itself.
 */
export function useWhatsNewUnseen(userId: string, latest: string | null, onWhatsNew: boolean): boolean {
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    const check = () => setUnseen(hasUnseenWhatsNew(latest, readWhatsNewSeen(userId)));
    check();
    window.addEventListener(WHATS_NEW_SEEN_EVENT, check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(WHATS_NEW_SEEN_EVENT, check);
      window.removeEventListener("storage", check);
    };
  }, [userId, latest]);
  return unseen && !onWhatsNew;
}
