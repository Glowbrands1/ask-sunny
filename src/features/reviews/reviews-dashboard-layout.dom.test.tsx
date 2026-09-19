// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { EMPTY_REVIEW_FILTERS, type ReviewsTab } from "@/lib/reviews/filters";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";
import { EMPTY_REVIEW_TIMELINE } from "@/lib/reviews/timeline";
import type {
  DashboardReview,
  LocationRollup,
  RatingDistribution,
  ReviewSummary,
} from "@/lib/reviews/types";

import { ReviewsScreen } from "./reviews-screen";

/**
 * ============================================================================
 * THE DASHBOARD'S SHAPE, AND THE FIGURES IT IS NOT ALLOWED TO INVENT
 * ============================================================================
 *
 * The screen was rebuilt against a design that was drawn over SEEDED DATA: a
 * combined weekly goal of 230, per-salon goals of 15 and 20, "+189 reviews
 * gained", a 4.63 average, invented customer names, and a chip reading "Not
 * connected to Google" printed as a constant.
 *
 * The layout is the deliverable. THE NUMBERS ARE NOT — every figure here comes
 * from the reviews Supabase holds, and the ones the design could not supply are
 * absent rather than approximated. These tests are where that line is kept:
 *
 *   NO GOAL EXISTS, so no meter, no percentage and no Goal column exist. A
 *   progress bar against a number nobody agreed to is a figure a manager would
 *   quote in a meeting, and it would be ours rather than the business's.
 *
 *   THE CONNECTION CHIP IS READ, NEVER ASSERTED. On a deployment that IS
 *   syncing, a hard-coded "Not connected to Google" would be the page stating
 *   the opposite of what it is showing.
 *
 *   A SLICED QUEUE SAYS IT IS SLICED. The section shows the handful waiting
 *   longest; the caption names the real unanswered total beside it, so nobody
 *   reads six cards as the whole of the work.
 *
 * Every reviewer and salon name below is invented. The store codes are real,
 * because they are printed on the storefronts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/reviews",
  useSearchParams: () => new URLSearchParams(),
}));

/* The ask bar needs the app store and the chart needs a measured viewport. */
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

/* --------------------------------------------------------------- fixtures -- */

function location(overrides: Partial<LocationRollup> = {}): LocationRollup {
  return {
    storeCode: "306",
    locationName: "KS Manhattan",
    district: "District 3",
    salonNumber: "0462",
    listingState: "verified",
    anchorReviewId: "anchor-1",
    anchorReviewer: "Tarissa Barry",
    historical: 0,
    reviewsThisWeek: 4,
    qualifyingThisWeek: 3,
    lastWeek: 2,
    unanswered: 0,
    criticalOpen: 0,
    averageRating: 4.8,
    total: 40,
    ...overrides,
  };
}

function review(overrides: Partial<DashboardReview> = {}): DashboardReview {
  return {
    id: "review-1",
    source: "google_business_profile",
    externalReviewId: "ext-1",
    storeCode: "306",
    salonNumber: "0462",
    locationName: "KS Manhattan",
    district: "District 3",
    websiteUrl: null,
    listingState: "verified",
    reviewerName: "Marguerite Ndiaye",
    rating: 2,
    reviewText: "Waited forty minutes for a bed that was already booked.",
    relativeDateText: "6 days ago",
    googleAbsoluteDate: null,
    firstSeenAt: "2026-09-17T09:00:00.000Z",
    lastSeenAt: "2026-09-17T09:00:00.000Z",
    hasOwnerResponse: false,
    ownerResponseText: null,
    ownerResponseDateText: null,
    responseStatus: "needs_response",
    eligibleForWeeklyCount: false,
    reportingPeriodId: "period-1",
    reportingAssignmentStatus: "anchor_assigned",
    periodStart: "2026-09-13",
    periodEnd: "2026-09-19",
    firstSeenWeek: "2026-09-13",
    googleEstimatedAt: null,
    parserVersion: "brave-1",
    ...overrides,
  };
}

const summary: ReviewSummary = {
  periodId: "period-1",
  weekStart: "2026-09-13",
  weekEnd: "2026-09-19",
  qualifyingThisWeek: 12,
  allNewThisWeek: 14,
  criticalNeedingAttention: 2,
  unanswered: 9,
  averageRating: 4.71,
  monthToDate: 31,
  qualifyingLastWeek: 9,
  allNewLastWeek: 11,
  totalReviews: 80,
  historicalReviews: 6,
  listingsWithoutAnchor: 0,
};

/*
 * THE STAR DISTRIBUTION IS ITS OWN READ, over the review records rather than
 * over the reporting periods, so it arrives as its own prop. See
 * `loadRatingDistribution`.
 */
const ratingDistribution: RatingDistribution = {
  counts: [1, 1, 4, 12, 62],
  total: 80,
};

function snapshotWith(
  locations: LocationRollup[],
  overrides: Partial<ReviewSummary> = {},
  snapshotOverrides: Partial<ReviewsSnapshot> = {},
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
    awaitingAnchor: [],
    weekStarts: ["2026-09-13"],
    currentWeek: "2026-09-13",
    previousWeek: "2026-09-06",
    lastSyncAt: "2026-09-17T09:00:00.000Z",
    ...snapshotOverrides,
  };
}

function draw({
  locations = [location()],
  reviews = [] as DashboardReview[],
  summaryOverrides = {} as Partial<ReviewSummary>,
  snapshotOverrides = {} as Partial<ReviewsSnapshot>,
  tab = "overview" as ReviewsTab,
  feedTotal,
  distribution = ratingDistribution,
}: {
  locations?: LocationRollup[];
  reviews?: DashboardReview[];
  summaryOverrides?: Partial<ReviewSummary>;
  snapshotOverrides?: Partial<ReviewsSnapshot>;
  tab?: ReviewsTab;
  feedTotal?: number;
  distribution?: RatingDistribution;
} = {}) {
  const total = feedTotal ?? reviews.length;
  const feed: ReviewFeed = {
    reviews,
    total,
    truncated: total > reviews.length,
  };

  return render(
    <ReviewsScreen
      filters={{ ...EMPTY_REVIEW_FILTERS, tab }}
      snapshot={snapshotWith(locations, summaryOverrides, snapshotOverrides)}
      feed={feed}
      timeline={{ ...EMPTY_REVIEW_TIMELINE, truncated: false }}
      ratingDistribution={distribution}
      openReview={null}
      canManageAnchors
    />,
  );
}

/** Where a heading sits in the rendered page, for order assertions. */
function headingOrder(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((node) => node.textContent ?? "");
}

/* ------------------------------------------------------------------ order -- */

describe("the page's shape", () => {
  it("opens on the week, then how many reviews are arriving, then the holdings", () => {
    /*
     * THE OVERVIEW IS THE WEEK AND THE VOLUME, AND NOTHING ELSE. The queue, the
     * leaderboard, the districts and the records each have a view of their own
     * now; what stayed is what a Salon Director opens the page to read — what
     * happened this week, how many reviews are coming in, and what is held.
     */
    draw();

    const order = headingOrder();
    const at = (label: string) => order.findIndex((text) => text.includes(label));

    expect(at("This week")).toBeGreaterThanOrEqual(0);
    expect(at("This week")).toBeLessThan(at("Everything ASK Sunny holds"));
  });

  it("keeps the queue, the leaderboard and the records off the Overview", () => {
    /*
     * THE WHOLE POINT OF THE RESTRUCTURE. Each of these is still on the page —
     * behind its own tab, verified below — and none of them is on the view
     * somebody lands on.
     */
    draw({ reviews: [review()] });

    const order = headingOrder();
    expect(order.some((text) => text.includes("Needs a response"))).toBe(false);
    expect(order.some((text) => text.includes("Salon leaderboard"))).toBe(false);
    expect(order.some((text) => text.includes("Google reviews"))).toBe(false);
    expect(document.getElementById("response-queue")).toBeNull();
    expect(document.getElementById("review-feed")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens on the four weekly measures the design draws", () => {
    draw();

    expect(screen.getByText("Need a response")).toBeTruthy();
    expect(screen.getByText("Qualifying reviews gained")).toBeTruthy();
    expect(screen.getByText("Average rating")).toBeTruthy();
    expect(screen.getByText("Salons needing attention")).toBeTruthy();
  });
});

/* ------------------------------------------------------- invented figures -- */

describe("the figures the design supplied and the data cannot", () => {
  it("DRAWS NO GOAL, NO METER AND NO PERCENTAGE, because no goal is stored", () => {
    const { container } = draw();

    /*
     * The seeded tile ran `gained / goal` as a bar. Nothing in Supabase holds a
     * review goal, so the bar is not drawn dim or at zero — it is absent, and
     * the tile says what the week produced instead.
     */
    expect(container.textContent).not.toContain("combined weekly goal");
    expect(container.textContent).not.toContain("% of goal");
    expect(container.querySelector(".bg-measure-benchmark")).toBeNull();
  });

  it("gives the leaderboard no Goal column and no progress column", () => {
    draw({ tab: "leaderboard" });

    const headers = screen
      .getAllByRole("columnheader")
      .map((node) => (node.textContent ?? "").replace(/[↕▲▼]/g, "").trim());
    expect(headers).not.toContain("Goal");
    expect(headers).not.toContain("Progress");
  });

  it("says out loud that the goal column is missing on purpose", () => {
    /*
     * REMOVING IT SILENTLY WOULD LEAVE A READER WONDERING WHERE IT WENT. The
     * seeded leaderboard had one; anybody who saw that screen needs to be told
     * the column is gone because the number was never real, not because the
     * page is broken.
     */
    draw({ tab: "leaderboard" });

    const note = screen.getByText(/no goal column/i);
    expect(note.textContent).toContain("no weekly review goal is configured");
  });

  it("never prints the connection chip as a constant", () => {
    /*
     * "Not connected to Google" was a literal in the seeded screen. Here the
     * chip reports what this deployment actually recorded.
     */
    const { container } = draw();
    expect(container.textContent).not.toContain("Not connected to Google");
    expect(container.textContent).toContain("Last sync");
  });

  it("says there is no sync only when there is none", () => {
    draw({ snapshotOverrides: { lastSyncAt: null } });

    expect(screen.getByText("No sync recorded yet")).toBeTruthy();
  });
});

/* --------------------------------------------------- salons needing help -- */

describe("salons needing attention", () => {
  const healthy = location({ storeCode: "140", locationName: "MO Wornall" });
  const critical = location({
    storeCode: "145",
    locationName: "NE Lincoln O Street",
    criticalOpen: 2,
    unanswered: 3,
    averageRating: 4.9,
  });
  const lowRated = location({
    storeCode: "254",
    locationName: "NE Omaha Pacific",
    averageRating: 4.1,
  });

  it("counts a salon for an open 1- or 2-star review OR a low average", () => {
    draw({ locations: [healthy, critical, lowRated] });

    const tile = screen.getByText("Salons needing attention").closest("div") as HTMLElement;
    expect(within(tile).getByText("2")).toBeTruthy();
  });

  it("LISTS EVERY SALON IT COUNTS, so the figure and the rows cannot disagree", () => {
    /*
     * The seeded tile counted every salon and listed the first three. That is
     * the one contradiction a reader will always find, because they count the
     * rows.
     */
    draw({ locations: [healthy, critical, lowRated] });

    const tile = screen.getByText("Salons needing attention").closest("div") as HTMLElement;
    const rows = within(tile).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(tile.textContent).toContain("NE Lincoln O Street");
    expect(tile.textContent).toContain("NE Omaha Pacific");
    expect(tile.textContent).not.toContain("MO Wornall");
  });

  it("says so plainly when no salon qualifies", () => {
    draw({ locations: [healthy] });

    const tile = screen.getByText("Salons needing attention").closest("div") as HTMLElement;
    expect(tile.textContent).toContain("No salon has an open 1- or 2-star review");
  });
});

/* ------------------------------------------------------------- the queue -- */

describe("the response queue", () => {
  const waiting = Array.from({ length: 9 }, (_, index) =>
    review({
      id: `review-${index}`,
      externalReviewId: `ext-${index}`,
      reviewerName: `Customer ${index}`,
      rating: index < 2 ? 1 : 3,
    }),
  );

  it("holds the whole queue now that it has a view of its own", () => {
    /*
     * IT USED TO SHOW SIX OF NINE AND SAY SO, because a dashboard that long
     * could not carry the rest. With its own tab it carries all of them, in the
     * same order, decided by the same response status — and the caption states
     * the count rather than a slice of it.
     */
    draw({ tab: "needs", reviews: waiting });

    const queue = document.getElementById("response-queue") as HTMLElement;
    expect(within(queue).getAllByRole("article")).toHaveLength(9);

    expect(screen.getByText(/9 reviews need a response/)).toBeTruthy();
  });

  it("says what the server could not send rather than implying it holds it all", () => {
    /* The feed read is bounded. When it caps, the caption names both figures. */
    draw({ tab: "needs", reviews: waiting, feedTotal: 140 });

    expect(screen.getByText(/140 reviews need a response/)).toBeTruthy();
    expect(screen.getByText(/The first 9 are loaded/)).toBeTruthy();
  });

  it("USES GOOGLE'S OWN WORDING FOR THE WAIT, not the date we first saw it", () => {
    /*
     * `first_seen_at` is when ASK Sunny imported the review, not when the
     * customer wrote it. Printing it as an age would have the page assert a
     * review date it does not have — so Google's relative text is carried
     * verbatim when Google gave one.
     */
    draw({ tab: "needs", reviews: [review({ relativeDateText: "6 days ago" })] });

    const queue = document.getElementById("response-queue") as HTMLElement;
    expect(queue.textContent).toContain("6 days ago");
    expect(queue.textContent).not.toContain("First seen");
  });

  it("labels first-seen as first-seen when Google gave no date at all", () => {
    draw({
      tab: "needs",
      reviews: [
        review({
          relativeDateText: null,
          googleAbsoluteDate: null,
          googleEstimatedAt: null,
        }),
      ],
    });

    const queue = document.getElementById("response-queue") as HTMLElement;
    expect(queue.textContent).toContain("First seen");
  });

  it("keeps the anchor reachable when the filters leave the queue empty", () => {
    /* The alarm tile links here whether or not anything matches. */
    draw({ tab: "needs", reviews: [], summaryOverrides: { unanswered: 4 } });

    const empty = document.getElementById("response-queue") as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain("No unanswered review matches");
  });
});

/* -------------------------------------------------------- the alarm tile -- */

describe("the one coral tile", () => {
  it("names the oldest waiting review from the records, not an example", () => {
    draw({
      reviews: [review({ rating: 2, relativeDateText: "6 days ago" })],
    });

    const tile = screen.getByText("Need a response").closest("div") as HTMLElement;
    expect(tile.textContent).toContain("Oldest is a 2-star");
    expect(tile.textContent).toContain("6 days ago");
  });

  it("says the queue is clear rather than inventing an oldest", () => {
    draw({ reviews: [], summaryOverrides: { unanswered: 0 } });

    const tile = screen.getByText("Need a response").closest("div") as HTMLElement;
    expect(tile.textContent).toContain("Every review in view has a reply");
  });
});

/* ---------------------------------------------------- the weekly measures -- */

describe("the weekly measures", () => {
  it("reports the qualifying count and what else the week brought", () => {
    draw();

    const tile = screen.getByText("Qualifying reviews gained").closest("a") as HTMLElement;
    expect(tile.textContent).toContain("12");
    expect(tile.textContent).toContain("+3 versus last week");
    /* 14 arrived, 12 qualify, so 2 raise nothing — arithmetic, not a guess. */
    expect(tile.textContent).toContain("2 of them are 1- or 2-star");
  });

  it("draws the average from every review held and shows its stars", () => {
    draw();

    const tile = screen.getByText("Average rating").closest("div") as HTMLElement;
    expect(tile.textContent).toContain("4.71");
    expect(tile.textContent).toContain("80 reviews held");
  });

  it("prints an em dash rather than a zero when nothing has been rated", () => {
    draw({ summaryOverrides: { averageRating: null, totalReviews: 0 } });

    const tile = screen.getByText("Average rating").closest("div") as HTMLElement;
    expect(tile.textContent).toContain("—");
  });
});

/* ------------------------------------------------- the rating distribution -- */

/**
 * ============================================================================
 * "REVIEWS BY RATING" DESCRIBES THE REVIEWS, NOT THE WEEKS THEY COUNTED IN
 * ============================================================================
 *
 * It shipped summed from the reporting-period rollup, which holds nothing until
 * a listing has a baseline — so the card drew five zeroes beside a chart
 * plotting hundreds of real reviews. It now reads the review records, arrives
 * as its own prop, and these tests pin the three things that went wrong:
 *
 *   THE BARS ADD UP TO THE HEADING. The total is derived from the buckets, so
 *   the two cannot describe different sets of reviews.
 *
 *   EVERY STORED REVIEW IS IN A BUCKET, whatever it does to a weekly total.
 *
 *   THE CAPTION NO LONGER EXPLAINS A WEEKLY RULE, because this card does not
 *   draw one.
 */

function ratingCard(): HTMLElement {
  return screen.getByText(/^Reviews by rating/).closest("div") as HTMLElement;
}

function barRow(rating: number): HTMLElement {
  return screen.getByText(`${rating}★`).closest("a") as HTMLElement;
}

describe("the rating distribution", () => {
  /* Three 5-star, two 4-star, one 3-star, two 2-star, one 1-star: nine reviews. */
  const NINE: RatingDistribution = { counts: [1, 2, 1, 2, 3], total: 9 };

  it("counts every synced review, whatever it does to a weekly total", () => {
    draw({ distribution: NINE });

    expect(barRow(5).textContent).toContain("3");
    expect(barRow(4).textContent).toContain("2");
    expect(barRow(3).textContent).toContain("1");
    expect(barRow(2).textContent).toContain("2");
    expect(barRow(1).textContent).toContain("1");
  });

  it("heads the card with the total the five bars add up to", () => {
    draw({ distribution: NINE });

    expect(ratingCard().textContent).toContain("Reviews by rating · 9 reviews");
    expect(NINE.counts.reduce((running, count) => running + count, 0)).toBe(NINE.total);
  });

  it("prints each bucket's share of that total", () => {
    draw({ distribution: NINE });

    /* 3/9 = 33%, 2/9 = 22%, 1/9 = 11%. */
    expect(barRow(5).textContent).toContain("33%");
    expect(barRow(4).textContent).toContain("22%");
    expect(barRow(1).textContent).toContain("11%");
  });

  it("draws each bar against the largest bucket, so the shape is readable", () => {
    draw({ distribution: NINE });

    const width = (rating: number) =>
      (barRow(rating).querySelector("span[style]") as HTMLElement).style.width;

    expect(width(5)).toBe("100%");
    /* Two of a largest bucket of three. */
    expect(width(4)).toBe(`${(2 / 3) * 100}%`);
  });

  it("does not shrink to the reviews a reporting period admitted", () => {
    /*
     * THE REGRESSION ITSELF. `summary` describes one week and a small backlog;
     * the card is handed the whole estate, and must print the estate.
     */
    draw({
      distribution: { counts: [4, 6, 20, 90, 320], total: 440 },
      summaryOverrides: { qualifyingThisWeek: 0, allNewThisWeek: 0 },
    });

    expect(ratingCard().textContent).toContain("440 reviews");
    expect(barRow(5).textContent).toContain("320");
  });

  it("says nothing about the weekly count in its caption", () => {
    draw({ distribution: NINE });

    expect(ratingCard().textContent).toContain(
      "Distribution of synced Google reviews for the selected filters.",
    );
    expect(ratingCard().textContent).not.toContain("coral");
    expect(ratingCard().textContent).not.toContain("never raise the official");
  });

  it("gives every bar the one data fill, with no weekly split drawn in colour", () => {
    draw({ distribution: NINE });

    for (const rating of [5, 4, 3, 2, 1]) {
      const fill = barRow(rating).querySelector("span[style]") as HTMLElement;
      expect(fill.className).toContain("bg-measure-data");
      expect(fill.className).not.toContain("bg-status-under");
    }
  });

  it("prints zeroes honestly when the estate really holds nothing", () => {
    draw({ distribution: { counts: [0, 0, 0, 0, 0], total: 0 } });

    expect(ratingCard().textContent).toContain("Reviews by rating · 0 reviews");
    expect(barRow(5).textContent).toContain("0%");
  });

  it("carries the filters in force into each bar's drill-down", () => {
    draw({ distribution: NINE });

    expect((barRow(5) as HTMLAnchorElement).getAttribute("href")).toContain("rating=5");
    expect((barRow(1) as HTMLAnchorElement).getAttribute("href")).toContain("rating=1");
  });
});
