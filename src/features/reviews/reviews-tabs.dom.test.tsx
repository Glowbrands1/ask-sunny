// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { EMPTY_REVIEW_FILTERS, type ReviewsTab } from "@/lib/reviews/filters";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";
import { goalContext } from "@/lib/reviews/goal";
import { EMPTY_REVIEW_TIMELINE, type ReviewTimeline } from "@/lib/reviews/timeline";
import type {
  DashboardReview,
  LocationRollup,
  RatingDistribution,
  ReviewSummary,
} from "@/lib/reviews/types";

import { ReviewsScreen } from "./reviews-screen";

/**
 * ============================================================================
 * FOUR VIEWS OVER ONE SET OF FIGURES
 * ============================================================================
 *
 * The dashboard carried every section on one scroll and nobody could find any
 * of them. These tests pin what the rearrangement is allowed to be:
 *
 *   A VIEW IS A URL. Each tab is an ordinary link carrying the filters in
 *   force, so a narrowed view is something a DM can be sent and Back works.
 *
 *   A SECTION LIVES IN EXACTLY ONE VIEW. The queue, the leaderboard and the
 *   records are each in one place; the Overview is none of them.
 *
 *   NOTHING WAS RECOMPUTED ON THE WAY. Every figure these views draw arrives
 *   from the read layer. The tab count, the queue length and the feed total all
 *   read what the server sent.
 *
 *   A LIST IS REVEALED, NOT DUMPED. Twenty records, then twenty more, over the
 *   page the server already delivered.
 *
 * Every reviewer and salon name below is invented. The store codes are real,
 * because they are printed on the storefronts.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/reviews",
  useSearchParams: () => new URLSearchParams(),
}));

/* The ask bar needs the app store; the chart needs a measured viewport. */
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
  unanswered: 21,
  averageRating: 4.71,
  averageRatingThisWeek: 4.5,
  byRating: [1, 1, 4, 12, 62],
  monthToDate: 31,
  qualifyingLastWeek: 9,
  allNewLastWeek: 11,
  totalReviews: 86,
  historicalReviews: 86,
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
  overrides: Partial<ReviewsSnapshot> = {},
): ReviewsSnapshot {
  return {
    empty: false,
    summary,
    trend: [],
    locations,
    districts: [],
    districtOptions: ["District 3", "District 5"],
    locationOptions: locations.map((entry) => ({
      storeCode: entry.storeCode,
      label: entry.locationName,
      district: entry.district,
    })),
    verificationRequired: [],
    awaitingAnchor: [],
    weekStarts: ["2026-09-06", "2026-09-13"],
    currentWeek: "2026-09-13",
    previousWeek: "2026-09-06",
    lastSyncAt: "2026-09-17T09:00:00.000Z",
    goal: goalContext("2026-09-17", 10),
    ...overrides,
  };
}

function draw({
  tab = "overview" as ReviewsTab,
  locations = [location(), location({ storeCode: "314", locationName: "KS Lawrence" })],
  reviews = [] as DashboardReview[],
  feedTotal,
  timeline = { ...EMPTY_REVIEW_TIMELINE, truncated: false } as ReviewTimeline & {
    truncated: boolean;
  },
  filterOverrides = {},
  snapshotOverrides = {},
}: {
  tab?: ReviewsTab;
  locations?: LocationRollup[];
  reviews?: DashboardReview[];
  feedTotal?: number;
  timeline?: ReviewTimeline & { truncated: boolean };
  filterOverrides?: Partial<typeof EMPTY_REVIEW_FILTERS>;
  snapshotOverrides?: Partial<ReviewsSnapshot>;
} = {}) {
  const total = feedTotal ?? reviews.length;
  const feed: ReviewFeed = { reviews, total, truncated: total > reviews.length };

  return render(
    <ReviewsScreen
      filters={{ ...EMPTY_REVIEW_FILTERS, tab, ...filterOverrides }}
      snapshot={snapshotWith(locations, snapshotOverrides)}
      feed={feed}
      timeline={timeline}
      ratingDistribution={ratingDistribution}
      openReview={null}
      canManageAnchors
    />,
  );
}

function tabStrip(): HTMLElement {
  return screen.getByRole("navigation", { name: "Google Reviews views" });
}

function tabLink(name: RegExp): HTMLAnchorElement {
  return within(tabStrip()).getByRole("link", { name }) as HTMLAnchorElement;
}

/* -------------------------------------------------------------- the strip -- */

describe("the tab strip", () => {
  it("offers the four views", () => {
    draw();

    const labels = within(tabStrip())
      .getAllByRole("link")
      .map((node) => (node.textContent ?? "").trim());

    expect(labels[0]).toBe("Overview");
    expect(labels[1]).toBe("Google Reviews");
    expect(labels[2]).toContain("Needs Response");
    expect(labels[3]).toBe("Salon Leaderboard");
  });

  it("marks the open view with aria-current rather than with a class alone", () => {
    draw({ tab: "reviews" });

    expect(tabLink(/^Google Reviews$/).getAttribute("aria-current")).toBe("page");
    expect(tabLink(/^Overview$/).getAttribute("aria-current")).toBeNull();
  });

  it("prints the unanswered count the summary reports, not a recount", () => {
    draw();

    expect(tabLink(/Needs Response/).textContent).toContain("(21)");
  });

  it("is ordinary links, so a view is something somebody can send", () => {
    draw();

    expect(tabLink(/^Overview$/).getAttribute("href")).toBe("/reviews");
    expect(tabLink(/^Google Reviews$/).getAttribute("href")).toBe("/reviews?tab=reviews");
    expect(tabLink(/Needs Response/).getAttribute("href")).toBe("/reviews?tab=needs");
    expect(tabLink(/^Salon Leaderboard$/).getAttribute("href")).toBe(
      "/reviews?tab=leaderboard",
    );
  });

  it("carries the filters in force from one view to the next", () => {
    /*
     * NARROWING TO ONE SALON ON THE CHART AND THEN OPENING THE RECORDS SHOWS
     * THAT SALON'S RECORDS. A tab that reset the page to the whole estate would
     * make the two views describe different things without saying so.
     */
    draw({ filterOverrides: { storeCode: "314", rating: "2" } });

    const href = tabLink(/^Google Reviews$/).getAttribute("href") ?? "";
    expect(href).toContain("tab=reviews");
    expect(href).toContain("store=314");
    expect(href).toContain("rating=2");
  });

  it("does not carry an open review's detail panel onto another view", () => {
    draw({ filterOverrides: { openReviewId: "11111111-2222-3333-4444-555555555555" } });

    expect(tabLink(/^Salon Leaderboard$/).getAttribute("href")).not.toContain("review=");
  });
});

/* ------------------------------------------------------ one section, one view */

describe("each section lives in exactly one view", () => {
  it("puts the records in Google Reviews and nowhere else", () => {
    draw({ tab: "reviews", reviews: [review()] });

    expect(document.getElementById("review-feed")).toBeTruthy();
    expect(document.getElementById("response-queue")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("puts the queue in Needs Response and nowhere else", () => {
    draw({ tab: "needs", reviews: [review()] });

    expect(document.getElementById("response-queue")).toBeTruthy();
    expect(document.getElementById("review-feed")).toBeNull();
  });

  it("puts the ranked leaderboard in Salon Leaderboard and nowhere else", () => {
    draw({ tab: "leaderboard" });

    const list = screen.getByRole("list", { name: /Salons ranked/ });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(document.getElementById("review-feed")).toBeNull();
    expect(document.getElementById("response-queue")).toBeNull();

    cleanup();
    for (const tab of ["overview", "reviews", "needs"] as const) {
      draw({ tab, reviews: [review()] });
      expect(screen.queryByRole("list", { name: /Salons ranked/ }), tab).toBeNull();
      cleanup();
    }
  });

  it("DRAWS NO TWELVE-WEEK REPORTING CHART, on any view", () => {
    /*
     * ========================================================================
     * THE CHART THAT COULD ONLY EVER DRAW WHAT HAD BEEN COUNTED
     * ========================================================================
     *
     * "Reviews by week, twelve weeks" read the reporting periods, so a salon
     * with no baseline contributed nothing to it — correctly, and by design.
     * What that produced on screen was twelve empty columns occupying a screen
     * of the dashboard, and the question it existed to answer is now answered
     * from the records by Google Reviews Over Time.
     *
     * THE ARITHMETIC IS UNTOUCHED and is still tested in `aggregate.test.ts`:
     * `weeklyTrend()` runs, `snapshot.trend` is still returned, and this
     * fixture still carries twelve populated weeks. The assertion is only that
     * nothing draws them — which is what stops the section reappearing by
     * reflex the next time somebody has trend data in hand.
     */
    const trend = Array.from({ length: 12 }, (_, index) => ({
      weekStart: `2026-0${index < 3 ? 7 : 9}-0${(index % 4) + 1}`,
      label: `Week ${index + 1}`,
      all: 6,
      qualifying: 4,
      critical: 2,
      unanswered: 1,
    }));

    for (const tab of ["overview", "reviews", "needs", "leaderboard"] as ReviewsTab[]) {
      cleanup();
      draw({ tab, snapshotOverrides: { trend } });

      const page = document.body.textContent ?? "";
      expect(page, tab).not.toContain("Twelve weeks");
      expect(page, tab).not.toContain("Reviews by week");
      expect(page, tab).not.toContain("Counts toward weekly total");
    }
  });
});

/* ------------------------------------------------------------- the filters -- */

describe("the filter toolbar", () => {
  it("leads with location and rating on every view that lists reviews", () => {
    for (const tab of ["overview", "reviews", "needs"] as ReviewsTab[]) {
      cleanup();
      draw({ tab });
      expect(screen.getByLabelText("Location")).toBeTruthy();
      expect(screen.getByLabelText("Rating")).toBeTruthy();
    }
  });

  it("builds the location options from the salons in the data, not a constant", () => {
    draw({ tab: "reviews" });

    const select = screen.getByLabelText("Location") as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);

    expect(options[0]).toBe("All locations");
    expect(options).toContain("KS Manhattan · 306");
    expect(options).toContain("KS Lawrence · 314");
  });

  it("offers each star rating on its own, as well as the grouped drill-downs", () => {
    draw({ tab: "reviews" });

    const select = screen.getByLabelText("Rating") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);

    expect(values).toEqual(
      expect.arrayContaining(["all", "1", "2", "3", "4", "5", "1-2", "3-5"]),
    );
  });

  it("adds the response-status filter where the records are listed", () => {
    draw({ tab: "reviews" });
    expect(screen.getByLabelText("Response")).toBeTruthy();

    cleanup();
    draw({ tab: "overview" });
    expect(screen.queryByLabelText("Response")).toBeNull();
  });

  it("writes the filter into the URL and keeps the reader on their view", () => {
    push.mockClear();
    draw({ tab: "reviews" });

    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "314" } });

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("tab=reviews");
    expect(href).toContain("store=314");
  });

  it("combines location and rating rather than replacing one with the other", () => {
    push.mockClear();
    draw({ tab: "reviews", filterOverrides: { storeCode: "314" } });

    fireEvent.change(screen.getByLabelText("Rating"), { target: { value: "2" } });

    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("store=314");
    expect(href).toContain("rating=2");
  });

  it("shows a filter that is in force even on a view that does not lead with it", () => {
    /*
     * Somebody arriving from "Historical — not yet counted" is looking at a
     * narrowed page. The control that narrowed it has to be on screen and has
     * to be clearable, or the page is quietly lying about what it is showing.
     */
    draw({ tab: "overview", filterOverrides: { assignment: "historical" } });

    expect(screen.getByLabelText("Reporting")).toBeTruthy();
  });

  it("keeps the rest of the filters one press away rather than removing them", () => {
    draw({ tab: "overview" });

    expect(screen.queryByLabelText("Week")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));

    expect(screen.getByLabelText("Week")).toBeTruthy();
    expect(screen.getByLabelText("Reporting")).toBeTruthy();
    expect(screen.getByLabelText("Weekly total")).toBeTruthy();
  });

  it("resets the filters without throwing the reader off their view", () => {
    push.mockClear();
    draw({ tab: "reviews", filterOverrides: { storeCode: "314" } });

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));

    expect(push).toHaveBeenCalledWith("/reviews?tab=reviews");
  });
});

/* ---------------------------------------------------------- load more ----- */

function manyReviews(count: number): DashboardReview[] {
  return Array.from({ length: count }, (_, index) =>
    review({
      id: `review-${index}`,
      externalReviewId: `ext-${index}`,
      reviewerName: `Customer ${index}`,
      rating: (index % 5) + 1,
      responseStatus: index % 2 === 0 ? "needs_response" : "responded",
    }),
  );
}

describe("the record lists reveal rather than dumping", () => {
  it("shows twenty reviews and offers the rest", () => {
    draw({ tab: "reviews", reviews: manyReviews(45) });

    const feed = document.getElementById("review-feed") as HTMLElement;
    expect(within(feed).getAllByRole("article")).toHaveLength(20);
    expect(screen.getByText(/Showing 20 of 45 reviews/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("reveals another twenty on each press, and stops offering at the end", () => {
    draw({ tab: "reviews", reviews: manyReviews(45) });

    const feed = document.getElementById("review-feed") as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(within(feed).getAllByRole("article")).toHaveLength(40);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(within(feed).getAllByRole("article")).toHaveLength(45);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("names what the server did not send rather than implying it has it all", () => {
    /* The feed read is bounded at a hundred. Saying "20 of 100" on an estate
       holding four hundred matches would be the page misreporting itself. */
    draw({ tab: "reviews", reviews: manyReviews(100), feedTotal: 412 });

    expect(screen.getByText(/Showing 20 of 100 reviews loaded, from 412 matching/)).toBeTruthy();
  });

  it("reveals the response queue the same way", () => {
    draw({ tab: "needs", reviews: manyReviews(30) });

    const queue = document.getElementById("response-queue") as HTMLElement;
    expect(within(queue).getAllByRole("article")).toHaveLength(20);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(within(queue).getAllByRole("article")).toHaveLength(30);
  });

  it("keeps Draft a reply on every unanswered record it draws", () => {
    /* The reply workflow is untouched: the same link to the same chat path. */
    draw({ tab: "reviews", reviews: [review({ responseStatus: "needs_response" })] });

    const link = screen.getByRole("link", { name: /Draft a reply/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("/chat?q=");
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(
      "Marguerite Ndiaye",
    );
  });
});

/* ------------------------------------------------------ the goal table -- */

describe("the Overview's goal table and its own controls", () => {
  const rows = [
    location({
      storeCode: "306",
      locationName: "KS Manhattan",
      qualifyingThisWeek: 3,
      qualifyingMonthToDate: 4,
      averageRating: 4.9,
    }),
    location({
      storeCode: "314",
      locationName: "KS Lawrence",
      district: "District 5",
      qualifyingThisWeek: 2,
      qualifyingMonthToDate: 12,
      unanswered: 4,
      averageRating: 4.2,
      historical: 7,
      total: 31,
    }),
  ];

  function goalTable(): HTMLElement {
    return screen.getByRole("table", { name: "Salon goal progress" });
  }

  function salonOrder(): string[] {
    const body = goalTable().querySelector("tbody") as HTMLElement;
    return within(body)
      .getAllByRole("row")
      .map((row) => (row.querySelector("a")?.textContent ?? "").trim());
  }

  it("opens ordered by qualifying reviews month to date", () => {
    draw({ tab: "overview", locations: rows });

    expect(salonOrder()).toEqual(["KS Lawrence", "KS Manhattan"]);
    expect(
      within(goalTable())
        .getByRole("columnheader", { name: /Month to date/ })
        .getAttribute("aria-sort"),
    ).toBe("descending");
  });

  it("finds a salon by name, store code or district", () => {
    draw({ tab: "overview", locations: rows });

    const search = screen.getByLabelText(/Find a salon/);

    fireEvent.change(search, { target: { value: "manhattan" } });
    expect(salonOrder()).toEqual(["KS Manhattan"]);

    fireEvent.change(search, { target: { value: "314" } });
    expect(salonOrder()).toEqual(["KS Lawrence"]);

    fireEvent.change(search, { target: { value: "District 5" } });
    expect(salonOrder()).toEqual(["KS Lawrence"]);

    expect(screen.getByText("1 of 2 salons")).toBeTruthy();
  });

  it("filters the table by district", () => {
    draw({ tab: "overview", locations: rows });

    fireEvent.change(screen.getByLabelText("Filter the goal table by district"), {
      target: { value: "District 5" },
    });

    expect(salonOrder()).toEqual(["KS Lawrence"]);
  });

  it("sorts by this week, and says so in the markup", () => {
    draw({ tab: "overview", locations: rows });

    const week = within(goalTable()).getByRole("columnheader", { name: /This week/ });
    fireEvent.click(within(week).getByRole("button"));

    expect(salonOrder()).toEqual(["KS Manhattan", "KS Lawrence"]);
    expect(week.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(within(week).getByRole("button"));
    expect(salonOrder()).toEqual(["KS Lawrence", "KS Manhattan"]);
    expect(week.getAttribute("aria-sort")).toBe("ascending");
  });

  it("sorts by salon name alphabetically", () => {
    draw({ tab: "overview", locations: rows });

    fireEvent.click(screen.getByRole("button", { name: /^Salon/ }));
    expect(salonOrder()).toEqual(["KS Lawrence", "KS Manhattan"]);
  });

  it("reads each row as it was given: code, week, month, target, progress, status", () => {
    draw({ tab: "overview", locations: rows });

    const body = goalTable().querySelector("tbody") as HTMLElement;
    const lawrence = within(body).getAllByRole("row")[0];
    const cells = within(lawrence)
      .getAllByRole("cell")
      .map((cell) => (cell.textContent ?? "").trim());

    expect(cells[1]).toBe("314");
    expect(cells[2]).toBe("2");
    expect(cells[3]).toBe("12");
    expect(cells[4]).toBe("10");
    /* Past 100%, and the overage named. */
    expect(cells[5]).toContain("120%");
    expect(cells[5]).toContain("+2 over");
    expect(cells[6]).toContain("Goal met");
    /* Seven columns: nothing for Unanswered, All this week or Last week. */
    expect(cells).toHaveLength(7);
  });

  it("links the month figure to exactly the reviews it counts", () => {
    draw({ tab: "overview", locations: rows });

    const link = screen.getByRole("link", { name: "12" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("store=314");
    expect(href).toContain("week=month");
    expect(href).toContain("qualifying=yes");
    expect(href).toContain("tab=reviews");
  });

  it("keeps Average, Historical and Held one press away", () => {
    draw({ tab: "overview", locations: rows });

    expect(screen.queryByRole("columnheader", { name: /Average/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More columns" }));

    expect(screen.getByRole("columnheader", { name: /Average/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Historical/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Held/ })).toBeTruthy();
    expect(screen.getByText("4.20")).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
  });

  it("keeps a salon with no reviews this month on the table, at zero", () => {
    draw({
      tab: "overview",
      locations: [...rows, location({ storeCode: "410", locationName: "NE Omaha Pacific" , qualifyingThisWeek: 0, qualifyingMonthToDate: 0 })],
    });

    expect(salonOrder()).toContain("NE Omaha Pacific");
    const row = screen.getByRole("link", { name: "NE Omaha Pacific" }).closest("tr") as HTMLElement;
    expect(row.textContent).toContain("0%");
    expect(row.textContent).toContain("10 to go");
    expect(row.textContent).toContain("Behind pace");
  });

  it("shows a salon with no baseline as Not counting, with no figures", () => {
    draw({
      tab: "overview",
      locations: [location({ anchorReviewId: null, anchorReviewer: null, qualifyingMonthToDate: 0 })],
    });

    const row = goalTable().querySelector("tbody tr") as HTMLElement;
    expect(row.textContent).toContain("Not counting");
    expect(row.textContent).toContain("No anchor — counting nothing");
    expect(row.textContent).not.toContain("0%");
  });
});

/* ------------------------------------------------------- the leaderboard -- */

describe("the ranked leaderboard", () => {
  const board = [
    location({ storeCode: "309", locationName: "NE Kearney", district: "Dugan", qualifyingThisWeek: 2, qualifyingMonthToDate: 8 }),
    location({ storeCode: "307", locationName: "NE Grand Island", district: "Dugan", qualifyingThisWeek: 3, qualifyingMonthToDate: 12 }),
    location({ storeCode: "313", locationName: "NE Omaha 132nd and Maple", district: "Cotton", qualifyingThisWeek: 3, qualifyingMonthToDate: 8 }),
    location({ storeCode: "306", locationName: "MO Kansas City Wornall", district: "Patterson", qualifyingThisWeek: 4, qualifyingMonthToDate: 10 }),
    location({ storeCode: "310", locationName: "NE Lincoln 27th Street", district: "Dugan", qualifyingThisWeek: 5, qualifyingMonthToDate: 5 }),
    location({ storeCode: "410", locationName: "NE Omaha Pacific", district: "Cotton", qualifyingThisWeek: 0, qualifyingMonthToDate: 0 }),
    location({ storeCode: "495", locationName: "MO St Joseph", district: "Cotton", anchorReviewId: null, anchorReviewer: null }),
  ];

  function ranking(): { salon: string; rank: string }[] {
    const list = screen.getByRole("list", { name: /Salons ranked/ });
    return within(list)
      .getAllByRole("listitem")
      .map((item) => ({
        salon: (item.querySelector("a")?.textContent ?? "").trim(),
        rank: item.querySelector("[aria-label^='Rank'], [aria-label='Not ranked']")?.getAttribute("aria-label") ?? "",
      }));
  }

  it("ranks by month to date, ties sharing a rank, unbaselined salons last and unranked", () => {
    draw({ tab: "leaderboard", locations: board });

    expect(ranking()).toEqual([
      { salon: "NE Grand Island", rank: "Rank 1" },
      { salon: "MO Kansas City Wornall", rank: "Rank 2" },
      { salon: "NE Omaha 132nd and Maple", rank: "Rank 3, tied" },
      { salon: "NE Kearney", rank: "Rank 3, tied" },
      { salon: "NE Lincoln 27th Street", rank: "Rank 5" },
      { salon: "NE Omaha Pacific", rank: "Rank 6" },
      { salon: "MO St Joseph", rank: "Not ranked" },
    ]);
  });

  it("marks goal achievement apart from pace", () => {
    draw({ tab: "leaderboard", locations: board });

    const row = (name: string) =>
      screen.getByRole("link", { name }).closest("li") as HTMLElement;
    /* 17 September: 6 by now to finish on 10. */
    expect(row("NE Grand Island").textContent).toContain("Goal met");
    expect(row("NE Grand Island").textContent).toContain("120%");
    expect(row("MO Kansas City Wornall").textContent).toContain("Goal met");
    expect(row("MO Kansas City Wornall").textContent).toContain("100%");
    expect(row("NE Kearney").textContent).toContain("On pace");
    expect(row("NE Kearney").textContent).not.toContain("Goal met");
    expect(row("NE Lincoln 27th Street").textContent).toContain("Behind pace");
    expect(row("MO St Joseph").textContent).toContain("Not counting");
  });

  it("ranks by this week on request", () => {
    draw({ tab: "leaderboard", locations: board });

    fireEvent.click(screen.getByRole("button", { name: "Rank by this week" }));

    expect(ranking()[0]).toEqual({ salon: "NE Lincoln 27th Street", rank: "Rank 1" });
    expect(screen.getByRole("button", { name: "Rank by this week" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("filters by status, counting each one", () => {
    draw({ tab: "leaderboard", locations: board });

    const met = screen.getByRole("button", { name: /^Goal met/ });
    expect(met.textContent).toContain("2");
    fireEvent.click(met);

    expect(ranking().map((entry) => entry.salon)).toEqual([
      "NE Grand Island",
      "MO Kansas City Wornall",
    ]);
  });

  it("keeps each salon's place on the whole board when a filter narrows the rows", () => {
    draw({ tab: "leaderboard", locations: board });

    fireEvent.change(screen.getByLabelText("Filter the leaderboard by district"), {
      target: { value: "Cotton" },
    });

    expect(ranking()).toEqual([
      { salon: "NE Omaha 132nd and Maple", rank: "Rank 3, tied" },
      { salon: "NE Omaha Pacific", rank: "Rank 6" },
      { salon: "MO St Joseph", rank: "Not ranked" },
    ]);
  });

  it("finds a salon by name or store code", () => {
    draw({ tab: "leaderboard", locations: board });

    fireEvent.change(screen.getByLabelText(/Find a salon/), { target: { value: "410" } });
    expect(ranking().map((entry) => entry.salon)).toEqual(["NE Omaha Pacific"]);
  });

  it("says where the month is", () => {
    const { container } = draw({ tab: "leaderboard", locations: board });

    expect(container.textContent).toContain("September · day 17 of 30");
    expect(container.textContent).toContain("2 of 6");
    expect(container.textContent).toContain("13 days left");
    expect(container.textContent).toContain("Pace mark: 6 by now finishes on 10");
  });
});
