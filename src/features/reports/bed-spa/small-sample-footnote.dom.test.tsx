// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SmallSampleFootnote } from "./small-sample-footnote";

/**
 * The live figures: Rejuve in one of the salons in view against 69 peers,
 * Ovation in two against 39, and four equipment types sampled across ten to
 * fifteen salons.
 */
// No global RTL cleanup is configured in this project, so each case unmounts
// its own tree — otherwise the previous test's list items are still in the DOM.
afterEach(cleanup);

const LIVE = [
  { key: "spa_rejuve", label: "Rejuve", ourSalonCount: 1, peerSalonCount: 69 },
  { key: "spa_ovation", label: "Ovation", ourSalonCount: 2, peerSalonCount: 39 },
  { key: "spa_beauty_shaper", label: "Beauty Shaper", ourSalonCount: 10, peerSalonCount: 124 },
  { key: "spa_massage_chair", label: "Massage Chair", ourSalonCount: 14, peerSalonCount: 121 },
  { key: "spa_hydromassage", label: "Hydromassage", ourSalonCount: 15, peerSalonCount: 197 },
  { key: "spa_poly_rlt", label: "Poly RLT", ourSalonCount: 15, peerSalonCount: 200 },
];

describe("the small-sample qualification is readable without hovering", () => {
  it("names each qualified equipment type in visible text", () => {
    render(<SmallSampleFootnote rows={LIVE} />);

    // Present as TEXT, not as a title attribute nobody can reach on a phone.
    expect(screen.getByText(/Only 1 salon in this report/)).toBeTruthy();
    expect(screen.getByText(/Only 2 salons in this report/)).toBeTruthy();
    expect(screen.getByText("Rejuve:")).toBeTruthy();
    expect(screen.getByText("Ovation:")).toBeTruthy();
  });

  it("does not claim a company-wide footprint from the salons in view", () => {
    /*
     * On a one-salon Wornall report "Only 1 salon of ours has this equipment"
     * stated a fact about the company that the page had no basis for. The
     * sentence has to be true on a fifteen-salon page and a one-salon page
     * alike.
     */
    render(<SmallSampleFootnote rows={LIVE} />);

    expect(screen.queryByText(/of ours/)).toBeNull();
    // One note per qualified equipment type, not one blanket sentence.
    const notes = screen.getAllByRole("listitem");
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note.textContent).toContain("rather than a company-wide result");
    }
  });

  it("says nothing about the adequately sampled equipment", () => {
    render(<SmallSampleFootnote rows={LIVE} />);

    for (const label of ["Beauty Shaper:", "Massage Chair:", "Hydromassage:", "Poly RLT:"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("renders nothing at all when every comparison is well sampled", () => {
    const { container } = render(
      <SmallSampleFootnote rows={LIVE.filter((row) => row.ourSalonCount > 2)} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
