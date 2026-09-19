import { describe, expect, it } from "vitest";

import {
  buildReviewTimeline,
  MAX_MONTHLY_BUCKETS,
  MAX_WEEKLY_BUCKETS,
  reviewDateOf,
  type TimelineRecord,
} from "./timeline";
import { weekStartOf } from "./reporting-week";

/**
 * ============================================================================
 * THE OVER-TIME CHART COUNTS REVIEWS. IT DOES NOT COUNT A WEEKLY TOTAL.
 * ============================================================================
 *
 * The two are different measures and the page shows both, so the risk is that
 * one quietly becomes the other. These tests pin what this one is:
 *
 *   IT READS THE RECORDS, NOT THE PERIODS. Nothing here has a reporting period,
 *   a baseline or an eligibility flag to consult — a review is placed by its
 *   date and counted, whatever week it counts toward and whatever its rating.
 *
 *   THE DATE PRECEDENCE IS GOOGLE FIRST AND FIRST-SEEN LAST, and which one
 *   answered is reported rather than assumed, so the caption can say how many
 *   bars rest on an estimate.
 *
 *   EMPTY BUCKETS BETWEEN POPULATED ONES ARE DRAWN. A chart that omits a quiet
 *   fortnight compresses its own axis and makes it look like steady volume.
 */

function record(overrides: Partial<TimelineRecord> = {}): TimelineRecord {
  return {
    googleAbsoluteDate: null,
    googleEstimatedAt: null,
    firstSeenAt: "2026-09-16T14:00:00.000Z",
    ...overrides,
  };
}

describe("which date a review is placed by", () => {
  it("prefers Google's own publication instant over everything else", () => {
    const dated = reviewDateOf(
      record({
        googleAbsoluteDate: "2026-07-04T15:00:00.000Z",
        googleEstimatedAt: "2026-08-01T00:00:00.000Z",
        firstSeenAt: "2026-09-16T14:00:00.000Z",
      }),
    );

    expect(dated).toEqual({ date: "2026-07-04", source: "google_absolute" });
  });

  it("falls back to the estimate read from Google's relative wording", () => {
    const dated = reviewDateOf(
      record({ googleEstimatedAt: "2026-08-01T12:00:00.000Z" }),
    );

    expect(dated).toEqual({ date: "2026-08-01", source: "google_estimated" });
  });

  it("uses first-seen only when Google gave no date at all", () => {
    /*
     * IT IS NOT A REVIEW DATE AND THE CAPTION SAYS SO. The Business Profile
     * page renders relative wording, so a Brave-sourced review with unreadable
     * text has nothing else — and the honest answer is the day we saw it,
     * labelled, rather than a date nobody recorded.
     */
    const dated = reviewDateOf(record({ firstSeenAt: "2026-09-16T14:00:00.000Z" }));

    expect(dated).toEqual({ date: "2026-09-16", source: "first_seen" });
  });

  it("steps past a value that cannot be parsed rather than dropping the review", () => {
    const dated = reviewDateOf(
      record({ googleAbsoluteDate: "not a date", firstSeenAt: "2026-09-16T14:00:00.000Z" }),
    );

    expect(dated?.source).toBe("first_seen");
  });

  it("judges the day in the business timezone, not in UTC", () => {
    /*
     * 01:00 UTC on the 20th is 21:00 Eastern on the 19th — a Saturday evening,
     * and therefore the week that is closing rather than the one that has not
     * opened. Bucketing the raw instant would file it in the following week and
     * disagree with the reporting period beside it.
     */
    const dated = reviewDateOf(record({ googleAbsoluteDate: "2026-09-20T01:00:00.000Z" }));

    expect(dated?.date).toBe("2026-09-19");
    expect(weekStartOf(dated!.date)).toBe("2026-09-13");
  });
});

describe("the series", () => {
  it("counts every review, whatever its rating or reporting period", () => {
    /* No eligibility, no period, no baseline reaches this function at all. */
    const timeline = buildReviewTimeline([
      record({ googleAbsoluteDate: "2026-09-14T10:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-09-15T10:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-09-16T10:00:00.000Z" }),
    ]);

    expect(timeline.counted).toBe(3);
    expect(timeline.weekly).toHaveLength(1);
    expect(timeline.weekly[0]).toMatchObject({ key: "2026-09-13", reviews: 3 });
  });

  it("groups weeks Sunday to Saturday, the application's own week", () => {
    const timeline = buildReviewTimeline([
      /* Saturday closes a week; the Sunday after opens the next one. */
      record({ googleAbsoluteDate: "2026-09-12T16:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-09-13T16:00:00.000Z" }),
    ]);

    expect(timeline.weekly.map((point) => point.key)).toEqual([
      "2026-09-06",
      "2026-09-13",
    ]);
    expect(timeline.weekly.map((point) => point.reviews)).toEqual([1, 1]);
  });

  it("draws a quiet week as a zero column rather than leaving it out", () => {
    const timeline = buildReviewTimeline([
      record({ googleAbsoluteDate: "2026-08-31T16:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-09-16T16:00:00.000Z" }),
    ]);

    expect(timeline.weekly.map((point) => point.reviews)).toEqual([1, 0, 1]);
  });

  it("aggregates the SAME reviews by month", () => {
    const timeline = buildReviewTimeline([
      record({ googleAbsoluteDate: "2026-07-02T10:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-07-29T10:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-09-16T10:00:00.000Z" }),
    ]);

    expect(timeline.monthly.map((point) => point.key)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(timeline.monthly.map((point) => point.reviews)).toEqual([2, 0, 1]);

    /* The two views are one set of records seen two ways, never two sets. */
    const weeklyTotal = timeline.weekly.reduce((sum, point) => sum + point.reviews, 0);
    const monthlyTotal = timeline.monthly.reduce((sum, point) => sum + point.reviews, 0);
    expect(weeklyTotal).toBe(3);
    expect(monthlyTotal).toBe(3);
  });

  it("crosses a year boundary on the monthly view", () => {
    const timeline = buildReviewTimeline([
      record({ googleAbsoluteDate: "2025-12-20T10:00:00.000Z" }),
      record({ googleAbsoluteDate: "2026-01-05T10:00:00.000Z" }),
    ]);

    expect(timeline.monthly.map((point) => point.key)).toEqual(["2025-12", "2026-01"]);
    expect(timeline.monthly[0].range).toBe("December 2025");
    expect(timeline.monthly[0].label).toBe("Dec 2025");
  });

  it("reports which date field placed each review", () => {
    const timeline = buildReviewTimeline([
      record({ googleAbsoluteDate: "2026-09-14T10:00:00.000Z" }),
      record({ googleEstimatedAt: "2026-09-15T10:00:00.000Z" }),
      record({ firstSeenAt: "2026-09-16T10:00:00.000Z" }),
    ]);

    expect(timeline.bySource).toEqual({
      google_absolute: 1,
      google_estimated: 1,
      first_seen: 1,
    });
  });

  it("keeps the RECENT window when the span is longer than the chart", () => {
    /*
     * A three-year backlog is 150 weekly columns, which is not a chart. The
     * window that survives is the recent one — "what are we receiving lately"
     * is the question — and the flag is what makes the caption say so instead
     * of letting a reader assume they are seeing everything.
     */
    const records = Array.from({ length: 70 }, (_, index) => {
      const at = new Date("2026-09-16T10:00:00.000Z");
      at.setUTCDate(at.getUTCDate() - index * 7);
      return record({ googleAbsoluteDate: at.toISOString() });
    });

    const timeline = buildReviewTimeline(records);

    expect(timeline.weeklyTrimmed).toBe(true);
    expect(timeline.weekly).toHaveLength(MAX_WEEKLY_BUCKETS);
    /* The last column is still the most recent week. */
    expect(timeline.weekly[timeline.weekly.length - 1].key).toBe("2026-09-13");
    /* And the count is every record, whether or not it got a column. */
    expect(timeline.counted).toBe(70);
  });

  it("bounds the monthly view the same way", () => {
    const records = Array.from({ length: 60 }, (_, index) => {
      const at = new Date(Date.UTC(2026, 8, 16, 10, 0, 0));
      at.setUTCMonth(at.getUTCMonth() - index);
      return record({ googleAbsoluteDate: at.toISOString() });
    });

    const timeline = buildReviewTimeline(records);

    expect(timeline.monthlyTrimmed).toBe(true);
    expect(timeline.monthly).toHaveLength(MAX_MONTHLY_BUCKETS);
    expect(timeline.monthly[timeline.monthly.length - 1].key).toBe("2026-09");
  });

  it("answers with nothing rather than with an invented column", () => {
    const timeline = buildReviewTimeline([]);

    expect(timeline.weekly).toEqual([]);
    expect(timeline.monthly).toEqual([]);
    expect(timeline.counted).toBe(0);
  });
});
