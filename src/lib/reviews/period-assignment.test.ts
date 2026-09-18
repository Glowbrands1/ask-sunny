import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  approximateAgeMs,
  feedOrderLooksReliable,
  planPeriodAssignment,
  STORE_FINDING_LABEL,
  type PlannableReview,
} from "./period-assignment";

/**
 * THE RULE THAT DECIDES WHETHER A REVIEW COUNTS THIS WEEK.
 *
 * The defect these exist to prevent, stated once: keying the reporting period
 * on when a review was first seen means IMPORTING A BACKLOG INFLATES THE
 * CURRENT WEEK. Every test below is a case where the old behaviour would have
 * counted something it should not, or would have counted something twice.
 *
 * Every review id and reviewer name is invented.
 */

/** A page of reviews for one listing, newest first. */
function feed(
  storeCode: string,
  ids: string[],
  relativeDates: (string | null)[] = [],
): PlannableReview[] {
  return ids.map((externalReviewId, index) => ({
    externalReviewId,
    storeCode,
    feedPosition: index,
    relativeDateText: relativeDates[index] ?? null,
  }));
}

function anchorsFor(entries: Record<string, string | null>): Map<string, string | null> {
  return new Map(Object.entries(entries));
}

/* -------------------------------------------------- the backlog problem --- */

describe("a backlog imported today does not count as this week", () => {
  it("counts nothing at all when the listing has no anchor", () => {
    /*
     * THE ORIGINAL DEFECT. Forty reviews going back a year, first seen today.
     * Under the old rule every one of them was "this week". Under this one,
     * none of them is anything until somebody says where the boundary is.
     */
    const page = feed("306", [
      "QA-0001", "QA-0002", "QA-0003", "QA-0004", "QA-0005",
    ], ["2 days ago", "3 weeks ago", "2 months ago", "5 months ago", "a year ago"]);

    const plan = planPeriodAssignment(page, anchorsFor({ 306: null }));

    expect([...plan.assignments.values()].every((value) => value === "historical")).toBe(true);
    expect(plan.storePlans[0]).toMatchObject({
      storeCode: "306",
      counted: 0,
      historical: 5,
      finding: "no_anchor",
      advanceAnchorTo: null,
    });
  });

  it("counts nothing when the anchor is not on the page", () => {
    /*
     * The feed did not reach back far enough, or the anchored review was
     * deleted. The boundary is unknown, so nothing above it can be proven new.
     */
    const page = feed("306", ["QA-0001", "QA-0002"], ["1 day ago", "2 days ago"]);

    const plan = planPeriodAssignment(page, anchorsFor({ 306: "QA-NOT-ON-PAGE" }));

    expect(plan.storePlans[0].finding).toBe("anchor_not_in_feed");
    expect(plan.storePlans[0].counted).toBe(0);
    expect(plan.storePlans[0].advanceAnchorTo).toBeNull();
  });

  it("counts nothing when the caller sent no feed order", () => {
    const page: PlannableReview[] = [
      { externalReviewId: "QA-0001", storeCode: "306", feedPosition: null },
      { externalReviewId: "QA-0002", storeCode: "306", feedPosition: null },
    ];

    const plan = planPeriodAssignment(page, anchorsFor({ 306: "QA-0002" }));

    expect(plan.storePlans[0].finding).toBe("feed_position_missing");
    expect(plan.storePlans[0].counted).toBe(0);
  });
});

/* ------------------------------------------------------------ the anchor -- */

describe("the anchor decides the boundary", () => {
  const page = feed(
    "306",
    ["QA-NEW-1", "QA-NEW-2", "QA-ANCHOR", "QA-OLD-1", "QA-OLD-2"],
    ["7 hours ago", "1 day ago", "2 days ago", "1 week ago", "3 weeks ago"],
  );

  const plan = planPeriodAssignment(page, anchorsFor({ 306: "QA-ANCHOR" }));

  it("counts the reviews above the anchor", () => {
    expect(plan.assignments.get("QA-NEW-1")).toBe("current");
    expect(plan.assignments.get("QA-NEW-2")).toBe("current");
    expect(plan.storePlans[0].counted).toBe(2);
  });

  it("never counts the anchor review again", () => {
    /*
     * IT WAS COUNTED IN THE PERIOD THAT CLOSED ON IT. Counting it again is the
     * specific error the manual process is careful to avoid, and the reason the
     * boundary is exclusive rather than inclusive.
     */
    expect(plan.assignments.get("QA-ANCHOR")).toBe("historical");
  });

  it("leaves everything below the anchor out of the period", () => {
    expect(plan.assignments.get("QA-OLD-1")).toBe("historical");
    expect(plan.assignments.get("QA-OLD-2")).toBe("historical");
    expect(plan.storePlans[0].historical).toBe(3);
  });

  it("advances the anchor to the top of the page, not to the old boundary", () => {
    expect(plan.storePlans[0].advanceAnchorTo).toBe("QA-NEW-1");
  });

  it("echoes the anchor it measured against, so a stale plan can be refused", () => {
    /*
     * OPTIMISTIC CONCURRENCY. Two machines syncing at once would otherwise both
     * measure against the same boundary and both count the same reviews. The
     * database refuses a plan whose `expectedAnchor` no longer matches.
     */
    expect(plan.storePlans[0].expectedAnchor).toBe("QA-ANCHOR");
  });

  it("counts nothing, and moves nothing, when the anchor is already at the top", () => {
    /* The ordinary "no new reviews since last time" sync. Not a finding. */
    const quiet = planPeriodAssignment(
      feed("306", ["QA-ANCHOR", "QA-OLD-1"], ["2 days ago", "1 week ago"]),
      anchorsFor({ 306: "QA-ANCHOR" }),
    );

    expect(quiet.storePlans[0]).toMatchObject({
      counted: 0,
      finding: null,
      advanceAnchorTo: null,
    });
  });

  it("is keyed on the Google review id, not on the reviewer's name", () => {
    /*
     * Two customers called "Sarah M." at one salon in one week is the case a
     * name-keyed anchor gets wrong, and the legacy spreadsheet's only key was
     * the name. Nothing in this module reads a name.
     */
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "reviews", "period-assignment.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(code).not.toMatch(/reviewerName/);
  });
});

/* --------------------------------------------------- the weekly rule ------ */

describe("the star rule is applied to what the anchor admitted, not instead of it", () => {
  /*
   * TWO SEPARATE GATES, AND BOTH MUST PASS FOR A REVIEW TO RAISE THE OFFICIAL
   * NUMBER. This module decides the PERIOD; `eligible_for_weekly_count` — a
   * generated column in the database — decides whether a review in that period
   * is one of the 3-to-5-star ones that count. A 1-star review above the anchor
   * is in the period and is not in the total.
   */
  const page = feed(
    "143",
    ["QA-5STAR", "QA-1STAR", "QA-ANCHOR", "QA-OLD-5STAR"],
    ["3 hours ago", "1 day ago", "4 days ago", "2 weeks ago"],
  );
  const ratings: Record<string, number> = {
    "QA-5STAR": 5,
    "QA-1STAR": 1,
    "QA-ANCHOR": 4,
    "QA-OLD-5STAR": 5,
  };

  const plan = planPeriodAssignment(page, anchorsFor({ 143: "QA-ANCHOR" }));
  const inPeriod = [...plan.assignments.entries()]
    .filter(([, assignment]) => assignment === "current")
    .map(([id]) => id);

  it("admits both the 5-star and the 1-star to the period", () => {
    expect(inPeriod.sort()).toEqual(["QA-1STAR", "QA-5STAR"]);
  });

  it("counts only the 3-to-5-star one toward the qualifying total", () => {
    const qualifying = inPeriod.filter((id) => ratings[id] >= 3);
    expect(qualifying).toEqual(["QA-5STAR"]);
  });

  it("keeps the 1-star visible in the period rather than discarding it", () => {
    expect(plan.assignments.get("QA-1STAR")).toBe("current");
  });

  it("does not admit an older 5-star from below the anchor", () => {
    expect(plan.assignments.get("QA-OLD-5STAR")).toBe("historical");
  });
});

/* ------------------------------------------------------ the order check --- */

describe("a feed that is not newest-first is refused", () => {
  it("notices a page sorted by rating rather than by date", () => {
    /*
     * Google's Reviews page has a sort control. Sorted by rating, position
     * means nothing, and counting "everything above the anchor" would count an
     * arbitrary slice. The relative dates give it away.
     */
    const page = feed(
      "306",
      ["QA-OLD", "QA-NEW", "QA-ANCHOR"],
      ["6 months ago", "2 hours ago", "1 week ago"],
    );

    const plan = planPeriodAssignment(page, anchorsFor({ 306: "QA-ANCHOR" }));

    expect(plan.storePlans[0].finding).toBe("feed_order_unreliable");
    expect(plan.storePlans[0].counted).toBe(0);
  });

  it("accepts ties, because Google's buckets are coarse", () => {
    /* Two reviews from the same Tuesday both read "2 days ago". */
    expect(
      feedOrderLooksReliable(
        feed("306", ["a", "b", "c"], ["2 days ago", "2 days ago", "3 days ago"]),
      ),
    ).toBe(true);
  });

  it("treats an unreadable date as silence rather than as disorder", () => {
    expect(
      feedOrderLooksReliable(
        feed("306", ["a", "b", "c"], ["1 day ago", "sometime", "2 days ago"]),
      ),
    ).toBe(true);
  });

  it("refuses a page whose positions collide", () => {
    const page: PlannableReview[] = [
      { externalReviewId: "QA-A", storeCode: "306", feedPosition: 0 },
      { externalReviewId: "QA-B", storeCode: "306", feedPosition: 0 },
    ];
    const plan = planPeriodAssignment(page, anchorsFor({ 306: "QA-B" }));
    expect(plan.storePlans[0].finding).toBe("feed_order_unreliable");
  });
});

/* --------------------------------------------------- several listings ----- */

describe("listings are judged independently", () => {
  it("counts one listing and refuses another in the same sync", () => {
    /*
     * The combined feed carries several listings at once, and each has its own
     * boundary. One salon with a good anchor must not be held back by a
     * neighbour that has never been baselined.
     */
    const page = [
      ...feed("306", ["A-NEW", "A-ANCHOR"], ["1 day ago", "5 days ago"]),
      ...feed("143", ["B-1", "B-2"], ["2 days ago", "9 days ago"]),
    ];

    const plan = planPeriodAssignment(
      page,
      anchorsFor({ 306: "A-ANCHOR", 143: null }),
    );

    const manhattan = plan.storePlans.find((entry) => entry.storeCode === "306");
    const kearney = plan.storePlans.find((entry) => entry.storeCode === "143");

    expect(manhattan).toMatchObject({ counted: 1, finding: null });
    expect(kearney).toMatchObject({ counted: 0, finding: "no_anchor" });
    expect(plan.assignments.get("A-NEW")).toBe("current");
    expect(plan.assignments.get("B-1")).toBe("historical");
  });

  it("positions are per listing, so an interleaved feed still reads correctly", () => {
    /*
     * The extension numbers each listing's run from zero. A feed where the
     * listings alternate must not have one listing's position compared with
     * another's.
     */
    const page: PlannableReview[] = [
      { externalReviewId: "A-NEW", storeCode: "306", feedPosition: 0, relativeDateText: "1 day ago" },
      { externalReviewId: "B-NEW", storeCode: "143", feedPosition: 0, relativeDateText: "2 days ago" },
      { externalReviewId: "A-ANCHOR", storeCode: "306", feedPosition: 1, relativeDateText: "6 days ago" },
      { externalReviewId: "B-ANCHOR", storeCode: "143", feedPosition: 1, relativeDateText: "8 days ago" },
    ];

    const plan = planPeriodAssignment(
      page,
      anchorsFor({ 306: "A-ANCHOR", 143: "B-ANCHOR" }),
    );

    expect(plan.assignments.get("A-NEW")).toBe("current");
    expect(plan.assignments.get("B-NEW")).toBe("current");
    expect(plan.assignments.get("A-ANCHOR")).toBe("historical");
    expect(plan.assignments.get("B-ANCHOR")).toBe("historical");
  });
});

/* ---------------------------------------------- the relative-date reader -- */

describe("approximateAgeMs", () => {
  it.each([
    ["just now", 0],
    ["7 hours ago", 7 * 3_600_000],
    ["1 day ago", 86_400_000],
    ["yesterday", 86_400_000],
    ["2 days ago", 2 * 86_400_000],
    ["a week ago", 604_800_000],
    ["3 weeks ago", 3 * 604_800_000],
    ["Edited 2 days ago", 2 * 86_400_000],
  ])("reads %s", (text, expected) => {
    expect(approximateAgeMs(text)).toBe(expected);
  });

  it("returns null rather than guessing at anything it cannot read", () => {
    /*
     * A WRONG AGE WOULD BE WORSE THAN NO AGE. It feeds the order check, so a
     * guess could either wave through a badly sorted page or refuse a good one.
     */
    for (const text of ["", "   ", "last Tuesday", "3 fortnights ago", "12/05/2026", null]) {
      expect(approximateAgeMs(text)).toBeNull();
    }
  });

  it("agrees with the SQL function on the forms both accept", () => {
    /*
     * The same derivation exists in `google_review_estimate_from_relative`,
     * because the database stores `google_estimated_at` and this module checks
     * the feed order. Two implementations of one rule drift, so the SQL is read
     * as text and its accepted vocabulary is compared with this one's.
     */
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase",
        "migrations",
        "20260917002200_google_review_reporting_periods.sql",
      ),
      "utf8",
    );

    const sqlPattern = /\^\(a\|an\|\\d\{1,4\}\)\\s\+\(second\|minute\|hour\|day\|week\|month\|year\)s\?\\s\+ago\$/;
    expect(migration).toMatch(sqlPattern);
    /* And the two word-forms that are handled outside the pattern. */
    expect(migration).toContain("'just now', 'today', 'a moment ago', 'moments ago'");
    expect(migration).toContain("v_text = 'yesterday'");
    expect(migration).toContain("regexp_replace(v_text, '^edited\\s+', '')");
  });
});

describe("every finding has something a person can act on", () => {
  it("labels all four", () => {
    for (const finding of [
      "no_anchor",
      "anchor_not_in_feed",
      "feed_position_missing",
      "feed_order_unreliable",
    ] as const) {
      expect(STORE_FINDING_LABEL[finding].length).toBeGreaterThan(20);
    }
  });
});
