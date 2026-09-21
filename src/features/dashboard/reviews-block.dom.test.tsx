// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ReviewsWeekCard,
  ReviewsWeekSkeleton,
  weekBlockCaption,
} from "./reviews-block";
import type { ReviewsWeekBlock, ReviewsWeekFigures } from "@/lib/reviews/weekly-block";

/**
 * ============================================================================
 * THE YELLOW BLOCK, IN EVERY STATE THE REVIEW READ CAN PUT IT IN
 * ============================================================================
 *
 * The figures themselves are settled in `lib/reviews/weekly-block.test.ts`,
 * over the Google Reviews tab's own arithmetic. What is settled HERE is the
 * thing a screenshot cannot prove and the defect turned on: that no state of
 * this block ever prints a figure the data did not produce.
 *
 * Three of the four states are ones nobody sees in development — a week that
 * counted nothing, an estate with nothing synced, and a failed read — and each
 * one has to be distinguishable from the others on the face of the block.
 */

afterEach(cleanup);

function figures(overrides: Partial<ReviewsWeekFigures> = {}): ReviewsWeekFigures {
  return {
    status: "ready",
    gained: 37,
    allNew: 41,
    vsLastWeek: 6,
    averageRating: 4.32,
    salonCount: 15,
    listingsWithoutAnchor: 0,
    goal: 225,
    goalPerSalon: 15,
    weekLabel: "Sep 20 – Sep 26",
    previousWeekLabel: "Sep 13 – Sep 19",
    ...overrides,
  };
}

const draw = (block: ReviewsWeekBlock) => render(<ReviewsWeekCard block={block} />);

/* ------------------------------------------------------------- a week ---- */

describe("a week with figures", () => {
  it("prints the count, the rating, the goal and the salons it was given", () => {
    draw(figures());

    expect(screen.getByText("+37")).toBeTruthy();
    expect(screen.getByText("4.32")).toBeTruthy();
    expect(screen.getByText("225")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText(/37 of 225 weekly goal · \+6 vs last week/)).toBeTruthy();

    /* And none of the four figures this block used to carry. */
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByText("4.63")).toBeNull();
    expect(screen.queryByText("230")).toBeNull();
  });

  it("carries the period, the definition and the population under it", () => {
    draw(figures());
    /*
     * THE NOTE THAT WAS HERE said every figure was a placeholder. What replaced
     * it is not another warning — it is the provenance the tab already prints:
     * which week, what "gained" means, what it is compared against, and how
     * many salons are in it.
     */
    expect(
      screen.getByText(
        "Week of Sep 20 – Sep 26 · 3–5★ counted into the period, 41 counted in total · vs Sep 13 – Sep 19 · 15 salons · goal 15 per salon",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Google Business Profile is not connected yet/),
    ).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
  });

  it("runs the meter against the goal, on the real count", () => {
    draw(figures());
    const meter = screen.getByRole("progressbar");
    expect(meter.getAttribute("aria-valuenow")).toBe("37");
    expect(meter.getAttribute("aria-valuemax")).toBe("225");
    /* 37/225 is 16%. */
    expect((meter.firstElementChild as HTMLElement).style.width).toBe("16%");
  });

  it("clamps a beaten goal to a full bar and still prints what was counted", () => {
    draw(figures({ gained: 300, goal: 225 }));

    const meter = screen.getByRole("progressbar");
    expect((meter.firstElementChild as HTMLElement).style.width).toBe("100%");
    /* The visual is clamped; the count and the spoken value are not rounded down. */
    expect(screen.getByText("+300")).toBeTruthy();
    expect(screen.getByText(/300 of 225 weekly goal/)).toBeTruthy();
    expect(meter.getAttribute("aria-valuetext")).toBe("300 of 225");
    /* ARIA stays inside its own range, which `aria-valuetext` then qualifies. */
    expect(meter.getAttribute("aria-valuenow")).toBe("225");
  });

  it("says why a zero is a zero when the listings have no baseline", () => {
    /*
     * THE STATE THIS ESTATE IS ACTUALLY IN TODAY: 88 reviews held, fifteen
     * listings, and not one of them anchored — so every weekly figure is a
     * truthful 0 and reads, on a landing page, as a catastrophic week. The
     * caption is where that gets said; no figure is altered by it.
     */
    draw(figures({ gained: 0, allNew: 0, averageRating: null, listingsWithoutAnchor: 15 }));
    expect(
      screen.getByText(/15 listings have no baseline yet and count nothing/),
    ).toBeTruthy();
  });

  it("says nothing about baselines when every listing has one", () => {
    draw(figures());
    expect(screen.queryByText(/no baseline yet/)).toBeNull();
  });

  it("keeps Open pointing at the Google Reviews page", () => {
    draw(figures());
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      "/reviews",
    );
  });
});

/* ------------------------------------------------------ a quiet week ------ */

describe("a week that counted nothing", () => {
  it("shows a zero and a dash, never a borrowed figure", () => {
    draw(figures({ gained: 0, allNew: 0, averageRating: null, vsLastWeek: -8 }));

    /*
     * THE SIGN ON THE HEADLINE BELONGS TO THE CHANGE, NOT TO THE COUNT — the
     * approved block reads "+189" on a week that gained ground and "189" on one
     * that lost it. A week down 8 therefore prints a bare 0.
     */
    expect(screen.getByText("Reviews gained").nextElementSibling?.textContent).toBe("0");
    /* An em dash: nobody rated us this week, which is not a rating of 0.00. */
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/0 of 225 weekly goal · −8 vs last week/)).toBeTruthy();
    expect((screen.getByRole("progressbar").firstElementChild as HTMLElement).style.width).toBe(
      "0%",
    );
  });
});

/* --------------------------------------------------------- no goal set ---- */

describe("a deployment with no weekly goal configured", () => {
  it("draws no meter and no percentage, and still reports the week", () => {
    draw(figures({ goal: null, goalPerSalon: null }));

    /* A meter against nothing is a percentage against a number nobody agreed to. */
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/37 counted · no weekly goal set · \+6 vs last week/)).toBeTruthy();
    /* The goal cell is a dash rather than a zero or an invented total. */
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("230")).toBeNull();
    /* Everything that IS known is still shown. */
    expect(screen.getByText("+37")).toBeTruthy();
    expect(screen.getByText("4.32")).toBeTruthy();
  });

  it("leaves the goal out of the caption rather than captioning a null", () => {
    expect(weekBlockCaption(figures({ goal: null, goalPerSalon: null }))).not.toMatch(
      /goal/,
    );
  });

  it("treats an explicit zero goal as no meter too", () => {
    draw(figures({ goal: 0, goalPerSalon: 0 }));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/37 counted · no weekly goal set/)).toBeTruthy();
    /* Zero is what the deployment said, so zero is what the cell shows. */
    expect(screen.getByText("0")).toBeTruthy();
  });
});

/* ------------------------------------------------ nothing to report on ---- */

describe("when there is no week to report", () => {
  it("says nothing has been synced rather than drawing zeroes", () => {
    draw({ status: "no_data", reason: "No Google review has been synced into Ask Sunny yet." });

    expect(
      screen.getByText("No Google review has been synced into Ask Sunny yet."),
    ).toBeTruthy();
    /* No figures at all — a row of zeroes reads as a catastrophic week. */
    expect(screen.queryByText("Reviews gained")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    /* The way to the answer is still there. */
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  });

  it("says a read failed rather than falling back to any figure", () => {
    draw({ status: "error", message: "Google review figures could not be read just now." });

    expect(
      screen.getByText(/Google review figures could not be read just now/),
    ).toBeTruthy();
    expect(screen.getByText(/No figures are shown rather than figures that might be wrong/)).toBeTruthy();
    /*
     * THE ASSERTION THIS WHOLE CHANGE IS FOR. A failed query must never print
     * 189, 4.63, 230 or 15 — the four values that used to be unconditional.
     */
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByText("4.63")).toBeNull();
    expect(screen.queryByText("230")).toBeNull();
    expect(screen.queryByText("15")).toBeNull();
    expect(screen.queryByText("Reviews gained")).toBeNull();
  });
});

/* ----------------------------------------------------------- loading ------ */

describe("while the read is in flight", () => {
  it("holds the block's shape without showing a figure", () => {
    const { container } = render(<ReviewsWeekSkeleton />);

    expect(container.querySelector("[aria-busy]")).toBeTruthy();
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByText("+37")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    /* The yellow block itself is still occupying its place on the page. */
    expect(container.querySelector(".bg-brand-yellow")).toBeTruthy();
  });
});

/* ------------------------------------------------------- the wiring ------- */

describe("how the home page gets the block", () => {
  const PAGE = readFileSync("src/app/(app)/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("renders the server component behind its own Suspense boundary", () => {
    expect(PAGE).toMatch(/<ReviewsWeek \/>/);
    expect(PAGE).toMatch(/fallback=\{<ReviewsWeekSkeleton \/>\}/);
  });

  it("does not read the estate's reviews for somebody who may not see them", () => {
    expect(PAGE).toMatch(/pageCan\("view_google_reviews"\)/);
    expect(PAGE).toMatch(/canViewReviews \?/);
  });
});
