import { afterEach, describe, expect, it, vi } from "vitest";

import { applyOptionalPriorCoaching } from "./prior-coaching-optional";
import { priorCoachingManagerText, withoutDeniedPriorCoaching } from "./prior-coaching-denial";

/**
 * QA, 5 Nov 2026 (replay case nov5-coding3-prior-coaching-none-on-file): "…
 * There's no prior coaching on file." was answered "Prior coaching note: prior
 * coaching on file." Every person is invented.
 */

const TODAY = "2026-11-05";
const HELD = "You'll set any prior coaching or corrective action on the form — I won't guess at it.\n\nCreate the draft here when you're ready.";
const HER =
  "I need to write up Odessa Quarrington with a written warning for leaving the front desk unattended for 30 minutes on 10/22. There's no prior coaching on file.";

function note(turns: string[]): string {
  return applyOptionalPriorCoaching(HELD, { enabled: true, records: [], managerText: priorCoachingManagerText(turns, TODAY) });
}

afterEach(() => vi.unstubAllEnvs());

describe("PRIOR_COACHING_DENIAL_ENABLED", () => {
  it("off: the turns are joined as before, and her sentence still reads as on file (the reported bug)", () => {
    vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "");
    expect(priorCoachingManagerText([HER, "coached verbally in July"], TODAY)).toBe(`${HER}\ncoached verbally in July`);
    expect(note([HER])).toContain("Prior coaching note: prior coaching on file.");
  });

  describe("on", () => {
    it("her exact words: never 'prior coaching on file'; the line stays blank", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      const text = note([HER]);
      expect(text).not.toMatch(/prior coaching on file/i);
      expect(text).toContain("no note was given, so the line stays blank");
      // The rest of what she said is untouched.
      expect(withoutDeniedPriorCoaching(HER, TODAY)).toBe(
        "I need to write up Odessa Quarrington with a written warning for leaving the front desk unattended for 30 minutes on 10/22.",
      );
    });

    it("'no prior coaching except a verbal warning on 7/14' keeps the dated step", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      const text = note(["CA for Odessa Quarrington, front desk unattended. no prior coaching except a verbal warning on 7/14"]);
      expect(text).toContain("Prior coaching note: prior coaching except a verbal warning on 7/14. No finalized record was required.");
    });

    it("'no prior coaching except a verbal in July' names the July verbal and gives it no day", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      const text = note(["CA for Odessa Quarrington, front desk unattended. no prior coaching except a verbal in July"]);
      expect(text).toContain("Prior coaching note: prior coaching: verbal in July. No finalized record was required.");
      expect(text).not.toMatch(/\b0?7\/\d{1,2}\b/);
      expect(text).not.toMatch(/\bno note was given\b/);
    });

    it("'no prior coaching except a verbal warning' (no time) keeps the verbal warning: visible, never dropped (QA, 5 Nov 2026)", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      const text = note(["CA for Odessa Quarrington, front desk unattended. no prior coaching except a verbal warning"]);
      expect(text).toContain("Prior coaching note: prior coaching: verbal warning. No finalized record was required.");
      expect(text).not.toMatch(/\bno note was given\b/);
    });

    /*
     * Expectation changed on purpose: QA first accepted this as a visible note
     * (5 Nov 2026); Pau's decision B, 6 Nov 2026 (QA): a step inside the
     * negation is part of the denial, so the line stays blank.
     */
    it("'no prior coaching or warnings in the last 6 months' leaves the line blank (Pau's decision B, 6 Nov 2026)", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      const text = note(["CA for Odessa Quarrington, front desk unattended. no prior coaching or warnings in the last 6 months"]);
      expect(text).not.toMatch(/Prior coaching note:/);
      expect(text).toContain("no note was given, so the line stays blank");
    });

    it("a step inside the negation is denied with it: 'no write-ups or warnings', 'never been warned, no verbal or written'", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      expect(withoutDeniedPriorCoaching("She was late. No prior coaching, no write-ups or warnings.", TODAY)).toBe("She was late.");
      expect(withoutDeniedPriorCoaching("She was late. She's never been warned, no verbal or written.", TODAY)).toBe("She was late.");
    });

    it("'other than' and 'but' keep the step like 'except' (Pau's decision B)", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      expect(note(["no prior coaching other than a verbal warning"])).toContain("Prior coaching note: prior coaching: verbal warning.");
      expect(note(["no prior coaching but a verbal in July"])).toContain("Prior coaching note: prior coaching: verbal in July.");
    });

    it("'coached verbally in July' is unchanged", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      expect(priorCoachingManagerText(["coached verbally in July"], TODAY)).toBe("coached verbally in July");
      expect(note(["coached verbally in July"])).toContain("Prior coaching note: coached verbally in July");
    });

    it("a denial in an earlier turn is handled too; other turns are kept", () => {
      vi.stubEnv("PRIOR_COACHING_DENIAL_ENABLED", "true");
      expect(priorCoachingManagerText(["There's no prior coaching on file.", "front desk, 10/22"], TODAY)).toBe("\nfront desk, 10/22");
    });
  });
});
