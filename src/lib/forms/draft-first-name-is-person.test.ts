import { afterEach, describe, expect, it, vi } from "vitest";

import { draftFacts, leftOutLine, missingFacts } from "./draft-consistency";

/*
 * DRAFT_FIRST_NAME_IS_PERSON_ENABLED (QA's r36 live check on Ask Sunny, 12 Nov 2026; names invented): "create a written
 * CA for Odalys Pemberley, she was 20 minutes late on 11/10, no action plan", drafted "On November 10, 2026, Odalys
 * arrived 20 minutes late", said "The draft left out Pemberley in Observation of Offense".
 */
const NOTES = "create a written CA for Odalys Pemberley, she was 20 minutes late on 11/10, no action plan";
const missingNames = (observation: string) =>
  missingFacts({ observation }, ["observation"], draftFacts({ employeeName: "Odalys Pemberley", notes: NOTES, today: "2026-11-12" }))
    .filter((fact) => fact.kind === "name")
    .map((fact) => fact.shown);

describe("DRAFT_FIRST_NAME_IS_PERSON", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on: her first name alone names her", () => {
    vi.stubEnv("DRAFT_FIRST_NAME_IS_PERSON_ENABLED", "true");
    expect(missingNames("On November 10, 2026, Odalys arrived 20 minutes late.")).toEqual([]);
  });

  it("on: her last name alone names her too", () => {
    vi.stubEnv("DRAFT_FIRST_NAME_IS_PERSON_ENABLED", "true");
    expect(missingNames("On November 10, 2026, Ms. Pemberley arrived 20 minutes late.")).toEqual([]);
  });

  it("on: no word of her name is said as her whole name", () => {
    vi.stubEnv("DRAFT_FIRST_NAME_IS_PERSON_ENABLED", "true");
    const missing = missingNames("On November 10, 2026, the employee arrived 20 minutes late.");
    expect(missing).toEqual(["Odalys Pemberley"]);
    expect(leftOutLine([{ kind: "name", shown: missing[0]!, in: () => false }], ["Observation of Offense"])).toBe(
      "The draft left out Odalys Pemberley in Observation of Offense; tell me if you want it added.",
    );
  });

  it("off: the last name is reported, as before", () => {
    vi.stubEnv("DRAFT_FIRST_NAME_IS_PERSON_ENABLED", "");
    expect(missingNames("On November 10, 2026, Odalys arrived 20 minutes late.")).toEqual(["Pemberley"]);
  });
});
