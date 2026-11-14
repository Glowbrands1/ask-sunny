import { afterEach, describe, expect, it, vi } from "vitest";

import { statesFirstOccurrence } from "./corrective-action-intake";

/* NEGATED_FIRST_TIME_NOT_NONE (ported from the sibling app: Gate-Bubbles-3's #888 follow-up, QA 14 Nov 2026), in the gate's wordings. */
afterEach(() => vi.unstubAllEnvs());
const on = (value: boolean) => vi.stubEnv("NEGATED_FIRST_TIME_NOT_NONE_ENABLED", value ? "true" : "");

const NEGATED = [
  "not her first time",
  "this isn't the first time she's been late",
  "this isn’t the first time she's been late",
  "it wasn't his first offense",
  "this is not her first incident",
];

describe("NEGATED_FIRST_TIME_NOT_NONE", () => {
  it("off: a negated first time reads as a first occurrence (the defect)", () => {
    on(false);
    for (const said of NEGATED) expect(statesFirstOccurrence(said), said).toBe(true);
  });

  it("on: a negated first time never reads as a first occurrence", () => {
    on(true);
    for (const said of NEGATED) expect(statesFirstOccurrence(said), said).toBe(false);
  });

  it("on: a first time said plainly still does", () => {
    on(true);
    for (const said of ["this is her first time", "first time she's been late", "first offense", "no prior write-ups", "she has never been written up"]) {
      expect(statesFirstOccurrence(said), said).toBe(true);
    }
  });
});
