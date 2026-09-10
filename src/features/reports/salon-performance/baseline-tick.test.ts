import { describe, expect, it } from "vitest";

import { baselineTickRatio } from "./charts";

/**
 * THE PRIOR-YEAR TICK'S POSITION.
 *
 * The artifact folds the baseline onto the ranked bars as a mark rather than
 * drawing it as a second bar, and this is the arithmetic that puts it in the
 * right place. It is worth its own test for two reasons:
 *
 *   IT CANNOT BE SEEN LOCALLY. The chart needs Supabase to render, and a chart
 *   library will not lay out in jsdom at all, so a wrong ratio would ship
 *   looking plausible — a tick a few pixels off reads as a real figure.
 *
 *   THE OVERSHOOT IS THE POINT, not a bug to be clamped away. Where last year
 *   was higher the tick belongs past the end of the bar, because a short bar
 *   with its marker beyond it is exactly how "this salon went backwards" reads
 *   at a glance. A future tidy-up clamping this to 1 would quietly delete that
 *   reading, so it is pinned here.
 */
describe("baselineTickRatio", () => {
  it("puts the tick where the baseline falls along the bar", () => {
    // 2025 was half of 2026, so the tick sits halfway.
    expect(baselineTickRatio(1_000_000, 500_000)).toBe(0.5);
    expect(baselineTickRatio(1_164_651.14, 1_132_133.99)).toBeCloseTo(0.9721, 4);
  });

  it("lets the tick overshoot the bar when the prior year was higher", () => {
    // KS Overland Park: 2026 $639,085.77 against 2025 $662,126.51.
    const ratio = baselineTickRatio(639_085.77, 662_126.51);
    expect(ratio).not.toBeNull();
    expect(ratio as number).toBeGreaterThan(1);
  });

  it("draws nothing where there is nothing honest to draw", () => {
    expect(baselineTickRatio(1000, null)).toBeNull();
    expect(baselineTickRatio(1000, undefined)).toBeNull();
    expect(baselineTickRatio(null, 500)).toBeNull();
    expect(baselineTickRatio(undefined, 500)).toBeNull();
    // A zero or negative current has no ratio, and dividing by it would put
    // the tick at infinity.
    expect(baselineTickRatio(0, 500)).toBeNull();
    expect(baselineTickRatio(-10, 500)).toBeNull();
    expect(baselineTickRatio(Number.NaN, 500)).toBeNull();
    expect(baselineTickRatio(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("treats a reported zero baseline as a real figure, not a gap", () => {
    /*
     * A source that reports 0 for last year is saying something — the salon did
     * not trade — and the tick belongs at the origin. That is different from an
     * absent baseline, which draws nothing at all.
     */
    expect(baselineTickRatio(1000, 0)).toBe(0);
  });
});
