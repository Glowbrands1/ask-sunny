import { describe, expect, it } from "vitest";

import { moversDomain, salonAxisWidth, storeNameTicks } from "./chart-axis";

/**
 * WHAT THE RANKING AXIS SHOWS, AND WHAT IT IS KEYED ON.
 *
 * These are two different questions and the bug worth preventing lives in the
 * gap between them. A manager needs to read "MO Kansas City Liberty" off the
 * axis; the chart needs each bar to have a unique identity. `salons.store_name`
 * carries no unique constraint — only a not-blank check — so keying the axis on
 * the name would let two salons sharing one collapse into a single bar showing
 * one of their two values. That is a wrong number, not a cosmetic fault.
 *
 * Salon numbers below are the real ones from the reporting data; everything
 * invented is marked as such.
 */

const ROWS = [
  { salonNumber: "0394", storeName: "MO Kansas City Liberty" },
  { salonNumber: "0468", storeName: "KS Lawrence" },
  { salonNumber: "0314", storeName: "NE Omaha 144th and Center" },
];

describe("the tick a reader sees", () => {
  it("shows the store name for a salon number", () => {
    const tick = storeNameTicks(ROWS);
    expect(tick("0394")).toBe("MO Kansas City Liberty");
    expect(tick("0468")).toBe("KS Lawrence");
  });

  it("falls back to the number rather than rendering nothing", () => {
    /*
     * A nameless tick is worse than a numeric one: the bar becomes impossible
     * to attribute at all. Covers both a row absent from the map and a row
     * whose name is blank.
     */
    const tick = storeNameTicks([...ROWS, { salonNumber: "0999", storeName: "" }]);
    expect(tick("0999")).toBe("0999");
    expect(tick("0000")).toBe("0000");
  });

  it("keeps two salons that share a name distinguishable by their own bars", () => {
    /*
     * THE TEST THIS FILE EXISTS FOR. Two salons, one name — permitted by the
     * schema. Because the axis is keyed on the NUMBER, both rows survive as
     * separate categories and each simply renders the shared label. Had the
     * axis been keyed on the name, one bar would have swallowed the other.
     */
    const shared = [
      { salonNumber: "0501", storeName: "Invented Shared Name" },
      { salonNumber: "0502", storeName: "Invented Shared Name" },
    ];
    const tick = storeNameTicks(shared);

    expect(tick("0501")).toBe("Invented Shared Name");
    expect(tick("0502")).toBe("Invented Shared Name");
    // Distinct lookups, so distinct categories upstream of this formatter.
    expect(new Set(shared.map((row) => row.salonNumber)).size).toBe(2);
  });
});

describe("how much room the axis takes", () => {
  it("fits the longest name actually in view", () => {
    // "NE Omaha 144th and Center" is 25 characters; the old fixed 64px, sized
    // for a four-digit number, would have clipped every name in the set.
    const width = salonAxisWidth(ROWS);
    expect(width).toBeGreaterThan(64);
    expect(width).toBeGreaterThanOrEqual(25 * 6);
  });

  it("does not let one long name squeeze the bars away", () => {
    const width = salonAxisWidth([
      { salonNumber: "0503", storeName: "Invented ".repeat(30) },
    ]);
    expect(width).toBeLessThanOrEqual(196);
  });

  it("keeps a floor when names are short or absent", () => {
    expect(salonAxisWidth([{ salonNumber: "0504", storeName: "A" }])).toBeGreaterThanOrEqual(96);
    expect(salonAxisWidth([])).toBeGreaterThanOrEqual(96);
  });

  it("grows with the longest name, not with the number of rows", () => {
    const one = salonAxisWidth([{ salonNumber: "0505", storeName: "Invented Short" }]);
    const many = salonAxisWidth(
      Array.from({ length: 40 }, (_, index) => ({
        salonNumber: `06${String(index).padStart(2, "0")}`,
        storeName: "Invented Short",
      })),
    );
    expect(many).toBe(one);
  });
});

describe("the movers axis runs over the movement that exists", () => {
  /*
   * The 14 September review: "'Strongest and Weakest Movers' runs its axis down
   * to -71%, even though nothing is negative."
   *
   * The symmetric domain was `±max(|change|) * 1.15`, so a set topping out at
   * +62% produced an axis reaching -71% — half the plot empty and every real
   * bar squeezed into the other half.
   */
  it("does not invent a negative half when every salon is up", () => {
    const domain = moversDomain([62, 40, 18, 3]);
    expect(domain.min).toBe(0);
    expect(domain.max).toBeCloseTo(62 * 1.15, 6);
    // Specifically not the -71% the review saw.
    expect(domain.min).not.toBeCloseTo(-71.3, 1);
  });

  it("does not invent a positive half when every salon is down", () => {
    const domain = moversDomain([-5, -22, -40]);
    expect(domain.max).toBe(0);
    expect(domain.min).toBeCloseTo(-40 * 1.15, 6);
  });

  it("stays symmetric when both directions are on screen", () => {
    // Equal movements must draw equal bars, which is what symmetry is for.
    const domain = moversDomain([30, -12, 5]);
    expect(domain.min).toBeCloseTo(-30 * 1.15, 6);
    expect(domain.max).toBeCloseTo(30 * 1.15, 6);
    expect(domain.min).toBeCloseTo(-domain.max, 6);
  });

  it("always contains zero, because the zero line is what makes sign legible", () => {
    for (const changes of [[62, 40], [-5, -22], [30, -12], [0], []]) {
      const domain = moversDomain(changes);
      expect(domain.min).toBeLessThanOrEqual(0);
      expect(domain.max).toBeGreaterThanOrEqual(0);
    }
  });

  it("never returns a zero-width domain", () => {
    for (const changes of [[], [0], [0, 0, 0], [null, null]]) {
      const domain = moversDomain(changes);
      expect(domain.max).toBeGreaterThan(domain.min);
    }
  });

  it("ignores rows with no comparison rather than reading them as zero", () => {
    // A salon with no baseline has not stayed flat; it has not been measured.
    expect(moversDomain([null, 40, null])).toEqual(moversDomain([40]));
    expect(moversDomain([Number.NaN, 40])).toEqual(moversDomain([40]));
  });

  it("leaves headroom so a value label is not clipped", () => {
    expect(moversDomain([100]).max).toBeGreaterThan(100);
  });
});
