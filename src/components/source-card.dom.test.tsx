// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SourceCardList } from "./source-card";
import type { SourceCitation } from "@/types";

/**
 * ============================================================================
 * ONE NUMBER, AND IT SAYS WHAT IT COUNTS
 * ============================================================================
 *
 * THE FEEDBACK THIS PINS. The list rendered its heading AND an unlabelled badge
 * holding `citations.length`, directly above cards numbered 1, 2, 3. A manager
 * read "Sources", then a floating "3", then a list starting at 1, and reasonably
 * asked what the 3 was.
 *
 * It was worse when several excerpts came from one document: the heading said
 * "Source" and the badge said "3" — two numbers, different units, neither
 * labelled, side by side.
 *
 * PRESENTATION ONLY. Retrieval, ranking, citation content and the per-card
 * numbering are untouched; the cards below are still numbered per excerpt,
 * which is why the heading now names its units.
 */

function citation(overrides: Partial<SourceCitation> = {}): SourceCitation {
  return {
    documentId: "doc-1",
    documentTitle: "Attendance Policy",
    locator: "Page 4",
    excerpt: "Employees are expected to be ready at their scheduled start time.",
    category: "policies",
    relevance: 0.91,
    ...overrides,
  } as SourceCitation;
}

afterEach(cleanup);

describe("the source list shows no unexplained count", () => {
  it("renders no bare number beside the heading", () => {
    // I. The stray "3". Three excerpts, one document — the exact shape that
    // produced a heading reading "Source" next to a badge reading "3".
    const { container } = render(
      <SourceCardList
        citations={[
          citation({ locator: "Page 4" }),
          citation({ locator: "Page 7" }),
          citation({ locator: "Page 9" }),
        ]}
        title="Source — 3 excerpts"
      />,
    );

    /*
     * The precise property, rather than a shape assertion that a refactor
     * could satisfy by accident: every bare "3" in the output must be a CARD
     * ORDINAL, which lives inside that card's link. A count sitting beside the
     * heading is outside every link, which is exactly what made it stray.
     */
    const bareThrees = Array.from(container.querySelectorAll("*")).filter(
      (node) => node.textContent?.trim() === "3" && node.children.length === 0,
    );
    expect(bareThrees.length).toBeGreaterThan(0); // the third card's ordinal
    for (const node of bareThrees) {
      expect(node.closest("a"), "a bare count outside a source card").not.toBeNull();
    }

    const heading = screen.getByText("Source — 3 excerpts");
    expect(heading.closest("a")).toBeNull();
  });

  it("keeps the count only where it is labelled", () => {
    render(
      <SourceCardList citations={[citation(), citation({ locator: "Page 7" })]} title="Source — 2 excerpts" />,
    );
    expect(screen.getByText("Source — 2 excerpts")).toBeTruthy();
  });

  it("renders nothing at all when there are no citations", () => {
    const { container } = render(<SourceCardList citations={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("the citations themselves are unchanged", () => {
  it("still numbers every card, from one, in order", () => {
    // J. Removing the badge must not have disturbed the per-excerpt numbering.
    render(
      <SourceCardList
        citations={[
          citation({ locator: "Page 4" }),
          citation({ locator: "Page 7" }),
          citation({ locator: "Page 9" }),
        ]}
      />,
    );

    for (const ordinal of ["1", "2", "3"]) {
      expect(screen.getByText(ordinal)).toBeTruthy();
    }
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("4")).toBeNull();
  });

  it("still renders one card per excerpt, linked to its document", () => {
    render(
      <SourceCardList
        citations={[
          citation({ locator: "Page 4" }),
          citation({ documentId: "doc-2", documentTitle: "Coaching Standards", locator: "Page 2" }),
        ]}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/knowledge?document=doc-1");
    expect(links[1]!.getAttribute("href")).toBe("/knowledge?document=doc-2");
  });

  it("still shows each excerpt's own locator", () => {
    render(
      <SourceCardList citations={[citation({ locator: "Page 4" }), citation({ locator: "Page 7" })]} />,
    );
    expect(screen.getByText(/Page 4/)).toBeTruthy();
    expect(screen.getByText(/Page 7/)).toBeTruthy();
  });
});
