// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KnowledgeCorpusNote } from "./corpus-note";

afterEach(cleanup);

/**
 * THE 15 SEPTEMBER PRODUCTION QA: the live Knowledge screen showed 57 documents
 * (56 indexed, 1 failed) underneath a note calling the corpus "seeded", saying
 * it "mirrors" the real one, and describing sync as absent "in this prototype".
 * Those are facts about the demo build, and over a customer's own library they
 * read as "your content is not real".
 */
describe("the seeded-corpus note", () => {
  it("says nothing in a live deployment", () => {
    const { container } = render(<KnowledgeCorpusNote live />);
    expect(container.innerHTML).toBe("");
  });

  it("still explains the seeded corpus in the demo build", () => {
    render(<KnowledgeCorpusNote live={false} />);

    expect(screen.getByText("About this corpus")).toBeTruthy();
    expect(screen.getByText(/seeded set mirrors the focused corpus/)).toBeTruthy();
  });

  it("keeps the prototype wording out of live mode entirely", () => {
    const { container } = render(<KnowledgeCorpusNote live />);
    for (const word of ["seeded", "prototype", "Woven", "SharePoint"]) {
      expect(container.textContent ?? "").not.toContain(word);
    }
  });
});
