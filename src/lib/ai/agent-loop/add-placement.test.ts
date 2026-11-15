import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { addPlacement } = await import("./tools");

/* Batch G (G3, QA's live test with a form open): "she also left 20 minutes early" went in the middle and rewrote another sentence. */
const OLD = "Observed: Remy Calder was 20 minutes late on 11/12.\nExpectation: She is expected to arrive on time for every scheduled shift.\nGoing Forward: Remy will clock in by her start time.";

describe("where an added fact went", () => {
  it("the live bug: between Expectation and Going Forward, with \"She is expected\" rewritten", () => {
    const saved = "Observed: Remy Calder was 20 minutes late on 11/12.\nExpectation: Remy Calder is expected to arrive on time for every scheduled shift.\nShe also left 20 minutes early.\nGoing Forward: Remy will clock in by her start time.";
    expect(addPlacement(OLD, saved)).toEqual({ changed: ["She is expected to arrive on time for every scheduled shift."], misplaced: true });
  });
  it("at the end of the Observed section, every other sentence word for word: nothing to fix", () => {
    const saved = "Observed: Remy Calder was 20 minutes late on 11/12. She also left 20 minutes early.\nExpectation: She is expected to arrive on time for every scheduled shift.\nGoing Forward: Remy will clock in by her start time.";
    expect(addPlacement(OLD, saved)).toEqual({ changed: [], misplaced: false });
  });
  it("with no sections, an added sentence goes after every old one", () => {
    expect(addPlacement("She was late on 11/12.", "She was late on 11/12. She also left 20 minutes early.")).toEqual({ changed: [], misplaced: false });
    expect(addPlacement("She was late on 11/12.", "She also left 20 minutes early. She was late on 11/12.")).toEqual({ changed: [], misplaced: true });
  });
});
