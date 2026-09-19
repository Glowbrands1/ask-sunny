// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  buildReviewTimeline,
  EMPTY_REVIEW_TIMELINE,
  type TimelineRecord,
} from "@/lib/reviews/timeline";

import { ReviewsTimeline } from "./reviews-timeline";

/**
 * ============================================================================
 * THE OVER-TIME CHART SAYS WHAT IT IS COUNTING, EVERY TIME IT DRAWS
 * ============================================================================
 *
 * There are two "reviews per week" figures on this page and they are not the
 * same number. The official one counts from each salon's baseline and is zero
 * until one is set; this one counts the records and is true immediately. A
 * reader who mistakes the second for the first will quote it in a meeting, so
 * the caption is part of the chart rather than decoration on it — and these
 * tests treat it as such.
 *
 * The bars themselves are drawn by Recharts inside a ResponsiveContainer, which
 * has no measured viewport under jsdom. What is asserted here is everything
 * around them: the title, the caption, the period control and the empty state.
 * `timeline.test.ts` owns the arithmetic that decides the bars.
 */

afterEach(cleanup);

const RECORDS: TimelineRecord[] = [
  { googleAbsoluteDate: "2026-09-14T10:00:00.000Z", googleEstimatedAt: null, firstSeenAt: "2026-09-16T10:00:00.000Z" },
  { googleAbsoluteDate: "2026-09-15T10:00:00.000Z", googleEstimatedAt: null, firstSeenAt: "2026-09-16T10:00:00.000Z" },
  { googleAbsoluteDate: "2026-08-03T10:00:00.000Z", googleEstimatedAt: null, firstSeenAt: "2026-09-16T10:00:00.000Z" },
];

function draw(records = RECORDS, scope: string | null = null) {
  return render(
    <ReviewsTimeline
      timeline={{ ...buildReviewTimeline(records), truncated: false }}
      scope={scope}
    />,
  );
}

describe("the over-time chart", () => {
  it("is titled for the question it answers", () => {
    draw();

    expect(screen.getByRole("heading", { name: "Google Reviews Over Time" })).toBeTruthy();
  });

  it("OPENS ON WEEKLY, and offers monthly beside it", () => {
    draw();

    const weekly = screen.getByRole("radio", { name: "Weekly" });
    const monthly = screen.getByRole("radio", { name: "Monthly" });

    expect(weekly.getAttribute("data-state")).toBe("on");
    expect(monthly.getAttribute("data-state")).toBe("off");
  });

  it("changes what it is counting by when the period changes", () => {
    draw();

    expect(screen.getByText(/per reporting week/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));

    expect(screen.getByText(/per month/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Monthly" }).getAttribute("data-state")).toBe(
      "on",
    );
  });

  it("REFUSES TO BE READ AS THE WEEKLY TOTAL", () => {
    /*
     * The sentence that keeps the two figures apart. It is not optional and it
     * is not in a tooltip — it is under the title, in both periods.
     */
    draw();

    expect(
      screen.getByText(/This is volume, not the official weekly count/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(
      screen.getByText(/This is volume, not the official weekly count/),
    ).toBeTruthy();
  });

  it("names the salon the filters narrowed it to", () => {
    draw(RECORDS, "KS Lawrence");

    expect(screen.getByText(/at KS Lawrence/)).toBeTruthy();
  });

  it("declares a review it had to place by something other than Google's date", () => {
    /*
     * Google's Business Profile page gives relative wording, not timestamps, so
     * some reviews are placed by an estimate and some by the day ASK Sunny saw
     * them. Neither is a review date, and a bar must not imply a precision the
     * record does not have.
     */
    const mixed: TimelineRecord[] = [
      { googleAbsoluteDate: "2026-09-14T10:00:00.000Z", googleEstimatedAt: null, firstSeenAt: "2026-09-16T10:00:00.000Z" },
      { googleAbsoluteDate: null, googleEstimatedAt: "2026-09-10T10:00:00.000Z", firstSeenAt: "2026-09-16T10:00:00.000Z" },
      { googleAbsoluteDate: null, googleEstimatedAt: null, firstSeenAt: "2026-09-16T10:00:00.000Z" },
    ];
    draw(mixed);

    const caption = screen.getByText(/Google published a date for 1;/);
    expect(caption.textContent).toContain("by Google's relative wording (1)");
    expect(caption.textContent).toContain("by the day ASK Sunny first saw them (1)");
  });

  it("says nothing about dating when Google supplied every date", () => {
    draw();

    expect(screen.queryByText(/Google published a date for/)).toBeNull();
  });

  it("DRAWS A SENTENCE RATHER THAN AN EMPTY CANVAS when nothing matches", () => {
    /*
     * The chart this replaced drew a full-height axis with no bars on it, which
     * reads as broken rather than as "nothing has been synced yet".
     */
    render(
      <ReviewsTimeline timeline={{ ...EMPTY_REVIEW_TIMELINE, truncated: false }} />,
    );

    expect(screen.getByText(/nothing to\s+plot/)).toBeTruthy();
    expect(document.querySelector(".recharts-wrapper")).toBeNull();
  });
});
