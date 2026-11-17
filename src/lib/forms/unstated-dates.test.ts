import { describe, expect, it } from "vitest";

import { withoutUnstatedDates } from "./form-date-grounding";

/* Pau's ruling via QA (17 Nov 2026): the drafter never writes a date the manager did not state. Invented names. */
describe("withoutUnstatedDates", () => {
  const keys = new Set(["observation", "action_plan"]);
  const today = "2026-11-16";
  it("takes out a date the manager never stated, with its lead-in (c094's shape)", () => {
    const out = withoutUnstatedDates({ observation: "Observed:\nOn November 16, 2026, Remy did not complete the 10-minute sanitization.\n\nExpectation:\nRemy completes it every shift." }, keys, "ca for remy calder for not doing the 10 minute sanitization", today);
    expect(out.values.observation).toBe("Observed:\nRemy did not complete the 10-minute sanitization.\n\nExpectation:\nRemy completes it every shift.");
    expect(out.removed).toEqual(["November 16, 2026"]);
  });
  it("takes out a date inside a sentence with its preposition", () => {
    expect(withoutUnstatedDates({ observation: "Remy was late on October 22, 2026." }, keys, "ca for remy, late again", today).values.observation).toBe("Remy was late.");
  });
  it("keeps a date the manager stated, in any spelling, and a day they named", () => {
    const stated = { observation: "Remy was late to work on November 14, 2026." };
    expect(withoutUnstatedDates(stated, keys, "ca for remy calder, she was late to work on 11/14", today)).toEqual({ values: stated, removed: [] });
    const todayWord = { observation: "On November 16, 2026, Remy was late." };
    expect(withoutUnstatedDates(todayWord, keys, "ca for remy, late today", today).removed).toEqual([]);
  });
  it("leaves fields outside the keys and text with no date alone", () => {
    const plain = { observation: "Remy was late.", policy_language: "Source: JBA Policy Manual, p. 14" };
    expect(withoutUnstatedDates(plain, keys, "ca for remy", today)).toEqual({ values: plain, removed: [] });
  });
});
