import { afterEach, describe, expect, it, vi } from "vitest";

import { currentRequestTurns } from "@/lib/ai/remap-incident";

import { guardCoachingFraming } from "./coaching-framing";

/* Pau's scan, sf-s37 (7 Nov 2026): the live wording, people invented. */
const say = (name: string) =>
  `Can you create me a coaching document for ${name} for not hitting her numbers for the month of October. Please word it in a professional way. I need the policy attached as well.`;
const DRAFT = {
  values: { coaching_details: "Observed:\nTamsin did not meet her sales numbers for the month of October.\n\nExpectation:\nTamsin is expected to meet assigned monthly sales targets." },
  checked: { coaching_type: ["underperformance"] },
};

afterEach(() => vi.unstubAllEnvs());

describe("COACHING_OBSERVED_KEPT_ENABLED", () => {
  it("off: the Observed section and the Underperformance tick are struck (the live forms)", () => {
    const guarded = guardCoachingFraming(DRAFT, say("Tamsin Holt"));
    expect(guarded.values.coaching_details).toBe("Expectation:\nTamsin is expected to meet assigned monthly sales targets.");
    expect(guarded.underperformanceRefused).toBe(true);
  });

  it("on: the draft is left as written", () => {
    vi.stubEnv("COACHING_OBSERVED_KEPT_ENABLED", "true");
    const guarded = guardCoachingFraming(DRAFT, say("Tamsin Holt"));
    expect(guarded.values).toEqual(DRAFT.values);
    expect(guarded.checked).toEqual(DRAFT.checked);
  });

  it("on: praise is still not written up as a shortfall", () => {
    vi.stubEnv("COACHING_OBSERVED_KEPT_ENABLED", "true");
    const praise = { values: { coaching_details: "Observed:\nTamsin did not meet resistance.\n\nExpectation:\nKeep it up." }, checked: { coaching_type: ["underperformance"] } };
    expect(guardCoachingFraming(praise, "coaching for Tamsin Holt, great job hitting her numbers this month").underperformanceRefused).toBe(true);
  });
});

describe("POLITE_REQUEST_OWN_TURNS_ENABLED", () => {
  const turns = [say("Tamsin Holt"), say("Tilly Marsh")];

  it("off: \"Can you create me …\" is not a request, so every turn is the second card's", () => {
    expect(currentRequestTurns(turns, "Tilly Marsh")).toEqual(turns);
  });

  it("on: the second request starts its own card", () => {
    vi.stubEnv("POLITE_REQUEST_OWN_TURNS_ENABLED", "true");
    expect(currentRequestTurns(turns, "Tilly Marsh")).toEqual([turns[1]]);
    expect(currentRequestTurns([...turns, say("Corwin Hale")], "Corwin Hale")).toEqual([say("Corwin Hale")]);
  });

  it("on: a question that is not a request does not start one", () => {
    vi.stubEnv("POLITE_REQUEST_OWN_TURNS_ENABLED", "true");
    const chat = [say("Tamsin Holt"), "can you make it sound more professional?"];
    expect(currentRequestTurns(chat, "Tamsin Holt")).toEqual(chat);
  });
});
