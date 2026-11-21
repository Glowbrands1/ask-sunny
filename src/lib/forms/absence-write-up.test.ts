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

/*
 * f082 (QA's live test, 20 Nov 2026, conv_mwpgp5pq29vc3jk): "ca for Test Testy, we do not do extra cleaning after hours,
 * she left early 11/18" was written up as lateness. Leaving early is its own kind: the write-up speaks of staying for the
 * full shift, never of arriving on time.
 */
describe("absenceWriteUp, left early", () => {
  const LEFT_EARLY =
    "Observed:\nTest left her shift early on 11/18. Test was late to finish her duties.\n\nExpectation:\nTest is expected to arrive on time for all scheduled shifts.\n\nGoing Forward:\nTest will arrive on time and remain for every scheduled shift.";
  const OPTIONS_LEFT = { employeeName: "Test Testy", cardAccount: "Test left early on 11/18.", kind: "left_early" as const };

  it("speaks of staying for the full shift in Expectation and Going Forward, and drops lateness from Observed", () => {
    const { values, changed } = absenceWriteUp({ observation: LEFT_EARLY }, ["observation"], OPTIONS_LEFT);
    expect(changed).toBe(true);
    expect(values.observation).toBe(
      "Observed:\nTest left her shift early on 11/18.\n\nExpectation:\nTest is expected to stay for the full scheduled shift.\n\nGoing Forward:\nTest will stay for the full scheduled shift.",
    );
  });
});
