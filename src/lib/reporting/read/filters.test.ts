import { describe, expect, it } from "vitest";

import {
  DEFAULT_METRIC_CODE,
  DEFAULT_WINDOW_TOKEN,
  DEFAULT_FILTERS,
  HEADLINE_METRIC_CODES,
  hasActiveFilters,
  parseReportFilters,
  serializeReportFilters,
  withFilter,
} from "./filters";

/** Convenience: parse from a query string the way a route would. */
function parse(query: string) {
  return parseReportFilters(new URLSearchParams(query));
}

describe("defaults", () => {
  it("opens on one measure, not on four", () => {
    // The KPI row is always the four headline measures; the metric SELECTOR
    // drives the charts and the table and picks exactly one.
    expect(DEFAULT_FILTERS.metricCodes).toEqual([DEFAULT_METRIC_CODE]);
    expect(HEADLINE_METRIC_CODES).toContain(DEFAULT_METRIC_CODE);
  });

  it("defaults the comparison to 2024, never 2019", () => {
    // 2019's comparison population is unconfirmed, so it is never a default.
    expect(DEFAULT_WINDOW_TOKEN).toBe("2024");
    expect(parse("").filters.window).toBe("2024");
  });

  it("falls back to the default measure when none is given", () => {
    expect(parse("").filters.metricCodes).toEqual([DEFAULT_METRIC_CODE]);
  });
});

describe("parsing is validating", () => {
  it("accepts a metric code from the reviewed catalogue", () => {
    expect(parse("metric=otc_revenue").filters.metricCodes).toEqual(["otc_revenue"]);
  });

  it("drops a metric code that is not in the catalogue, and says so", () => {
    // A URL may not invent a metric any more than a parser may.
    const { filters, ignored } = parse("metric=otc_revenue,invented_metric");
    expect(filters.metricCodes).toEqual(["otc_revenue"]);
    expect(ignored).toContain("metric=invented_metric");
  });

  it("falls back to the default measure when every metric was rejected", () => {
    const { filters, ignored } = parse("metric=nonsense");
    expect(filters.metricCodes).toEqual([DEFAULT_METRIC_CODE]);
    expect(ignored).toHaveLength(1);
  });

  it("refuses a period that is not a plain date", () => {
    expect(parse("period=2026-08-30").filters.periodEnd).toBe("2026-08-30");
    expect(parse("period=yesterday").filters.periodEnd).toBeNull();
    expect(parse("period=2026-8-3").filters.periodEnd).toBeNull();
    expect(parse("period=yesterday").ignored).toContain("period=yesterday");
  });

  it("accepts a window token and refuses anything else", () => {
    // A bare year keeps every link shared before windows existed working.
    expect(parse("vs=2019").filters.window).toBe("2019");
    expect(parse("vs=current").filters.window).toBe("current");
    expect(parse("vs=last_3m").filters.window).toBe("last_3m");
    expect(parse("vs=abc").filters.window).toBe(DEFAULT_WINDOW_TOKEN);
    expect(parse("vs=abc").ignored).toContain("vs=abc");
    // Shape only: whether the report HOLDS a window is decided against the
    // live catalogue, not here.
    expect(parse("vs=1200").filters.window).toBe("1200");
  });

  it("drops a % change code offered as a measure", () => {
    // The window expresses the comparison. Offering both let a manager pick
    // "Total Revenue % Change" and a window, two controls saying one thing.
    const { filters, ignored } = parse("metric=total_revenue_pct_change");
    expect(filters.metricCodes).toEqual([DEFAULT_METRIC_CODE]);
    expect(ignored).toContain("metric=total_revenue_pct_change");
  });

  it("keeps exactly one measure even when several are given", () => {
    expect(parse("metric=uv_tans,otc_revenue").filters.metricCodes).toEqual(["uv_tans"]);
  });

  it("accepts a zero-padded salon number and refuses a malformed one", () => {
    expect(parse("salon=0468").filters.salonNumbers).toEqual(["0468"]);
    // Validated against the schema's own text key.
    const { filters, ignored } = parse("salon=0468,not a salon!!");
    expect(filters.salonNumbers).toEqual(["0468"]);
    expect(ignored.some((entry) => entry.startsWith("salon="))) .toBe(true);
  });

  it("never lets a crafted parameter through to a query", () => {
    const { filters } = parse("salon=%27%20or%201%3D1&metric=%3Bdrop&district=ok");
    expect(filters.salonNumbers).toEqual([]);
    expect(filters.metricCodes).toEqual([DEFAULT_METRIC_CODE]);
    expect(filters.districts).toEqual(["ok"]);
  });

  it("rejects a label carrying control characters", () => {
    const { filters, ignored } = parseReportFilters({
      district: `bad${String.fromCharCode(7)}label`,
    });
    expect(filters.districts).toEqual([]);
    expect(ignored).toHaveLength(1);
  });

  it("caps label length", () => {
    const { filters } = parseReportFilters({ district: "x".repeat(200) });
    expect(filters.districts).toEqual([]);
  });

  it("reads the comp-salon tri-state", () => {
    expect(parse("comp=true").filters.compSalonOnly).toBe(true);
    expect(parse("comp=1").filters.compSalonOnly).toBe(true);
    expect(parse("comp=false").filters.compSalonOnly).toBe(false);
    expect(parse("comp=0").filters.compSalonOnly).toBe(false);
    // Absent means "no preference", which is not the same as false.
    expect(parse("").filters.compSalonOnly).toBeNull();
    expect(parse("comp=maybe").filters.compSalonOnly).toBeNull();
  });

  it("splits, trims and de-duplicates repeated values", () => {
    const { filters } = parseReportFilters({ district: ["a, b", "b,c"] });
    expect(filters.districts).toEqual(["a", "b", "c"]);
  });

  it("accepts the plain-object shape a route receives", () => {
    const { filters } = parseReportFilters({ vs: "2019", metric: "uv_tans" });
    expect(filters.window).toBe("2019");
    expect(filters.metricCodes).toEqual(["uv_tans"]);
  });

  it("validates the sort contract", () => {
    expect(parse("sort=change&dir=asc").filters).toMatchObject({
      sort: "change",
      direction: "asc",
    });
    expect(parse("sort=sideways").filters.sort).toBe("value");
    expect(parse("dir=up").filters.direction).toBe("desc");
  });
});

describe("serialisation", () => {
  it("omits everything at its default, so shared links stay stable", () => {
    expect(serializeReportFilters(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("round-trips a fully populated filter set", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      periodEnd: "2026-08-30",
      window: "2019",
      metricCodes: ["otc_revenue"],
      districts: ["District One"],
      regions: ["Region North"],
      companies: ["Holdings"],
      ownershipGroups: ["Group A"],
      dmas: ["DMA 101"],
      quintiles: ["Top 20%"],
      compSalonOnly: true,
      salonNumbers: ["0468", "1207"],
      sort: "change" as const,
      direction: "asc" as const,
    };
    const round = parseReportFilters(serializeReportFilters(filters));
    expect(round.filters).toEqual(filters);
    expect(round.ignored).toEqual([]);
  });

  it("is idempotent: serialising twice gives the same link", () => {
    const once = serializeReportFilters(parse("vs=2019&salon=0468").filters).toString();
    const twice = serializeReportFilters(parse(once).filters).toString();
    expect(twice).toBe(once);
  });

  it("keeps the default measure out of the URL", () => {
    // Two users who changed nothing produce the same (empty) query.
    const filters = { ...DEFAULT_FILTERS, metricCodes: [DEFAULT_METRIC_CODE] };
    expect(serializeReportFilters(filters).has("metric")).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("is false for defaults and true once anything narrows the report", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    // Choosing a metric or a window is not narrowing the population.
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, window: "2019" })).toBe(false);
    expect(hasActiveFilters(withFilter(DEFAULT_FILTERS, "districts", ["a"]))).toBe(true);
    expect(hasActiveFilters(withFilter(DEFAULT_FILTERS, "compSalonOnly", false))).toBe(true);
  });
});
