import { describe, expect, it } from "vitest";

import { hasUnseenWhatsNew, markWhatsNewSeen, readWhatsNewSeen, whatsNewSeenKey } from "./whats-new-seen";

/**
 * The sidebar's What's New wiggle and "New" dot (the owner, 27 Nov 2026): shown while the newest entry a person may see
 * is newer than the newest they opened the page on, per person, in this browser; storage that fails shows the dot.
 */
function memory() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}
const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("What's New seen state", () => {
  it("unseen when nothing is stored or the stored date is older; seen once the newest date is stored", () => {
    expect(hasUnseenWhatsNew("2026-11-27", null)).toBe(true);
    expect(hasUnseenWhatsNew("2026-11-27", "2026-11-26")).toBe(true);
    expect(hasUnseenWhatsNew("2026-11-27", "2026-11-27")).toBe(false);
    expect(hasUnseenWhatsNew(null, null), "no entries for this person: nothing to announce").toBe(false);
  });

  it("opening the page marks the newest date seen, for that person only, and never moves it backwards", () => {
    const store = memory();
    expect(markWhatsNewSeen("user-a", "2026-11-27", store)).toBe(true);
    expect(readWhatsNewSeen("user-a", store)).toBe("2026-11-27");
    expect(hasUnseenWhatsNew("2026-11-27", readWhatsNewSeen("user-a", store))).toBe(false);
    expect(hasUnseenWhatsNew("2026-11-27", readWhatsNewSeen("user-b", store)), "another person on this browser has not seen it").toBe(true);
    markWhatsNewSeen("user-a", "2026-11-20", store);
    expect(readWhatsNewSeen("user-a", store)).toBe("2026-11-27");
    expect(store.items.has(whatsNewSeenKey("user-a"))).toBe(true);
    // A newer entry later brings the dot back.
    expect(hasUnseenWhatsNew("2026-12-02", readWhatsNewSeen("user-a", store))).toBe(true);
  });

  it("storage that throws or holds rubbish counts as not seen, so the dot shows", () => {
    expect(readWhatsNewSeen("user-a", broken)).toBeNull();
    expect(markWhatsNewSeen("user-a", "2026-11-27", broken)).toBe(false);
    expect(hasUnseenWhatsNew("2026-11-27", readWhatsNewSeen("user-a", broken))).toBe(true);
    const store = memory();
    store.setItem(whatsNewSeenKey("user-a"), "yesterday");
    expect(readWhatsNewSeen("user-a", store)).toBeNull();
    expect(readWhatsNewSeen("user-a", null)).toBeNull();
  });
});
