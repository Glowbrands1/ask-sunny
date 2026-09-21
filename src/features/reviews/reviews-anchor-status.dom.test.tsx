// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EMPTY_REVIEW_FILTERS, type ReviewsTab } from "@/lib/reviews/filters";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";
import { EMPTY_REVIEW_TIMELINE } from "@/lib/reviews/timeline";
import type {
  LocationRollup,
  RatingDistribution,
  ReviewSummary,
} from "@/lib/reviews/types";

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
 * The ask bar and the over-time chart are stubbed: one needs the app store and
 * the other a measured viewport, and neither has anything to do with anchors.
 * The leaderboard, the baseline line and the filter bar render for real.
 */
vi.mock("./reviews-ask-bar", () => ({ ReviewsAskBar: () => null }));
vi.mock("./reviews-timeline", () => ({ ReviewsTimeline: () => null }));

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
  averageRatingThisWeek: 4.5,
  byRating: [0, 0, 2, 6, 16],
  monthToDate: 0,
  qualifyingLastWeek: 0,
  allNewLastWeek: 0,
  totalReviews: 24,
  historicalReviews: 24,
  listingsWithoutAnchor: 1,
};

/*
 * THE STAR DISTRIBUTION IS ITS OWN READ, over the review records rather than
 * over the reporting periods, so it arrives as its own prop. See
 * `loadRatingDistribution`.
 */
const ratingDistribution: RatingDistribution = {
  counts: [0, 0, 2, 6, 16],
  total: 24,
};

function snapshotWith(
  locations: LocationRollup[],
  overrides: Partial<ReviewSummary> = {},
): ReviewsSnapshot {
  return {
    empty: false,
    summary: { ...summary, ...overrides },
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

/**
 * THE LEADERBOARD IS THE DEFAULT VIEW FOR THESE TESTS, because the anchor
 * status is a fact about a salon's row and that is where it is drawn. The
 * holdings tiles are on the Overview, so those tests name that tab.
 */
function draw(
  locations: LocationRollup[],
  canManageAnchors: boolean,
  summaryOverrides: Partial<ReviewSummary> = {},
  tab: ReviewsTab = "leaderboard",
) {
  return render(
    <ReviewsScreen
      filters={{ ...EMPTY_REVIEW_FILTERS, tab }}
      snapshot={snapshotWith(locations, summaryOverrides)}
      feed={feed}
      timeline={{ ...EMPTY_REVIEW_TIMELINE, truncated: false }}
      ratingDistribution={ratingDistribution}
      openReview={null}
      canManageAnchors={canManageAnchors}
    />,
  );
}

describe("holdings and weekly counting are two different questions", () => {
  /**
   * ==========================================================================
   * A SUCCESSFUL IMPORT MUST NOT LOOK LIKE A FAILED ONE
   * ==========================================================================
   *
   * The reporting rule is right and stays exactly as it is: a review counts
   * only where its place in the feed was proven, so a first import counts
   * nothing. What that made the page say was wrong — the weekly zero led, the
   * total was a caption under Average rating, and a manager reading it after
   * syncing a hundred reviews concluded the reviews were not there.
   *
   * These tests pin the separation: EVERYTHING HELD is a headline figure with
   * its own drill-down, HISTORICAL is named as a state rather than a loss, and
   * neither is hidden behind a baseline being set.
   */
  const unanchored = location({
    anchorReviewId: null,
    anchorReviewer: null,
    historical: 24,
    total: 24,
    reviewsThisWeek: 0,
    qualifyingThisWeek: 0,
  });

  it("shows the total held as a figure of its own, not as a caption", () => {
    draw([unanchored], false, {}, "overview");

    const tile = screen.getByText("All imported reviews").closest("a, div");
    expect(tile?.textContent).toContain("24");
  });

  it("links the total to the whole feed, unfiltered by period", () => {
    draw([unanchored], false, {}, "overview");

    const link = screen
      .getByText("All imported reviews")
      .closest("a") as HTMLAnchorElement;

    const href = link.getAttribute("href") ?? "";
    /* Everything: no week, no assignment, no rating narrowing it. */
    expect(href).not.toContain("week=current");
    expect(href).not.toContain("assignment=");
    /* And it lands on the view that holds the records. */
    expect(href).toContain("tab=reviews");
    expect(href).toContain("#review-feed");
  });

  it("gives historical reviews their own figure and drill-down", () => {
    draw([unanchored], false, {}, "overview");

    const link = screen
      .getByText("Historical — not yet counted")
      .closest("a") as HTMLAnchorElement;

    expect(link.getAttribute("href")).toContain("assignment=historical");
    expect(link.textContent).toContain("24");
  });

  it("keeps the weekly figure at zero and says what it counts", () => {
    /* The rule is unchanged. Nothing counts until a baseline is set. */
    draw([unanchored], false, {}, "overview");

    const tile = screen.getByText("Qualifying reviews gained").closest("a");
    expect(tile?.textContent).toContain("0");
    expect(tile?.getAttribute("href")).toContain("assignment=counted");
  });

  it("NO LONGER OPENS THE DASHBOARD WITH A FULL-WIDTH BASELINE WARNING", () => {
    /*
     * ==========================================================================
     * THE FACT STAYED; THE BANNER DID NOT
     * ==========================================================================
     *
     * A four-sentence attention block naming fifteen salons, above every figure,
     * every day, for a configuration state only an administrator can act on, is
     * what made this dashboard unreadable. The state is unchanged, the rule is
     * unchanged, and every salon in it still says so in its own row — but the
     * view somebody lands on no longer leads with it.
     */
    draw([unanchored], true, {}, "overview");

    const page = document.body.textContent ?? "";
    expect(page).not.toContain("so weekly counting has not started");
    expect(page).not.toContain("stored and visible in the feed below");
    expect(screen.queryByRole("link", { name: /Set review baselines/ })).toBeNull();
  });

  it("still says how many salons have no baseline, in one line above the table", () => {
    draw([unanchored], false);

    const line = screen.getByText(/no baseline yet/).closest("p") as HTMLElement;
    expect(line.textContent).toContain("weekly counting has not started");
    /* And what happened to the reviews that were synced for them. */
    expect(line.textContent).toContain("held as historical");
  });

  it("offers the baseline screen from that line, to somebody who can act on it", () => {
    draw([unanchored], true);

    const link = screen.getByRole("link", {
      name: /Set review baselines/,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/reviews/setup");
  });

  it("still offers the response queue over everything held, not just this week", () => {
    /*
     * The queue is a fact about every review ASK Sunny holds, not about the
     * open week — an unanswered 1-star imported as history is still somebody
     * waiting, whatever period it counts in.
     */
    draw([unanchored], false, { unanswered: 6, criticalNeedingAttention: 2 }, "overview");

    const link = screen.getByRole("link", { name: /Open the queue/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("status=needs_response");
    expect(link.getAttribute("href")).not.toContain("week=current");
    /* And on the view that is nothing but that work. */
    expect(link.getAttribute("href")).toContain("tab=needs");
    /*
     * AND IT LANDS ON THE QUEUE RATHER THAN THE FEED. The button has to do both
     * things — narrow the page to the unanswered reviews and put the reader in
     * front of them — because a link that only scrolled would leave the filters
     * describing a different set from the one on screen.
     */
    expect(link.getAttribute("href")).toContain("#response-queue");
  });
});

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

  it("offers the setup screen from the salon's own row and from the section", () => {
    draw([location({ storeCode: "306", locationName: "KS Manhattan" })], true);

    /* The row's own marker, which is where the unexplained zero is. */
    const marker = screen.getByRole("link", {
      name: /No anchor — counting nothing/,
    }) as HTMLAnchorElement;
    expect(marker.getAttribute("href")).toBe("/reviews/setup?store=306");

    /* And the section's unobtrusive link, for somebody doing all of them. */
    const links = screen
      .getAllByRole("link", { name: /Review baselines|Set review baselines/ })
      .map((node) => node.getAttribute("href"));
    expect(links).toContain("/reviews/setup");
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
