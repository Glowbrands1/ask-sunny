// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ReviewsBlockCard,
  ReviewsBlockSkeleton,
  overviewBlockCaption,
} from "./reviews-block";
import type {
  ReviewsOverviewBlock,
  ReviewsOverviewFigures,
} from "@/lib/reviews/overview-block";

/**
 * ============================================================================
 * THE YELLOW BLOCK, IN EVERY STATE THE REVIEW READ CAN PUT IT IN
 * ============================================================================
 *
 * The figures themselves are settled in `lib/reviews/overview-block.test.ts`,
 * over the same counts the Google Reviews tab's rating card reads. What is
 * settled HERE is the thing a screenshot cannot prove: that no state of this
 * block ever prints a figure the data did not produce, and that nothing about
 * the weekly reporting period is drawn on it any more.
 */

afterEach(cleanup);

function figures(overrides: Partial<ReviewsOverviewFigures> = {}): ReviewsOverviewFigures {
  return {
    status: "ready",
    totalReviews: 88,
    averageRating: 4.8523,
    salonCount: 15,
    ...overrides,
  };
}

const draw = (block: ReviewsOverviewBlock) => render(<ReviewsBlockCard block={block} />);

/* -------------------------------------------------------- the inventory -- */

describe("a block with figures", () => {
  it("prints the total, the average and the salons it was given", () => {
    draw(figures());

    expect(screen.getByText("Total reviews")).toBeTruthy();
    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getByText("Average rating")).toBeTruthy();
    expect(screen.getByText("4.85")).toBeTruthy();
    expect(screen.getByText("Salons")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();

    /* And none of the figures this block carried while it was seeded. */
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByText("4.63")).toBeNull();
    expect(screen.queryByText("230")).toBeNull();
  });

  it("prints the total without a sign — an inventory has no direction", () => {
    /*
     * The old headline carried a "+" driven by the week-over-week delta. On a
     * count of everything held, "+88" would read as eighty-eight arrivals.
     */
    expect(screen.queryByText("+88")).toBeNull();
    draw(figures());
    expect(screen.getByText("Total reviews").nextElementSibling?.textContent).toBe("88");
  });

  it("carries no weekly period, goal, meter or comparison anywhere on it", () => {
    const { container } = draw(figures());

    /* The four controls that described the reporting period, all gone. */
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/weekly goal/i)).toBeNull();
    expect(screen.queryByText(/vs last week/i)).toBeNull();
    expect(screen.queryByText(/counted into the period/i)).toBeNull();
    expect(screen.queryByText(/Reviews gained/i)).toBeNull();
    expect(screen.queryByText(/Sep 20/)).toBeNull();
    expect(screen.queryByText(/3–5★/)).toBeNull();
    expect(screen.queryByText(/no baseline/i)).toBeNull();
    /* And the yellow field itself is unchanged. */
    expect(container.querySelector(".bg-brand-yellow")).toBeTruthy();
  });

  it("says what the total counts, and what it does not", () => {
    draw(figures());
    /*
     * "Total reviews 88" must not be read as GOOGLE'S lifetime total — the
     * Business Profile page exposes no per-listing lifetime count this system
     * can read, which is why the tab labels its own column "reviews Ask Sunny
     * holds". The caption says the same thing in a line.
     */
    expect(
      screen.getByText(
        "88 Google reviews Ask Sunny holds across 15 salons · not Google's own lifetime total",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Google Business Profile is not connected yet/),
    ).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
  });

  it("reads singular when the estate holds one review at one salon", () => {
    expect(overviewBlockCaption(figures({ totalReviews: 1, salonCount: 1 }))).toBe(
      "1 Google review Ask Sunny holds across 1 salon · not Google's own lifetime total",
    );
  });

  it("keeps Open pointing at the Google Reviews page", () => {
    draw(figures());
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      "/reviews",
    );
  });
});

/* ------------------------------------------------ nothing to report on ---- */

describe("when there is nothing to report", () => {
  it("says nothing has been synced rather than drawing zeroes", () => {
    draw({ status: "no_data", reason: "No Google review has been synced into Ask Sunny yet." });

    expect(
      screen.getByText("No Google review has been synced into Ask Sunny yet."),
    ).toBeTruthy();
    expect(screen.queryByText("Total reviews")).toBeNull();
    /* The way to the answer is still there. */
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  });

  it("says a read failed rather than falling back to any figure", () => {
    draw({ status: "error", message: "Google review figures could not be read just now." });

    expect(
      screen.getByText(/Google review figures could not be read just now/),
    ).toBeTruthy();
    expect(
      screen.getByText(/No figures are shown rather than figures that might be wrong/),
    ).toBeTruthy();
    /*
     * THE ASSERTION THIS BLOCK EXISTS FOR. A failed query must never print a
     * number — not the seeded ones, and not a stale inventory.
     */
    expect(screen.queryByText("88")).toBeNull();
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByText("4.63")).toBeNull();
    expect(screen.queryByText("Total reviews")).toBeNull();
  });

  it("dashes the average only when there is genuinely nothing to average", () => {
    /*
     * Reachable only through a caller that hands `ready` with no reviews; the
     * derivation returns `no_data` for an empty estate. Pinned so the bar's own
     * rule stays true if that ever changes.
     */
    draw(figures({ totalReviews: 0, averageRating: null }));
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("0.00")).toBeNull();
  });
});

/* ----------------------------------------------------------- loading ------ */

describe("while the read is in flight", () => {
  it("holds the block's shape without showing a figure", () => {
    const { container } = render(<ReviewsBlockSkeleton />);

    expect(container.querySelector("[aria-busy]")).toBeTruthy();
    expect(screen.queryByText("88")).toBeNull();
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.querySelector(".bg-brand-yellow")).toBeTruthy();
  });
});

/* ------------------------------------------------------- the wiring ------- */

describe("how the home page gets the block", () => {
  const strip = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const PAGE = strip("src/app/(app)/page.tsx");

  it("renders the server component behind its own Suspense boundary", () => {
    expect(PAGE).toMatch(/<ReviewsBlock \/>/);
    expect(PAGE).toMatch(/fallback=\{<ReviewsBlockSkeleton \/>\}/);
  });

  it("does not read the estate's reviews for somebody who may not see them", () => {
    expect(PAGE).toMatch(/pageCan\("view_google_reviews"\)/);
    expect(PAGE).toMatch(/canViewReviews \?/);
  });

  it("heads the section Google reviews rather than This week", () => {
    const screenSource = strip("src/features/dashboard/overview.tsx");
    expect(screenSource).toMatch(/label="Google reviews"/);
    expect(screenSource).not.toMatch(/label="This week"/);
  });

  it("leaves no weekly goal configuration behind for a block that has none", () => {
    /*
     * The goal existed only to draw this block's meter. A variable an operator
     * could still set, that now decides nothing, is worse than no variable.
     */
    const env = readFileSync(".env.example", "utf8");
    expect(env).not.toMatch(/GOOGLE_REVIEWS_WEEKLY_GOAL_PER_SALON/);
  });
});
