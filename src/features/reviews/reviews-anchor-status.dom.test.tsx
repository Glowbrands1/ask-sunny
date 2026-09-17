// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EMPTY_REVIEW_FILTERS } from "@/lib/reviews/filters";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";
import type { LocationRollup, ReviewSummary } from "@/lib/reviews/types";

import { ReviewsScreen } from "./reviews-screen";

/**
 * ============================================================================
 * THE ANCHOR STATUS ON THE DASHBOARD, AND WHERE IT LEADS
 * ============================================================================
 *
 * A salon with no anchor shows zero for the week. That zero is about the
 * configuration, not the salon, and the leaderboard has always said so. What
 * these tests add is the other half: for somebody who can fix it, the sentence
 * is a LINK to that location's own baseline setup, so noticing the problem and
 * resolving it are the same gesture.
 *
 *   THE FACT IS FOR EVERYBODY, THE LINK IS NOT. A District Manager reads the
 *   dashboard and cannot set a baseline; offering them the link would send them
 *   to a page that bounces them back with `?denied=`.
 *
 *   THE GOOGLE REVIEW ID IS NEVER ON THIS SCREEN. Once a listing is anchored it
 *   says "Tracking active" and names a person.
 *
 *   THE LINK CANNOT CHANGE ANYTHING. It is a GET to a page that reads; no
 *   filter or figure on this dashboard posts to the anchor route.
 *
 * Every reviewer and salon name is invented. The store codes are real, because
 * they are printed on the storefronts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/reviews",
  useSearchParams: () => new URLSearchParams(),
}));

/*
 * The ask bar and the trend chart are stubbed: one needs the app store and the
 * other a measured viewport, and neither has anything to do with anchors. The
 * leaderboard, the notice and the filter bar render for real.
 */
vi.mock("./reviews-ask-bar", () => ({ ReviewsAskBar: () => null }));
vi.mock("./reviews-trend", () => ({ ReviewsTrend: () => null }));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { id: "me", name: "Me", email: "me@example.test", avatarInitials: "ME" },
    role: "admin",
    authenticated: true,
    demoMode: false,
    can: () => true,
    isAdmin: true,
  }),
}));

afterEach(cleanup);

function location(overrides: Partial<LocationRollup> = {}): LocationRollup {
  return {
    storeCode: "306",
    locationName: "KS Manhattan",
    district: "District 3",
    salonNumber: "0462",
    listingState: "verified",
    anchorReviewId: null,
    anchorReviewer: null,
    historical: 24,
    reviewsThisWeek: 0,
    qualifyingThisWeek: 0,
    lastWeek: 0,
    unanswered: 0,
    criticalOpen: 0,
    averageRating: 4.6,
    total: 24,
    ...overrides,
  };
}

const summary: ReviewSummary = {
  periodId: "period-1",
  weekStart: "2026-09-13",
  weekEnd: "2026-09-19",
  qualifyingThisWeek: 0,
  allNewThisWeek: 0,
  criticalNeedingAttention: 0,
  unanswered: 0,
  averageRating: 4.6,
  byRating: [0, 0, 2, 6, 16],
  monthToDate: 0,
  qualifyingLastWeek: 0,
  allNewLastWeek: 0,
  totalReviews: 24,
  historicalReviews: 24,
  listingsWithoutAnchor: 1,
};

function snapshotWith(locations: LocationRollup[]): ReviewsSnapshot {
  return {
    empty: false,
    summary,
    trend: [],
    locations,
    districts: [],
    districtOptions: ["District 3"],
    locationOptions: locations.map((entry) => ({
      storeCode: entry.storeCode,
      label: entry.locationName,
      district: entry.district,
    })),
    verificationRequired: [],
    awaitingAnchor: locations
      .filter((entry) => entry.anchorReviewId === null)
      .map((entry) => ({
        storeCode: entry.storeCode,
        label: entry.locationName,
        historical: entry.historical,
      })),
    weekStarts: ["2026-09-13"],
    currentWeek: "2026-09-13",
    previousWeek: "2026-09-06",
    lastSyncAt: "2026-09-17T09:00:00.000Z",
  };
}

const feed: ReviewFeed = { reviews: [], total: 0, truncated: false };

function draw(locations: LocationRollup[], canManageAnchors: boolean) {
  return render(
    <ReviewsScreen
      filters={EMPTY_REVIEW_FILTERS}
      snapshot={snapshotWith(locations)}
      feed={feed}
      openReview={null}
      canManageAnchors={canManageAnchors}
    />,
  );
}

describe("the dashboard's anchor status", () => {
  it("still says a location is counting nothing", () => {
    draw([location()], false);

    expect(screen.getAllByText(/No anchor — counting nothing/).length).toBeGreaterThan(0);
  });

  it("makes that status a link straight to the location's own baseline setup", () => {
    draw([location({ storeCode: "306" })], true);

    const link = screen.getByRole("link", {
      name: /No anchor — counting nothing/,
    }) as HTMLAnchorElement;

    expect(link.getAttribute("href")).toBe("/reviews/setup?store=306");
  });

  it("shows the fact but not the link to somebody who cannot act on it", () => {
    draw([location()], false);

    expect(screen.getAllByText(/No anchor — counting nothing/).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: /No anchor — counting nothing/ }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /Review baselines/ })).toBeNull();
  });

  it("says 'Tracking active' once an anchor exists, and names the reviewer", () => {
    draw(
      [
        location({
          anchorReviewId: "FIXTURE-SECRET-ID-0001",
          anchorReviewer: "Marla Quist",
          reviewsThisWeek: 3,
          qualifyingThisWeek: 3,
        }),
      ],
      true,
    );

    expect(screen.getByText(/Tracking active · counting after Marla Quist/)).toBeTruthy();
    expect(screen.queryByText(/No anchor — counting nothing/)).toBeNull();
  });

  it("never puts the Google review id on the dashboard", () => {
    const { container } = draw(
      [location({ anchorReviewId: "FIXTURE-SECRET-ID-0001", anchorReviewer: "Marla Quist" })],
      true,
    );

    expect(container.innerHTML).not.toContain("FIXTURE-SECRET-ID-0001");
  });

  it("offers the setup screen from the notice that names the unanchored listings", () => {
    draw([location({ storeCode: "306", locationName: "KS Manhattan" })], true);

    const link = screen.getByRole("link", { name: /KS Manhattan \(306\)/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/reviews/setup?store=306");
    expect(
      (screen.getByRole("link", { name: /Set review baselines/ }) as HTMLAnchorElement).getAttribute(
        "href",
      ),
    ).toBe("/reviews/setup");
  });

  it("offers no control that could move an anchor from here", () => {
    /*
     * DASHBOARD FILTERING AND SYNC MUST NEVER ALTER A BOUNDARY. Everything this
     * screen draws for an anchor is an `<a href>` to a page that reads — there
     * is no form, and nothing here posts anywhere.
     */
    const { container } = draw([location(), location({ storeCode: "143" })], true);

    const setupLinks = Array.from(container.querySelectorAll("a[href*='/reviews/setup']"));
    expect(setupLinks.length).toBeGreaterThan(0);
    for (const anchorLink of setupLinks) {
      expect(anchorLink.tagName).toBe("A");
      expect(anchorLink.getAttribute("href")).toMatch(/^\/reviews\/setup(\?store=\d{3})?$/);
    }
    /* And the anchor route is not reachable from this screen at all. */
    expect(container.innerHTML).not.toContain("/api/admin/reviews/anchor");
  });
});
