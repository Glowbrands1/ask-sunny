// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FeedbackSummary } from "@/lib/analytics/feedback-queries";
import { ConversationFeedbackSummary } from "./feedback-summary";

/**
 * THE PANEL HAS TO SAY WHAT IT NOW MEASURES.
 *
 * The rating figures count OPEN feedback: resolved, dismissed and hidden
 * ratings leave them. That makes the average a measure of what is outstanding
 * rather than of what leaders said — so it moves when an ADMINISTRATOR acts,
 * not only when somebody rates, and resolving a 1-star raises it.
 *
 * A reader who does not know that draws the opposite conclusion from a rising
 * number. The wording is the only thing standing between them and that mistake,
 * which is why it is tested rather than left to a copy review.
 */

const SUMMARY: FeedbackSummary = {
  responses: 3,
  averageRating: 4.3,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 },
  outcomes: { yes: 3, partially: 0, no: 0 },
  queue: { pending: 3, in_review: 0, resolved: 1, dismissed: 1 },
  hidden: 2,
};

const EMPTY: FeedbackSummary = {
  responses: 0,
  averageRating: null,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  outcomes: { yes: 0, partially: 0, no: 0 },
  queue: { pending: 0, in_review: 0, resolved: 0, dismissed: 0 },
  hidden: 0,
};

afterEach(cleanup);

function panel(summary: FeedbackSummary) {
  return render(
    <ConversationFeedbackSummary
      summary={summary}
      previous={EMPTY}
      periodLabel="Last 30 days"
    />,
  );
}

describe("the panel names what it counts", () => {
  it("labels the headline as open feedback rather than as every answer", () => {
    panel(SUMMARY);
    expect(screen.getByText("4.3")).toBeDefined();
    expect(screen.getByText(/average rating · open feedback/i)).toBeDefined();
  });

  it("says outright that resolved and dismissed ratings leave the figures", () => {
    /*
     * THE SENTENCE THAT PREVENTS THE MISREADING. Without it a rising average
     * looks like Sunny improving when it may only mean somebody worked the
     * queue.
     */
    panel(SUMMARY);
    const note = screen.getByText(/resolved, dismissed and hidden ratings leave/i);
    expect(note.textContent).toMatch(/outstanding/i);
    expect(note.textContent).toMatch(/record work rather than sentiment/i);
  });

  it("describes the volume as open ratings", () => {
    panel(SUMMARY);
    expect(screen.getByText(/open ratings in the last 30 days/i)).toBeDefined();
  });

  it("states the denominator of the outcome split", () => {
    panel(SUMMARY);
    expect(screen.getByText(/percentages are of the 3 open ratings/i)).toBeDefined();
  });

  it("still reports every rating in the queue depths", () => {
    /*
     * The counts are a record of WORK, so they keep counting everything —
     * "1 resolved" has to keep meaning one thing was dealt with.
     */
    panel(SUMMARY);
    expect(screen.getByText("pending")).toBeDefined();
    expect(screen.getByText("resolved")).toBeDefined();
    expect(screen.getByText("dismissed")).toBeDefined();
    expect(screen.getByText("hidden")).toBeDefined();
  });
});

describe("an empty panel says which kind of empty it is", () => {
  it("distinguishes a triaged period from a silent one", () => {
    /*
     * Both are zero open ratings. One means nobody said anything; the other
     * means everything said was dealt with. Conflating them is how somebody
     * concludes the feature stopped collecting feedback.
     */
    panel({
      ...EMPTY,
      queue: { pending: 0, in_review: 0, resolved: 11, dismissed: 3 },
    });

    expect(screen.getByText("No open feedback")).toBeDefined();
    expect(screen.getByText(/11 resolved and 3 dismissed/i)).toBeDefined();
    expect(screen.getByText(/nothing was deleted/i)).toBeDefined();
  });

  it("says nobody has rated anything when nothing has been", () => {
    panel(EMPTY);
    expect(screen.getByText("No feedback yet")).toBeDefined();
    expect(screen.getByText(/nobody rated an ask sunny answer/i)).toBeDefined();
  });

  it("never prints a zero average", () => {
    /*
     * "0.0 stars" for a period whose feedback has all been dealt with reports a
     * catastrophe that did not happen, and it is the kind of figure somebody
     * screenshots.
     */
    const { container } = panel({
      ...EMPTY,
      queue: { pending: 0, in_review: 0, resolved: 4, dismissed: 0 },
    });
    expect(container.textContent).not.toContain("0.0");
  });
});
