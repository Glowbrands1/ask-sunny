import { describe, expect, it } from "vitest";

import {
  aggregate,
  canAggregate,
  formatMetricValue,
  isSummable,
  sentimentFor,
  unitPolicy,
} from "./aggregation";

describe("what may be summed", () => {
  it("permits addition only where it is meaningful", () => {
    expect(isSummable("currency")).toBe(true);
    expect(isSummable("count")).toBe(true);
    expect(isSummable("hours")).toBe(true);

    expect(isSummable("percent")).toBe(false);
    expect(isSummable("ratio")).toBe(false);
    expect(isSummable("rank")).toBe(false);
    expect(isSummable("years")).toBe(false);
  });

  it("never averages a percentage across salons", () => {
    // A mean of per-salon percentage changes weights a tiny salon equally with
    // a large one, producing a number that matches no salon and no total.
    expect(canAggregate("percent", "mean")).toBe(false);
    expect(canAggregate("ratio", "mean")).toBe(false);
    expect(unitPolicy("percent").preferred).toBe("median");
  });

  it("refuses to aggregate a rank at all", () => {
    const policy = unitPolicy("rank");
    expect(policy.preferred).toBeNull();
    expect(policy.allowed).not.toContain("mean");
    expect(policy.refusalNote).toMatch(/never recomputed/i);
  });
});

describe("aggregate()", () => {
  const values = [10, 20, 30, 40];

  it("sums a currency metric and carries its denominator", () => {
    const result = aggregate({
      metricCode: "total_revenue",
      basisYear: 2026,
      unit: "currency",
      values,
      salonCount: 4,
    });
    expect(result).toMatchObject({ kind: "sum", value: 100, salonCount: 4 });
    // Structurally impossible to claim a chain total.
    expect(result.companyWide).toBe(false);
  });

  it("returns a median for a percentage, not a sum or a mean", () => {
    const result = aggregate({
      metricCode: "total_revenue_pct_change",
      basisYear: 2024,
      unit: "percent",
      values: [-0.1, 0, 0.2, 0.4],
      salonCount: 4,
    });
    expect(result.kind).toBe("median");
    expect(result.value).toBeCloseTo(0.1, 10);
  });

  it("refuses an explicit sum of percentages with a reason", () => {
    const result = aggregate({
      metricCode: "uv_tans_pct_change",
      basisYear: 2024,
      unit: "percent",
      values,
      salonCount: 4,
      kind: "sum",
    });
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toMatch(/cannot be summed/i);
  });

  it("refuses a rank aggregate outright", () => {
    const result = aggregate({
      metricCode: "some_rank",
      basisYear: null,
      unit: "rank",
      values,
      salonCount: 4,
    });
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toMatch(/whole chain/i);
  });

  it("reports no values rather than zero when nothing was reported", () => {
    // Absent is not zero — the distinction the narrow fact model exists to keep.
    const result = aggregate({
      metricCode: "spa_sessions",
      basisYear: 2019,
      unit: "count",
      values: [],
      salonCount: 0,
    });
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toMatch(/no values/i);
  });

  it("keeps a genuine zero as a zero", () => {
    const result = aggregate({
      metricCode: "spa_sessions",
      basisYear: 2026,
      unit: "count",
      values: [0, 0],
      salonCount: 2,
    });
    expect(result.value).toBe(0);
  });

  it("computes an even-length median as the midpoint", () => {
    const result = aggregate({
      metricCode: "x",
      basisYear: null,
      unit: "ratio",
      values: [1, 2, 3, 4],
      salonCount: 4,
      kind: "median",
    });
    expect(result.value).toBe(2.5);
  });

  it("discards non-finite values instead of propagating NaN", () => {
    const result = aggregate({
      metricCode: "total_revenue",
      basisYear: 2026,
      unit: "currency",
      values: [10, Number.NaN, 20, Number.POSITIVE_INFINITY],
      salonCount: 2,
      kind: "sum",
    });
    expect(result.value).toBe(30);
  });
});

describe("formatMetricValue", () => {
  it("renders a stored fraction as a percentage exactly once", () => {
    // -0.0299 in the database means -2.99%.
    expect(formatMetricValue(-0.0299, "percent")).toBe("-2.99%");
    expect(formatMetricValue(0, "percent")).toBe("0.00%");
    expect(formatMetricValue(0.4, "percent")).toBe("+40.00%");
  });

  it("renders currency and counts", () => {
    expect(formatMetricValue(11469.87, "currency")).toBe("$11,469.87");
    expect(formatMetricValue(1234, "count")).toBe("1,234");
  });

  it("labels the remaining units", () => {
    expect(formatMetricValue(7.5, "years")).toBe("7.5 yrs");
    expect(formatMetricValue(12, "rank")).toBe("#12");
    expect(formatMetricValue(3.5, "hours")).toBe("3.5 hrs");
    expect(formatMetricValue(1.25, "ratio")).toBe("1.25");
  });

  it("shows a dash rather than inventing a number", () => {
    expect(formatMetricValue(null, "currency")).toBe("—");
    expect(formatMetricValue(Number.NaN, "count")).toBe("—");
  });
});

describe("sentimentFor", () => {
  it("reads direction from the catalogue", () => {
    expect(sentimentFor(0.1, true)).toBe("good");
    expect(sentimentFor(-0.1, true)).toBe("bad");
    expect(sentimentFor(0.1, false)).toBe("bad");
    expect(sentimentFor(-0.1, false)).toBe("good");
  });

  it("stays neutral when the business has not defined a direction", () => {
    // Colouring a null direction asserts something nobody agreed.
    expect(sentimentFor(0.5, null)).toBe("neutral");
    expect(sentimentFor(-0.5, null)).toBe("neutral");
  });

  it("stays neutral on zero and on a missing value", () => {
    expect(sentimentFor(0, true)).toBe("neutral");
    expect(sentimentFor(null, true)).toBe("neutral");
  });
});
