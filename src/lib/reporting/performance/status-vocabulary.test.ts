import { describe, expect, it } from "vitest";

import {
  BENCHMARK_TIERS,
  CAPACITY_STATES,
  DATA_STATES,
  isBenchmarkTier,
  OPERATIONAL_STATES,
  STATUS_VOCABULARY,
  statusCategoryOf,
} from "./status-vocabulary";
import { PERFORMANCE_BANDS } from "./classification";

/**
 * The 14 September review: "I recommend selecting one consistent four-tier
 * scale and using it throughout the app wherever possible."
 *
 * What these pin is the SEPARATION the review actually spotted — four different
 * kinds of state reading as one vocabulary — rather than a threshold, because
 * the review asked for no threshold change and none was made.
 */

describe("the benchmark scale is four tiers, and only four", () => {
  it("has exactly the four approved bands, in order", () => {
    expect(BENCHMARK_TIERS.map((tier) => tier.label)).toEqual([
      "Outperforming Peers",
      "At Market",
      "Below Market",
      "Significantly Underperforming",
    ]);
    expect(BENCHMARK_TIERS.map((tier) => tier.order)).toEqual([1, 2, 3, 4]);
  });

  it("is derived from the one place the bands are declared", () => {
    // Not a second copy. A fifth band added to `classification.ts` appears here
    // automatically and fails the count above, which is the intended effect.
    expect(BENCHMARK_TIERS).toHaveLength(PERFORMANCE_BANDS.length);
    expect(BENCHMARK_TIERS.map((tier) => tier.id)).toEqual(
      PERFORMANCE_BANDS.map((band) => band.id),
    );
  });

  it("is the ONLY ordered category", () => {
    for (const entry of [...CAPACITY_STATES, ...OPERATIONAL_STATES, ...DATA_STATES]) {
      expect(entry.order).toBeNull();
    }
  });
});

describe("a capacity state is not a performance tier", () => {
  it("keeps Tracked for capacity out of the benchmark scale", () => {
    /*
     * The FAST rule: those removals are intentional and "are not treated as a
     * negative KPI". Ranking it inside the four tiers would report a decision
     * the business already took as a failure.
     */
    expect(statusCategoryOf("tracked_for_capacity")).toBe("capacity");
    expect(isBenchmarkTier("tracked_for_capacity")).toBe(false);
    expect(BENCHMARK_TIERS.map((tier) => tier.label)).not.toContain(
      "Tracked for capacity",
    );
  });
});

describe("operational and data states are kept apart too", () => {
  it("classifies the combined view's salon readings as operational", () => {
    for (const entry of OPERATIONAL_STATES) {
      expect(statusCategoryOf(entry.id)).toBe("operational");
      expect(isBenchmarkTier(entry.id)).toBe(false);
    }
    // And there is more than one, so the category is real rather than notional.
    expect(OPERATIONAL_STATES.length).toBeGreaterThan(1);
  });

  it("classifies gaps and data problems as data, never as performance", () => {
    for (const id of ["no_comparison", "not_reported", "ppta_data_issue", "small_peer_sample"]) {
      expect(statusCategoryOf(id)).toBe("data");
      expect(isBenchmarkTier(id)).toBe(false);
    }
  });
});

describe("the mapping is complete and unambiguous", () => {
  it("assigns every label to exactly one category", () => {
    const ids = STATUS_VOCABULARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a label and a place it is declared", () => {
    for (const entry of STATUS_VOCABULARY) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.declaredIn.length).toBeGreaterThan(0);
    }
  });

  it("returns null for a status nobody declared", () => {
    expect(statusCategoryOf("invented_tier")).toBeNull();
    expect(isBenchmarkTier("invented_tier")).toBe(false);
  });
});
