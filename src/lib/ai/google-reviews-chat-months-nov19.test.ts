import { describe, expect, it, vi } from "vitest";

import { goalContext } from "@/lib/reviews/goal";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import type { LocationRollup } from "@/lib/reviews/types";

import { readReviews } from "./agent-loop/data-tools";
import { asksForMonthlyPeriods, isGoogleReviewQuestion, MONTHS_HEADING } from "./google-reviews-chat";
import { loadGoogleReviewsChatBlock } from "./google-reviews-chat-read";

/**
 * ============================================================================
 * MANAGER REQUEST, 19 NOV 2026: THE AI KNOWS THE GOOGLE REVIEWS NOW HAVE L3, L6 AND YTD
 * ============================================================================
 *
 * Their words on the page: "per month pls last 3 mos last 6 mos and YTD". The Google Reviews page gained a Month by
 * month table with L3, L6 and YTD per salon; the chat and the agent loop's read_reviews only knew month to date and
 * this week, so asking the assistant for them got "no figures". Both now read the table's own figures.
 */
const TODAY = "2026-11-19";
const QUESTION = "per month pls last 3 mos last 6 mos and YTD";
const GOOGLE_QUESTION = "How many Google reviews did Manhattan get last 3 mos, last 6 mos and YTD?";

vi.mock("@/lib/config/server-env", () => ({
  supabaseReadiness: () => ({ ready: true, missing: [] }),
}));

const manhattan = GOOGLE_REVIEW_LOCATIONS.find((entry) => entry.storeCode === "306")!;
const location = (storeCode: string): LocationRollup => {
  const listing = GOOGLE_REVIEW_LOCATIONS.find((entry) => entry.storeCode === storeCode)!;
  return {
    storeCode,
    locationName: listing.googleLabel,
    district: null,
    salonNumber: listing.salonNumber,
    listingState: "verified",
    anchorReviewId: `a-${storeCode}`,
    anchorReviewer: null,
    historical: 0,
    reviewsThisWeek: 1,
    qualifyingThisWeek: 1,
    lastWeek: 1,
    qualifyingLastWeek: 1,
    qualifyingMonthToDate: 5,
    unanswered: 0,
    criticalOpen: 0,
    averageRating: 4.5,
    total: 10,
  } as LocationRollup;
};

const snapshot = {
  empty: false,
  lastSyncAt: new Date().toISOString(),
  locations: GOOGLE_REVIEW_LOCATIONS.map((entry) => location(entry.storeCode)),
  goal: goalContext(TODAY, 10),
  currentWeek: "2026-11-15",
  previousWeek: "2026-11-08",
};

/** Manhattan: 2 in each of Aug, Sep, Oct; 1 in May; 4 in Nov so far. L3 = 6, L6 = 7, YTD = 11. */
const counted = [
  ...["2026-08-10", "2026-08-20", "2026-09-05", "2026-09-06", "2026-10-02", "2026-10-30"].map((day, i) => ({ id: `m${i}`, store_code: "306", counted_at: `${day}T18:00:00Z` })),
  { id: "may", store_code: "306", counted_at: "2026-05-12T18:00:00Z" },
  ...[1, 2, 3, 4].map((day) => ({ id: `n${day}`, store_code: "306", counted_at: `2026-11-0${day}T18:00:00Z` })),
];

vi.mock("@/lib/reviews/queries", () => ({
  loadReviewsSnapshot: async () => snapshot,
  loadReviewFeed: async () => ({ reviews: [], total: 0, truncated: false }),
  loadMonthlyProgressRows: async () => ({ counted, posted: [], countingFrom: new Map() }),
}));

describe("the AI knows the Google reviews have L3, L6 and YTD", () => {
  it("their wording, and L3 / L6 / YTD questions, are Google review questions asking for months", () => {
    expect(asksForMonthlyPeriods(QUESTION)).toBe(true);
    for (const q of [GOOGLE_QUESTION, "What are our Google reviews YTD?", "google reviews L3", "reviews for the last six months", "reviews year to date"]) {
      expect(isGoogleReviewQuestion(q), q).toBe(true);
      expect(asksForMonthlyPeriods(q), q).toBe(true);
    }
    expect(asksForMonthlyPeriods("How many Google reviews did we get this week?")).toBe(false);
    /* A form about a person is still not a Google review question. */
    expect(isGoogleReviewQuestion("Write a coaching form for Jane, her reviews YTD are low")).toBe(false);
  });

  it("the chat block carries L3, L6 and YTD per salon, as full months, from the table's own figures", async () => {
    const block = await loadGoogleReviewsChatBlock({ question: GOOGLE_QUESTION, role: "owner", scope: null, now: new Date(`${TODAY}T18:00:00Z`) });
    expect(block?.text).toContain(MONTHS_HEADING);
    expect(block?.text).toContain("L3 = last 3 full months (Aug – Oct 2026)");
    expect(block?.text).toContain("L6 = last 6 full months (May – Oct 2026)");
    expect(block?.text).toMatch(/store 306\): L3 6, L6 7, YTD 11\./);
    expect(block?.text).toContain("Nov 4");
  });

  it("a question that does not ask for those periods does not pay for the month-by-month read", async () => {
    const block = await loadGoogleReviewsChatBlock({ question: "How many Google reviews did we get this week?", role: "owner", scope: null });
    expect(block?.text).not.toContain(MONTHS_HEADING);
  });

  it("read_reviews returns L3, L6 and YTD when the period asks for them", async () => {
    const deps = {
      supabaseReady: async () => true,
      loadReviewsSnapshot: async () => snapshot as never,
      loadReviewFeed: async () => ({ reviews: [], total: 0, truncated: false }) as never,
      loadMonthlyProgress: async (codes: readonly string[]) => {
        const { monthlyProgress } = await import("@/lib/reviews/monthly-progress");
        return monthlyProgress(counted, codes, TODAY);
      },
    };
    const result = (await readReviews(
      { actor: { role: "owner", scope: null }, question: QUESTION, scopeId: "s", today: TODAY } as never,
      { salon: "Manhattan", period: "L3, L6 and YTD" },
      deps as never,
    )) as { months?: { salons: { l3: number; l6: number; ytd: number }[]; windows: string } };
    expect(result.months?.salons[0]).toMatchObject({ l3: 6, l6: 7, ytd: 11 });
    expect(result.months?.windows).toContain("never in L3 or L6");
    void manhattan;
  });
});
