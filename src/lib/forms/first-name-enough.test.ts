import { afterEach, describe, expect, it, vi } from "vitest";

import { draftFacts, missingFacts } from "./draft-consistency";

/**
 * FIRST_NAME_ENOUGH_ENABLED (ported from Ask Bubbles; QA's live round 17b, 10 Nov 2026): "The draft left out <surname>
 * in Details of Coaching" while Details named the employee by first name. The people are invented.
 */
afterEach(() => vi.unstubAllEnvs());

describe("FIRST_NAME_ENOUGH_ENABLED: a first name in Coaching Details is the name", () => {
  const facts = () =>
    draftFacts({ employeeName: "Ysolde Brackwater", notes: "create a coaching form for Ysolde Brackwater, she missed the monthly meeting on 11/9/26", today: "2026-11-10" });
  const values = { coaching_details: "Observed:\nYsolde missed the monthly meeting on 11/9/26." };

  it("on: the surname is not reported missing", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    expect(missingFacts(values, ["coaching_details"], facts())).toEqual([]);
  });

  it("on: Details that name nobody still report the name", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    const missing = missingFacts({ coaching_details: "Observed:\nThe employee missed the monthly meeting on 11/9/26." }, ["coaching_details"], facts());
    expect(missing.map((fact) => fact.shown)).toEqual(["Ysolde", "Brackwater"]);
  });

  it("on: a Corrective Action's Observation still reports the dropped surname", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "true");
    const ca = draftFacts({ employeeName: "Ysolde Brackwater", notes: "Create a Corrective Action for Ysolde Brackwater, she was late to open on 10-20-26", today: "2026-11-10" });
    expect(missingFacts({ observed_expectation: "Ysolde was late to open on 10-20-26." }, ["observed_expectation"], ca).map((fact) => fact.shown)).toEqual(["Brackwater"]);
  });

  it("off: as before, the surname is reported", () => {
    vi.stubEnv("FIRST_NAME_ENOUGH_ENABLED", "false");
    expect(missingFacts(values, ["coaching_details"], facts()).map((fact) => fact.shown)).toEqual(["Brackwater"]);
  });
});
