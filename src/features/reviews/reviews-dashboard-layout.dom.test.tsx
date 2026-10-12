// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EMPTY_REVIEW_FILTERS, type ReviewsTab } from "@/lib/reviews/filters";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";
import { goalContext } from "@/lib/reviews/goal";
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
    qualifyingLastWeek: 2,
    qualifyingMonthToDate: 6,
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
  averageRatingThisWeek: 4.5,
  byRating: [1, 1, 4, 12, 62],
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
    goal: goalContext("2026-09-17", 10),
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
  it("opens on the month's goal, then how many reviews are arriving, then the holdings", () => {
    /*
     * THE OVERVIEW LEADS WITH THE MONTHLY GOAL, at Madeline Patterson's request:
     * qualifying reviews this week and month to date, against ten per salon.
     * The volume chart and what ASK Sunny holds follow, as before.
     */
    draw();

    const order = headingOrder();
    const at = (label: string) => order.findIndex((text) => text.includes(label));

    expect(at("September review goal")).toBeGreaterThanOrEqual(0);
    expect(at("September review goal")).toBeLessThan(at("Everything ASK Sunny holds"));
  });

  it("keeps the queue, the ranked leaderboard and the records off the Overview", () => {
    draw({ reviews: [review()] });

    const order = headingOrder();
    expect(order.some((text) => text.includes("Needs a response"))).toBe(false);
    expect(order.some((text) => text.includes("Salon leaderboard"))).toBe(false);
    expect(order.some((text) => text.includes("Google reviews"))).toBe(false);
    expect(document.getElementById("response-queue")).toBeNull();
    expect(document.getElementById("review-feed")).toBeNull();
    expect(screen.queryByRole("list", { name: /Salons ranked/ })).toBeNull();
  });

  it("opens on the four goal measures the approved design draws", () => {
    draw({ locations: [location(), location({ storeCode: "307", locationName: "NE Grand Island" })] });

    expect(screen.getAllByText("Qualifying reviews")).toHaveLength(2);
    expect(screen.getByText("Salons at goal")).toBeTruthy();
    expect(screen.getByText("Reviews still needed")).toBeTruthy();
  });

  it("tells the week and the month apart in words on every goal figure", () => {
    const { container } = draw();

    expect(container.textContent).toContain("This week · Sep 13 – Sep 19");
    expect(container.textContent).toContain("Month to date · Sep 1 – Sep 17");
  });
});

/* ---------------------------------------------- what Madeline asked for -- */

describe("the reporting views, as Madeline Patterson asked for them", () => {
  it("DRAWS THE MONTHLY TARGET THE BUSINESS SET, against every salon", () => {
    draw();

    const headers = screen
      .getAllByRole("columnheader")
      .map((node) => (node.textContent ?? "").replace(/[↕▲▼]/g, "").trim());
    expect(headers).toContain("Monthly target");
    expect(headers.some((text) => text.startsWith("Progress toward target"))).toBe(true);
  });

  it("removes Unanswered, Replies waiting, All this week and Last week from the Overview", () => {
    const { container } = draw({
      locations: [location({ unanswered: 4, criticalOpen: 1 })],
      summaryOverrides: { unanswered: 4 },
    });

    const headers = screen
      .getAllByRole("columnheader")
      .map((node) => (node.textContent ?? "").replace(/[↕▲▼]/g, "").trim().toLowerCase());
    for (const removed of ["unanswered", "all this week", "last week"]) {
      expect(headers.some((text) => text.startsWith(removed)), removed).toBe(false);
    }
    /* The old status chip, its alarm tile and its attention tile are gone. */
    expect(container.textContent).not.toContain("Replies waiting");
    expect(container.textContent).not.toContain("Need a response");
    expect(container.textContent).not.toContain("Salons needing attention");
    expect(screen.queryByRole("link", { name: /Open the queue/ })).toBeNull();
  });

  it("removes them from the leaderboard too", () => {
    const { container } = draw({
      tab: "leaderboard",
      locations: [location({ unanswered: 4 })],
    });

    expect(container.textContent).not.toContain("Unanswered");
    expect(container.textContent).not.toContain("Replies waiting");
    expect(container.textContent).not.toContain("All this week");
    expect(container.textContent).not.toMatch(/\bLast week\b/);
  });

  it("HAS NO NEEDS RESPONSE TAB, removed at the business's request", () => {
    draw({ summaryOverrides: { unanswered: 9 } });

    expect(screen.queryByRole("link", { name: /Needs Response/ })).toBeNull();
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

  it("reads the sync stamp in Central, not in the host container's zone", () => {
    /*
     * THE CHIP ONCE SHOWED A SYNC FROM THE FUTURE. `toLocaleString()` with no
     * zone renders in the host's, and this screen is a server component on a
     * UTC container — so a 9am Central sync was published as 2pm. The fixture
     * instant is 09:00 UTC, which is 4:00 in the morning Central.
     */
    const { container } = draw();
    expect(container.textContent).toContain("Last sync 9/17/2026, 4:00:00 AM CDT");
    expect(container.textContent).not.toContain("9:00:00 AM");
  });

  it("says there is no sync only when there is none", () => {
    draw({ snapshotOverrides: { lastSyncAt: null } });

    expect(screen.getByText("No sync recorded yet")).toBeTruthy();
  });

  it("names the month-to-date window in the band", () => {
    const { container } = draw();
    expect(container.textContent).toContain("Month to date Sep 1 – Sep 17");
  });
});

/* ------------------------------------------------------- the goal tiles -- */

describe("the goal tiles", () => {
  /* 17 September: 16 of 30 days finished, so the pace mark is ceil(5.33) = 6. */
  const salons = [
    location({
      storeCode: "306",
      locationName: "KS Manhattan",
      qualifyingThisWeek: 4,
      qualifyingLastWeek: 2,
      qualifyingMonthToDate: 12,
    }),
    location({
      storeCode: "307",
      locationName: "NE Grand Island",
      qualifyingThisWeek: 2,
      qualifyingLastWeek: 1,
      qualifyingMonthToDate: 10,
    }),
    location({
      storeCode: "309",
      locationName: "NE Kearney",
      qualifyingThisWeek: 1,
      qualifyingLastWeek: 1,
      qualifyingMonthToDate: 3,
    }),
    location({
      storeCode: "495",
      locationName: "MO St Joseph",
      anchorReviewId: null,
      anchorReviewer: null,
      qualifyingThisWeek: 5,
      qualifyingLastWeek: 5,
      qualifyingMonthToDate: 9,
    }),
  ];

  /* The tag also heads a table column, so the tile is the one inside a link. */
  function tile(tag: RegExp): HTMLElement {
    return screen
      .getAllByText(tag)
      .map((node) => node.closest("a"))
      .find((node): node is HTMLAnchorElement => node !== null) as HTMLElement;
  }

  it("sums the week over the salons that are counting, and compares like with like", () => {
    draw({ locations: salons });

    const week = tile(/^This week · /);
    /* 4 + 2 + 1, with St Joseph's 5 left out: it has no baseline. */
    expect(week.textContent).toContain("7");
    expect(week.textContent).toContain("+3 versus last week");
    expect(week.getAttribute("href")).toContain("week=current");
    expect(week.getAttribute("href")).toContain("qualifying=yes");
  });

  it("sums the month over the counting salons, against their combined target", () => {
    draw({ locations: salons });

    const month = tile(/^Month to date · /);
    expect(month.textContent).toContain("25");
    expect(month.textContent).toContain("/ 30");
    expect(month.textContent).toContain("× 3 counting");
    /* Its drill-down is the month-to-date predicate, not "all counted". */
    expect(month.getAttribute("href")).toContain("week=month");
    expect(month.getAttribute("href")).toContain("qualifying=yes");
  });

  it("counts the salons at goal — exactly ten counts, and so does more", () => {
    draw({ locations: salons });

    const atGoal = screen.getByText("Salons at goal").closest("a") as HTMLElement;
    expect(atGoal.textContent).toContain("2");
    expect(atGoal.textContent).toContain("of 3");
    expect(atGoal.getAttribute("href")).toContain("tab=leaderboard");
  });

  it("adds up each salon's own shortfall, not the estate's", () => {
    draw({ locations: salons });

    const needed = screen.getByText("Reviews still needed").closest("div") as HTMLElement;
    /* Kearney's 7. Manhattan's two over do not cover it. */
    expect(needed.textContent).toContain("7");
  });

  it("speaks about one salon when the page is narrowed to one", () => {
    draw({ locations: [salons[2]] });

    expect(screen.getByText("Monthly goal")).toBeTruthy();
    const goal = screen.getByText("Monthly goal").closest("a") as HTMLElement;
    expect(goal.textContent).toContain("3");
    expect(goal.textContent).toContain("/ 10");
  });

  it("prints zeroes, not an error, when no salon is counting yet", () => {
    draw({ locations: [salons[3]] });

    const month = tile(/^Month to date · /);
    expect(month.textContent).toContain("0");
    expect(month.textContent).toContain("nothing is being counted");
  });
});

/* ------------------------------------------------------------ the holdings -- */

describe("the average rating, now among the holdings", () => {
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

  it("no longer carries the old month tile, which summed every review by week", () => {
    const { container } = draw();
    expect(container.textContent).not.toContain(
      "Counted across the reporting weeks that began this month",
    );
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

  it("keeps the fills it always had, decided by the star and nothing else", () => {
    /*
     * THE COLOURS ARE UNCHANGED BY THIS CORRECTION. The split is `rating >= 3`
     * in the component — it reads no baseline, no anchor and no reporting
     * period — so it is not one of the signals the distribution had to stop
     * consulting, and restyling it was never what the copy fix asked for.
     */
    draw({ distribution: NINE });

    for (const rating of [5, 4, 3]) {
      const fill = barRow(rating).querySelector("span[style]") as HTMLElement;
      expect(fill.className).toContain("bg-measure-data");
    }
    for (const rating of [2, 1]) {
      const fill = barRow(rating).querySelector("span[style]") as HTMLElement;
      expect(fill.className).toContain("bg-status-under");
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
