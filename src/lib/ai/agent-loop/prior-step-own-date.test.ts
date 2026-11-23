import { describe, expect, it } from "vitest";

import { priorActionsProblem, priorActionsSplit } from "./tools";

/*
 * Port of Ask Bubbles #1045 (its QA's live round-2 re-run, 22 Nov 2026, U09; the person is invented): the Verbal CA's own
 * date is the incident's date, and the step was left off as "this incident's date, not an earlier step's".
 */
const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Ysolde violated care and cleaning of facilities policy";

describe("a prior step dated by the manager on the incident's day is that step's date (U09)", () => {
  it("\"Verbal CA 11-1-2026\": both stated steps stay on the card", () => {
    expect(priorActionsProblem("Signed JBA Policy Manual 1/1/2026; Verbal Warning 11/1/2026", T2, "2026-11-01")).toBeNull();
    expect(priorActionsSplit("Signed JBA Policy Manual 1/1/2026; Verbal Warning 11/1/2026", T2, "2026-11-01").kept).toBe("Signed JBA Policy Manual 1/1/2026; Verbal Warning 11/1/2026");
  });
  it("control: the incident's date copied onto a step the manager never dated is still left off", () => {
    expect(priorActionsProblem("Written Warning 11/1/2026", "she had a written warning before. On 11-1-26 Ysolde violated care and cleaning of facilities policy", "2026-11-01")?.reason).toMatch(/this incident's date/);
  });
});
