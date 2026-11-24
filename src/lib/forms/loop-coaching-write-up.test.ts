import { describe, expect, it } from "vitest";

import { loopCoachingWriteUp } from "./loop-coaching-write-up";

/* Port of Ask Bubbles #1113 (cbfd1847; its QA's round 2, U25): the card's own line label is never part of the saved write-up. Invented person. */
const write = (details: string) =>
  loopCoachingWriteUp(
    { values: { coaching_details: details }, checked: {} },
    { detailsKey: "coaching_details", notes: "What happened: Odalys had under performance.", employeeName: "Odalys Partridge", typeOptions: [] },
  ).values.coaching_details;

describe("a loop coaching write-up never carries the card's own line labels", () => {
  it("drops \"What happened:\" from the Observed line and keeps its text (U25's saved Details)", () => {
    expect(write("Observed:\nWhat happened: Odalys had under performance.")).toBe("Observed:\nOdalys had under performance.");
  });

  it("drops any card line label at the start of a section line, in any section", () => {
    expect(write("Observed:\nOdalys had under performance.\n\nExpectation:\nDate: 11/12/26 Odalys is expected to meet her goals.")).toBe(
      "Observed:\nOdalys had under performance.\n\nExpectation:\n11/12/26 Odalys is expected to meet her goals.",
    );
  });

  it("control: the same words inside a sentence stay", () => {
    const details = "Observed:\nOdalys told me what happened: the register was short.";
    expect(write(details)).toBe(details);
  });
});
