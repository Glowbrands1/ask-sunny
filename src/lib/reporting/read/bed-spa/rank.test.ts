import { describe, expect, it } from "vitest";

import {
  clampRank,
  invertRank,
  isValidRank,
  rankAxis,
  rankFromInverted,
  readRank,
} from "./rank";

/**
 * The 14 September review: the Spa Engagement rank axis "currently runs #249,
 * #184, #119, #54, and #-11. There should not be a negative rank."
 *
 * That sequence is reproduced below from the population it came from, so the
 * test fails against the implementation that produced it.
 */
const POPULATION = 248;

describe("a rank is a position in a population", () => {
  it("refuses zero, negatives and fractions", () => {
    expect(isValidRank(0, POPULATION)).toBe(false);
    expect(isValidRank(-11, POPULATION)).toBe(false);
    expect(isValidRank(-1, POPULATION)).toBe(false);
    expect(isValidRank(7.5, POPULATION)).toBe(false);
    expect(isValidRank(Number.NaN, POPULATION)).toBe(false);
    expect(isValidRank(Number.POSITIVE_INFINITY, POPULATION)).toBe(false);
  });

  it("refuses a position past the end of the population", () => {
    expect(isValidRank(249, POPULATION)).toBe(false);
    expect(isValidRank(POPULATION, POPULATION)).toBe(true);
  });

  it("accepts an unbounded rank when the delivery recorded no population", () => {
    expect(isValidRank(500, null)).toBe(true);
    expect(isValidRank(0, null)).toBe(false);
  });

  it("reads an invalid rank as NOT REPORTED rather than repairing it", () => {
    expect(readRank(-11, POPULATION)).toBeNull();
    expect(readRank(0, POPULATION)).toBeNull();
    expect(readRank(249, POPULATION)).toBeNull();
    expect(readRank(7, POPULATION)).toBe(7);
    expect(readRank(null, POPULATION)).toBeNull();
  });
});

describe("the inverted-rank axis cannot describe a rank below 1", () => {
  it("reproduces the reported sequence from an unbounded axis", () => {
    // What the charting library's automatic domain produced, and why #-11 appeared.
    const automaticTicks = [0, 65, 130, 195, 260];
    const asRanks = automaticTicks.map((tick) => rankFromInverted(tick, POPULATION));
    expect(asRanks).toEqual([249, 184, 119, 54, -11]);
    // Every one of those is refused by the validator.
    expect(asRanks.filter((rank) => isValidRank(rank, POPULATION))).toEqual([184, 119, 54]);
  });

  it("bounds the domain to exactly the ranking", () => {
    const axis = rankAxis(POPULATION);
    expect(axis.domain).toEqual([1, POPULATION]);
  });

  it("produces only ticks that format to a real rank", () => {
    const axis = rankAxis(POPULATION);
    for (const tick of axis.ticks) {
      const rank = rankFromInverted(tick, POPULATION);
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(POPULATION);
      expect(isValidRank(rank, POPULATION)).toBe(true);
    }
  });

  it("keeps both ends of the ranking on the axis", () => {
    const axis = rankAxis(POPULATION);
    const ranks = axis.ticks.map((tick) => rankFromInverted(tick, POPULATION));
    expect(ranks).toContain(1);
    expect(ranks).toContain(POPULATION);
  });

  it("never produces a tick below 1 for any population", () => {
    for (const population of [1, 2, 3, 7, 15, 100, 248, 1000]) {
      const axis = rankAxis(population);
      expect(Math.min(...axis.ticks)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...axis.ticks)).toBeLessThanOrEqual(Math.max(1, population));
      for (const tick of axis.ticks) {
        expect(rankFromInverted(tick, population)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("does not repeat a tick on a small population", () => {
    const axis = rankAxis(3);
    expect(new Set(axis.ticks).size).toBe(axis.ticks.length);
  });

  it("degrades to a single point when no population was recorded", () => {
    expect(rankAxis(null)).toEqual({ domain: [1, 1], ticks: [1] });
    expect(rankAxis(0)).toEqual({ domain: [1, 1], ticks: [1] });
  });
});

describe("inversion round-trips", () => {
  it("puts rank 1 at the long end and the last rank at the short end", () => {
    expect(invertRank(1, POPULATION)).toBe(POPULATION);
    expect(invertRank(POPULATION, POPULATION)).toBe(1);
  });

  it("recovers the rank from the plotted value", () => {
    for (const rank of [1, 2, 54, 119, 184, POPULATION]) {
      expect(rankFromInverted(invertRank(rank, POPULATION), POPULATION)).toBe(rank);
    }
  });
});

describe("clampRank is the last guard before a label is printed", () => {
  it("never returns a rank below 1", () => {
    expect(clampRank(-11, POPULATION)).toBe(1);
    expect(clampRank(0, POPULATION)).toBe(1);
    expect(clampRank(0.4, POPULATION)).toBe(1);
  });

  it("never returns a rank past the population", () => {
    expect(clampRank(249, POPULATION)).toBe(POPULATION);
    expect(clampRank(10_000, POPULATION)).toBe(POPULATION);
  });

  it("leaves a valid rank alone", () => {
    expect(clampRank(54, POPULATION)).toBe(54);
  });

  it("still floors at 1 with no population to bound against", () => {
    expect(clampRank(-3, null)).toBe(1);
    expect(clampRank(900, null)).toBe(900);
  });
});
