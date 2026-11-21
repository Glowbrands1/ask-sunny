import { describe, expect, it } from "vitest";

import { loopWriteUpSections } from "./loop-write-up-sections";

/* QA's live test of #1154 (20 Nov 2026, f075; the tester's invented "Test Testy" is Remy Calder here). */
describe("loopWriteUpSections (f075)", () => {
  it("moves the expectation out of Going Forward into the empty Expectation, with the first name", () => {
    const saved =
      "Observed:\nRemy was not in dress code, was not wearing a name tag, and did not have a goal sheet.\n\nExpectation:\n\nGoing Forward:\nRemy should arrive in full dress code. Remy Calder is expected to comply with the current Sun Tan City requirements.";
    expect(loopWriteUpSections(saved, "Remy Calder")).toEqual({
      text: "Observed:\nRemy was not in dress code, was not wearing a name tag, and did not have a goal sheet.\n\nExpectation:\nRemy is expected to comply with the current Sun Tan City requirements.\n\nGoing Forward:\nRemy should arrive in full dress code.",
      changed: true,
    });
  });

  it("adds a missing Expectation after Observed, built from Going Forward's plan, and keeps the plan", () => {
    const { text } = loopWriteUpSections("Observed:\nRemy was not in dress code.\n\nGoing Forward:\nRemy will wear approved attire every shift.", "Remy Calder");
    expect(text).toBe("Observed:\nRemy was not in dress code.\n\nExpectation:\nRemy is expected to wear approved attire every shift.\n\nGoing Forward:\nRemy will wear approved attire every shift.");
  });

  it("drops a Going Forward the moved sentence leaves empty", () => {
    const { text } = loopWriteUpSections("Observed:\nRemy was late.\n\nExpectation:\n\nGoing Forward:\nRemy Calder is expected to arrive on time.", "Remy Calder");
    expect(text).toBe("Observed:\nRemy was late.\n\nExpectation:\nRemy is expected to arrive on time.");
  });

  it("only swaps the full name when the Expectation is already filled, keeping the layout", () => {
    const drafted = "Observed: Remy Calder was late.\nExpectation: Remy is expected to arrive on time.";
    expect(loopWriteUpSections(drafted, "Remy Calder")).toEqual({ text: "Observed: Remy was late.\nExpectation: Remy is expected to arrive on time.", changed: true });
    expect(loopWriteUpSections("Observed: Remy was late.\nExpectation: Remy is expected to arrive on time.", "Remy Calder").changed).toBe(false);
  });

  it("leaves text with no Observed shape, or no name, alone", () => {
    expect(loopWriteUpSections("Remy was late.", "Remy Calder")).toEqual({ text: "Remy was late.", changed: false });
    expect(loopWriteUpSections("Observed:\nX.\n\nExpectation:\n", null)).toEqual({ text: "Observed:\nX.\n\nExpectation:\n", changed: false });
  });
});
