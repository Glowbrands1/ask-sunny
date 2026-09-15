import { describe, expect, it } from "vitest";

import {
  PPTA_ASSISTANT_RULES,
  PPTA_COMBINATION_RULE,
  PPTA_DEFINITION,
  PPTA_EXPLANATION,
  PPTA_MIN_IMPLIED_PRODUCT_SALES,
  UNIQUE_PPTA_DEFINITION,
  combinePpta,
  computePpta,
  isPptaUnusable,
  pptaCoachability,
  pptaPlausibility,
  pptaPlausibilityNote,
} from "./ppta";

/**
 * The 14 September review settled a definition the app held three versions of:
 *
 *   "The Sales Totals page calls it money per transaction."
 *   "The employee framework calls it Product Productivity Average..."
 *   "The Bonus Viewer defines Unique PPTA as product sales divided by unique
 *    tanners."
 *   "The correct PPTA definition is product sales divided by total tans."
 *
 * These tests hold that definition, and the arithmetic that follows from it.
 */

describe("the definition is stated once and says what the business says", () => {
  it("is product sales over total tans", () => {
    expect(PPTA_DEFINITION).toBe("Product Sales ÷ Total Tans");
  });

  it("names and excludes the two definitions it replaced", () => {
    expect(PPTA_ASSISTANT_RULES).toContain("NOT money per transaction");
    expect(PPTA_ASSISTANT_RULES).toContain("Unique PPTA");
    expect(UNIQUE_PPTA_DEFINITION).toBe("Product Sales ÷ Unique Tanners");
  });

  it("says plainly that it does not reconcile to Grand Total ÷ Tans", () => {
    expect(PPTA_EXPLANATION).toMatch(/does not reconcile to Grand Total/i);
    expect(PPTA_ASSISTANT_RULES).toMatch(/DOES NOT RECONCILE TO GRAND TOTAL/);
  });

  it("forbids both wrong ways of combining it", () => {
    expect(PPTA_COMBINATION_RULE).toMatch(/never sum ppta/i);
    expect(PPTA_COMBINATION_RULE).toMatch(/never take a plain mean/i);
  });
});

describe("computePpta", () => {
  it("divides product sales by total tans", () => {
    expect(computePpta(238, 100)).toBeCloseTo(2.38, 10);
  });

  it("returns null rather than zero when there is no denominator", () => {
    expect(computePpta(500, 0)).toBeNull();
    expect(computePpta(500, null)).toBeNull();
    expect(computePpta(null, 100)).toBeNull();
    expect(computePpta(500, -3)).toBeNull();
  });
});

describe("combining PPTA across salons weights by tans", () => {
  /*
   * Figures from the 09-02-2026 delivery, three salons. The plain mean is
   * $3.66; the correct combined figure is $2.23, because Liberty earns its
   * $1.00 over 251 tans while Omaha 144th earns its $6.74 over 46.
   */
  const THREE = [
    { ppta: 3.25, tans: 99 }, // KS Lawrence
    { ppta: 1, tans: 251 }, // MO Kansas City Liberty
    { ppta: 6.74, tans: 46 }, // NE Omaha 144th and Center
  ];

  it("is SUM(product sales) / SUM(tans)", () => {
    const combined = combinePpta(THREE);
    expect(combined.value).toBeCloseTo(882.79 / 396, 10);
    expect(combined.totalTans).toBe(396);
    expect(combined.contributingSalons).toBe(3);
    expect(combined.reason).toBeNull();
  });

  it("is not the plain mean", () => {
    const plainMean = THREE.reduce((sum, row) => sum + row.ppta, 0) / THREE.length;
    expect(plainMean).toBeCloseTo(3.663, 3);
    expect(combinePpta(THREE).value).not.toBeCloseTo(plainMean, 2);
  });

  it("is not the sum", () => {
    const sum = THREE.reduce((total, row) => total + row.ppta, 0);
    expect(combinePpta(THREE).value).not.toBeCloseTo(sum, 2);
  });

  it("agrees with dividing the reconstructed totals directly", () => {
    const productSales = THREE.reduce((total, row) => total + row.ppta * row.tans, 0);
    const tans = THREE.reduce((total, row) => total + row.tans, 0);
    expect(combinePpta(THREE).value).toBeCloseTo(computePpta(productSales, tans)!, 12);
  });

  it("excludes a salon missing either half, and says how many", () => {
    const combined = combinePpta([
      ...THREE,
      { ppta: 9.99, tans: null },
      { ppta: null, tans: 500 },
    ]);
    expect(combined.value).toBeCloseTo(882.79 / 396, 10);
    expect(combined.contributingSalons).toBe(3);
    expect(combined.excludedSalons).toBe(2);
  });

  it("refuses rather than returning zero when nothing can contribute", () => {
    const combined = combinePpta([{ ppta: null, tans: null }]);
    expect(combined.value).toBeNull();
    expect(combined.reason).toContain("total tans");
  });

  it("is unaffected by the order of the rows", () => {
    const forwards = combinePpta(THREE).value;
    const backwards = combinePpta([...THREE].reverse()).value;
    expect(forwards).toBeCloseTo(backwards!, 12);
  });
});

describe("implausible PPTA is flagged, never corrected", () => {
  it("flags the two values the review found in the live report", () => {
    // $0.00 — the one Sunny was ranking a salon last on.
    expect(pptaPlausibility(0)).toBe("non_positive");
    expect(isPptaUnusable(0)).toBe(true);

    /*
     * $0.19 is NOT flagged, and that distinction is deliberate. Under the
     * corrected definition nineteen cents of product per tan is a low figure
     * and a possible one; calling it unreadable would be the app deciding a
     * business question it has no evidence for. The review's own doubt about it
     * is answered by fixing the DEFINITION, not by suppressing the value.
     */
    expect(pptaPlausibility(0.19)).toBe("plausible");
    expect(isPptaUnusable(0.19)).toBe(false);
  });

  it("flags a negative and an absurd value", () => {
    expect(pptaPlausibility(-1)).toBe("non_positive");
    expect(pptaPlausibility(5000)).toBe("implausibly_high");
    expect(isPptaUnusable(5000)).toBe(true);
  });

  it("treats a missing figure as not reported, which is not a data issue", () => {
    expect(pptaPlausibility(null)).toBe("not_reported");
    expect(isPptaUnusable(null)).toBe(false);
    expect(pptaPlausibilityNote(null)).toBeNull();
  });

  it("leaves ordinary figures alone", () => {
    for (const value of [0.43, 1, 2.38, 3.54, 6.74]) {
      expect(pptaPlausibility(value)).toBe("plausible");
      expect(isPptaUnusable(value)).toBe(false);
      expect(pptaPlausibilityNote(value)).toBeNull();
    }
  });

  it("explains a flagged value without inventing a corrected one", () => {
    const note = pptaPlausibilityNote(0)!;
    /*
     * THE NOTE NAMES BOTH READINGS AND PICKS NEITHER. A reported zero was
     * traced to a real one: NE Omaha 132nd and Maple on 2026-09-12 took 74
     * tans and its month-to-date product sales moved by -$5.83 that day, so
     * the source floored a net-negative product day at zero. A note calling
     * every zero a parsing problem would have been wrong about that salon, and
     * one calling every zero a real trading day would be wrong about a missing
     * delivery. The figure cannot distinguish them, and the note says so.
     */
    expect(note).toMatch(/real trading day/i);
    expect(note).toMatch(/gap in the delivery/i);
    expect(note).toMatch(/cannot tell you which/i);
    expect(note).toMatch(/not used to rank/i);
    // No corrected figure anywhere in the sentence.
    expect(note).not.toMatch(/should be|actually is|the correct figure/i);
  });

  it("tells the assistant not to coach or rank from one", () => {
    expect(PPTA_ASSISTANT_RULES).toMatch(/Do not coach from it/);
    expect(PPTA_ASSISTANT_RULES).toMatch(/do not rank the salon on it/);
    expect(PPTA_ASSISTANT_RULES).toMatch(/do not estimate what the value "should" be/);
  });
});

/**
 * ============================================================================
 * ONE COACHABILITY VERDICT, READ BY THE PAGE AND BY THE ASSISTANT
 * ============================================================================
 *
 * THE 15 SEPTEMBER LIVE ACCEPTANCE: Ask Sunny asked a manager to verify Omaha
 * 144th's $0.05 before coaching, while the Sales Totals narrative on the same
 * screen called the same figure the coachable end of a spread. `isPptaUnusable`
 * bounds only the VALUE — zero and a hundred — so $0.05 passed it, and the
 * assistant was improvising a second judgement the page could not see.
 *
 * The figures below are the 13 September delivery's own.
 */
describe("pptaCoachability", () => {
  it("refuses the case the live review named: $0.05 over 33 tans", () => {
    const verdict = pptaCoachability({ value: 0.05, totalTans: 33 });
    expect(verdict.coachable).toBe(false);
    expect(verdict.impliedProductSales).toBeCloseTo(1.65, 10);
    expect(verdict.note).toContain("$1.65");
    expect(verdict.note).toContain("Check the day's product sales before coaching");
  });

  it("leaves a genuinely thin but real day coachable", () => {
    // St Joseph: $0.11 over 160 tans is $17.60 — low attachment, and a finding.
    expect(pptaCoachability({ value: 0.11, totalTans: 160 }).coachable).toBe(true);
    // Manhattan: $0.25 over 108 tans is $27.00.
    expect(pptaCoachability({ value: 0.25, totalTans: 108 }).coachable).toBe(true);
  });

  it("is about the numerator, not the sample size", () => {
    /*
     * 33 tans is not itself the signal — Lawrence ran 48 and Lincoln O Street
     * 48, both with ordinary rates. A rule keyed on tan count would flag honest
     * small days and miss the one that mattered.
     */
    expect(pptaCoachability({ value: 1.04, totalTans: 48 }).coachable).toBe(true);
    expect(pptaCoachability({ value: 1.39, totalTans: 33 }).coachable).toBe(true);
  });

  it("keeps the existing value bounds as the stronger signal", () => {
    expect(pptaCoachability({ value: 0, totalTans: 500 }).coachable).toBe(false);
    expect(pptaCoachability({ value: -1, totalTans: 500 }).coachable).toBe(false);
    expect(pptaCoachability({ value: 250, totalTans: 500 }).coachable).toBe(false);
  });

  it("does not guess when the denominator is unavailable", () => {
    /*
     * A caller that cannot recover the tans gets the value-bounds verdict alone
     * — the answer this module gave before the second axis existed — rather
     * than a fabricated one.
     */
    const verdict = pptaCoachability({ value: 0.05, totalTans: null });
    expect(verdict.coachable).toBe(true);
    expect(verdict.impliedProductSales).toBeNull();
  });

  it("treats an absent PPTA as nothing to coach from", () => {
    expect(pptaCoachability({ value: null, totalTans: 100 }).coachable).toBe(false);
  });

  it("states the floor to the assistant, so it stops improvising its own", () => {
    expect(PPTA_ASSISTANT_RULES).toContain(String(PPTA_MIN_IMPLIED_PRODUCT_SALES));
    expect(PPTA_ASSISTANT_RULES).toContain("do not tell a manager to verify it first");
    expect(PPTA_ASSISTANT_RULES).toContain("must not add to the list or take from it");
  });
});
