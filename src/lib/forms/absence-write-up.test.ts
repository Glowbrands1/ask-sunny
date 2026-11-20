import { describe, expect, it } from "vitest";

import { absenceWriteUp } from "./absence-write-up";

/*
 * QA's production audit (20 Nov 2026, item 21; #6cad15df, the person invented): "did not come into her scheduled shift
 * today at 9:30" saved "Expectation: <P> is expected to arrive on time and be ready to work at the start of the scheduled
 * shift". With the card's record saying absence, no sentence of the write-up calls it lateness.
 */
const LIVE =
  "Observed:\nRemy did not come into the scheduled shift on November 16, 2026 at 9:30.\n\nExpectation:\nRemy is expected to arrive on time and be ready to work at the start of the scheduled shift.\n\nGoing Forward:\nRemy will arrive on time for every scheduled shift.";
const OPTIONS = { employeeName: "Remy Calder", cardAccount: "Remy did not come into the scheduled shift today at 9:30." };

describe("absenceWriteUp", () => {
  it("rewrites the Expectation and Going Forward of QA's #6cad15df as a missed shift, keeping Observed", () => {
    const { values, changed } = absenceWriteUp({ observation: LIVE }, ["observation"], OPTIONS);
    expect(changed).toBe(true);
    expect(values.observation).toBe(
      "Observed:\nRemy did not come into the scheduled shift on November 16, 2026 at 9:30.\n\nExpectation:\nRemy is expected to come in for every scheduled shift.\n\nGoing Forward:\nRemy will come in for every scheduled shift.",
    );
  });

  it("drops a lateness sentence from Observed, and an Observed left empty is the card's account", () => {
    const { values } = absenceWriteUp({ observation: "Observed: Remy was late to the shift.\nExpectation: Remy is expected to come to every shift." }, ["observation"], OPTIONS);
    expect(values.observation).toBe("Observed:\nRemy did not come into the scheduled shift today at 9:30.\nExpectation: Remy is expected to come to every shift.");
  });

  it("leaves a write-up with no lateness, and keys it was not given, unchanged", () => {
    const plain = "Observed:\nRemy did not come in.\n\nExpectation:\nRemy is expected to work every scheduled shift.";
    expect(absenceWriteUp({ observation: plain, other: "Remy arrived late." }, ["observation"], OPTIONS)).toEqual({ values: { observation: plain, other: "Remy arrived late." }, changed: false });
  });
});
