import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { canonicalizeReportFilters, eligibleSalons } from "./canonical";
import { DEFAULT_FILTERS, parseReportFilters } from "./filters";
import { ReportingReadRepository } from "./reporting-read-repository";
import { reportingGrainOptions } from "./views";
import { reportWindows } from "./windows";

/**
 * TWO REPORTING PERIODS, WHICH IS THE STATE THIS DASHBOARD IS FOR.
 *
 * Everything shipped so far has been exercised against one ingested report, and
 * one report cannot tell you whether a query is period-scoped: every row belongs
 * to the only period there is, so a missing `where period_id = ...` looks
 * exactly like a correct one. These tests supply a second period and make the
 * difference visible.
 *
 * The intended lifecycle is `new report -> new or reused period -> normalized
 * facts -> the same dashboard`, indefinitely. What has to hold for that:
 *
 *   a new period APPENDS; it never supersedes an earlier one
 *   every dashboard query is scoped to the selected period
 *   filter options, metric availability and comparisons are period-scoped
 *   a new period appears in the Period control on its own
 *   selecting a period cannot mix another period's facts into the view
 *
 * The two periods here differ in every dimension on purpose — different salons,
 * a district that arrives, a district that leaves, a measure present in one and
 * absent in the other, different figures — so ANY leak between them shows up as
 * a wrong value rather than as a coincidence.
 *
 * THE JULY PERIOD IS INGESTED AFTER THE AUGUST ONE, which is the ordinary shape
 * of a backfill and the case that used to open the dashboard on the wrong
 * report: the scope query ordered by arrival, not by period.
 */

const AUG = { id: "period-aug", end: "2026-08-30", ingestedAt: "2026-09-01T09:00:00Z" };
const JUL = { id: "period-jul", end: "2026-07-31", ingestedAt: "2026-09-02T11:00:00Z" };

/* ------------------------------------------------------------ the fake DB */

type Row = Record<string, unknown>;

/**
 * A query builder that applies the operators it is given.
 *
 * Not a Supabase emulator — it implements exactly the operators this repository
 * uses, and throws on anything else so a new operator cannot pass silently by
 * being ignored. Filtering for real is the point: a test double that returns
 * whatever it was seeded with would pass whether or not the query scoped itself
 * to a period, which is the very thing being checked.
 */
function fakeTable(rows: Row[]) {
  const filters: ((row: Row) => boolean)[] = [];
  const orders: { column: string; ascending: boolean }[] = [];
  let take: number | null = null;

  /**
   * OPERATORS ARE COLLECTED, NOT APPLIED AS THEY ARRIVE.
   *
   * PostgREST builds one statement, so `filter -> order -> limit` is the order
   * the database uses however the builder methods were called. The repository
   * calls `.limit(1)` before `.eq("period_end", ...)` — perfectly correct — and
   * a double that truncated on the `limit` call would return the wrong period
   * and blame the repository for it.
   */
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => read(row, column) === value);
      return builder;
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => read(row, column) === value);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(read(row, column)));
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orders.push({ column, ascending: options?.ascending !== false });
      return builder;
    },
    limit: (count: number) => {
      take = count;
      return builder;
    },
    then: (resolve: (value: unknown) => unknown) => {
      const matched = rows.filter((row) => filters.every((keep) => keep(row)));
      const ordered = applyOrders(matched, orders);
      return Promise.resolve(
        resolve({ data: take === null ? ordered : ordered.slice(0, take), error: null }),
      );
    },
  };
  return builder;
}

/** Supports the one embedded path the repository filters on. */
function read(row: Row, column: string): unknown {
  if (!column.includes(".")) return row[column];
  const [table, field] = column.split(".");
  const nested = row[table] as Row | null | undefined;
  return nested ? nested[field] : undefined;
}

function applyOrders(rows: Row[], orders: { column: string; ascending: boolean }[]): Row[] {
  if (orders.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const { column, ascending } of orders) {
      const left = read(a, column);
      const right = read(b, column);
      if (left === right) continue;
      const comparison = String(left) < String(right) ? -1 : 1;
      return ascending ? comparison : -comparison;
    }
    return 0;
  });
}

/* ------------------------------------------------------------- the fixture */

function scopeRow(period: typeof AUG, salons: number, facts: number, metrics: number): Row {
  return {
    ingestion_id: `ing-${period.id}`,
    period_id: period.id,
    grain: "mtd",
    period_start: `${period.end.slice(0, 7)}-01`,
    period_end: period.end,
    period_label: `MTD ${period.end}`,
    fiscal_year: 2026,
    parser_key: "comp_sales_mtd_vs_2024",
    parser_version: 1,
    ingested_at: period.ingestedAt,
    warnings: [],
    warning_count: 0,
    source_sheet_names: ["CompReport(MTD) vs 2024"],
    live_salon_count: salons,
    live_fact_count: facts,
    live_metric_count: metrics,
    file_id: `file-${period.id}`,
    original_filename: "comp-report.xlsx",
    file_sha256: "a".repeat(64),
    storage_bucket: "reporting-sources",
    storage_path: `comp_sales/mtd-${period.end}/aaaaaaaaaaaaaaaa/comp-report.xlsx`,
    size_bytes: 1,
    received_at: null,
    source_code: "comp_report_email",
    source_name: "Comp Report",
    source_kind: "email",
    report_family: "comp_sales",
  };
}

/** August: three districts, fifteen salons — the live shape. */
const AUG_SALONS: Record<string, string[]> = {
  "Invented-District, One": ["0313", "0314", "0410", "0495"],
  "Invented-District, Two": ["0307", "0309", "0310", "0311", "0312"],
  "Invented-District, Three": ["0306", "0394", "0462", "0463", "0468", "0476"],
};

/**
 * July: one salon has closed, one has opened, and a district has changed hands.
 *
 * All three are ordinary between-period changes, and each would be invisible if
 * a query leaked across periods.
 */
const JUL_SALONS: Record<string, string[]> = {
  "Invented-District, One": ["0313", "0314", "0410"],
  "Invented-District, Four": ["0307", "0309", "0310", "0311", "0312"],
  "Invented-District, Three": ["0306", "0394", "0462", "0463", "0468", "0202"],
};

function attributeRows(period: typeof AUG, districts: Record<string, string[]>): Row[] {
  return Object.entries(districts).flatMap(([district, numbers]) =>
    numbers.map((salonNumber) => ({
      period_id: period.id,
      superseded_by_ingestion_id: null,
      district_label: district,
      region_label: "Invented Region North",
      company: "Invented Company",
      ownership_group: "Invented Group A",
      dma: "Invented DMA",
      pricing_plan: null,
      is_comp_salon: true,
      quintile_group: "Top 20%",
      revenue_rank: 1,
      salon_age_years: 10,
      avg_client_age: 30,
      spa_pieces: 2,
      salons: { salon_number: salonNumber, store_name: `Invented Store ${salonNumber}` },
    })),
  );
}

/** A distinct, recognisable figure per period so a leak is unmistakable. */
function factValue(period: typeof AUG, salonNumber: string): number {
  return (period === AUG ? 800_000 : 100_000) + Number(salonNumber);
}

function factRows(period: typeof AUG, districts: Record<string, string[]>): Row[] {
  const numbers = Object.values(districts).flat();
  return numbers.flatMap((salonNumber) =>
    [2026, 2024].map((basisYear) => ({
      period_id: period.id,
      salon_number: salonNumber,
      store_name: `Invented Store ${salonNumber}`,
      metric_code: "total_revenue",
      basis_year: basisYear,
      value: factValue(period, salonNumber) + (basisYear === 2024 ? -5_000 : 0),
      source_sheet: "CompReport(MTD) vs 2024",
      source_column: "AU",
    })),
  );
}

function catalogueRow(period: typeof AUG, code: string, years: number[]): Row {
  return {
    period_id: period.id,
    code,
    label: code,
    family: "revenue",
    unit: "currency",
    higher_is_better: true,
    basis_year_required: true,
    comparison_of_code: null,
    description: "",
    available_basis_years: years,
    fact_count: 30,
    salon_count: 15,
    source_sheet: "CompReport(MTD) vs 2024",
  };
}

function facetRows(period: typeof AUG, districts: Record<string, string[]>): Row[] {
  return Object.entries(districts).map(([value, numbers]) => ({
    period_id: period.id,
    facet: "district",
    value,
    salon_count: numbers.length,
  }));
}

function repository(): ReportingReadRepository {
  const tables: Record<string, Row[]> = {
    comp_sales_report_scope: [
      scopeRow(AUG, 15, 30, 1),
      scopeRow(JUL, 14, 28, 1),
    ],
    comp_sales_filter_options: [...facetRows(AUG, AUG_SALONS), ...facetRows(JUL, JUL_SALONS)],
    comp_sales_metric_catalogue: [
      catalogueRow(AUG, "total_revenue", [2019, 2024, 2026]),
      // Spa Sessions exists in August only. A catalogue that is not
      // period-scoped would offer it in July, where it has no facts.
      catalogueRow(AUG, "spa_sessions", [2024, 2026]),
      catalogueRow(JUL, "total_revenue", [2024, 2026]),
    ],
    salon_period_attributes: [
      ...attributeRows(AUG, AUG_SALONS),
      ...attributeRows(JUL, JUL_SALONS),
    ],
    comp_sales_current_facts: [...factRows(AUG, AUG_SALONS), ...factRows(JUL, JUL_SALONS)],
    comp_sales_source_views: [
      {
        period_id: AUG.id,
        grain: "mtd",
        period_end: AUG.end,
        source_sheet: "CompReport(MTD) vs 2024",
        fact_count: 30,
        salon_count: 15,
        metric_count: 2,
        ingested_at: AUG.ingestedAt,
      },
      {
        period_id: JUL.id,
        grain: "mtd",
        period_end: JUL.end,
        source_sheet: "CompReport(MTD) vs 2024",
        fact_count: 28,
        salon_count: 14,
        metric_count: 1,
        ingested_at: JUL.ingestedAt,
      },
    ],
  };

  const client = {
    from: (table: string) => {
      const rows = tables[table];
      if (!rows) throw new Error(`Unexpected table: ${table}`);
      return fakeTable(rows);
    },
  } as unknown as SupabaseClient;

  return new ReportingReadRepository(client);
}

/* ------------------------------------------------------------------ tests */

describe("the Period control", () => {
  it("lists every ingested period, newest first, with no hardcoded date", () => {
    // A new report simply appears here. Nothing in the code names a date.
    return repository()
      .listPeriods()
      .then((periods) => {
        expect(periods.map((period) => period.periodEnd)).toEqual(["2026-08-30", "2026-07-31"]);
        expect(periods.map((period) => period.salonCount)).toEqual([15, 14]);
      });
  });

  it("opens on the newest PERIOD, not the most recently ingested report", async () => {
    // July was ingested a day after August — an ordinary backfill. Ordering the
    // scope query by arrival opened the dashboard on July and labelled it the
    // latest report, which is wrong in the one way a manager would not check.
    const scope = await repository().getScope(null);
    expect(scope?.periodEnd).toBe("2026-08-30");
    expect(scope?.periodId).toBe(AUG.id);
  });

  it("selects an earlier period when asked for one by date", async () => {
    const scope = await repository().getScope("2026-07-31");
    expect(scope?.periodId).toBe(JUL.id);
    expect(scope?.salonCount).toBe(14);
  });
});

describe("every dashboard query is period-scoped", () => {
  it("returns only the selected period's salons", async () => {
    const repo = repository();
    const august = await repo.listSalons(AUG.id, DEFAULT_FILTERS);
    const july = await repo.listSalons(JUL.id, DEFAULT_FILTERS);

    expect(august).toHaveLength(15);
    expect(july).toHaveLength(14);
    // The salon that opened in August is absent from July, and the one that
    // closed is absent from August. Neither list is the other's.
    expect(august.map((salon) => salon.salonNumber)).toContain("0476");
    expect(july.map((salon) => salon.salonNumber)).not.toContain("0476");
    expect(july.map((salon) => salon.salonNumber)).toContain("0202");
    expect(august.map((salon) => salon.salonNumber)).not.toContain("0202");
  });

  it("returns only the selected period's districts", async () => {
    const repo = repository();
    const august = await repo.getFilterOptions(AUG.id);
    const july = await repo.getFilterOptions(JUL.id);

    // Alphabetical, as the view orders them.
    expect(august.district?.map((option) => option.value)).toEqual([
      "Invented-District, One",
      "Invented-District, Three",
      "Invented-District, Two",
    ]);
    // A district that changed hands between periods appears in one only: Two
    // is August's, Four is July's.
    expect(july.district?.map((option) => option.value)).toEqual([
      "Invented-District, Four",
      "Invented-District, One",
      "Invented-District, Three",
    ]);
  });

  it("returns only the selected period's measures", async () => {
    const repo = repository();
    expect((await repo.getMetricCatalogue(AUG.id)).map((metric) => metric.code)).toEqual([
      "spa_sessions",
      "total_revenue",
    ]);
    // Spa Sessions has no July facts, so July must not offer it.
    expect((await repo.getMetricCatalogue(JUL.id)).map((metric) => metric.code)).toEqual([
      "total_revenue",
    ]);
  });

  it("returns only the selected period's comparisons", async () => {
    const repo = repository();
    const augustWindows = reportWindows(await repo.getMetricCatalogue(AUG.id), {
      currentYear: 2026,
    });
    const julyWindows = reportWindows(await repo.getMetricCatalogue(JUL.id), {
      currentYear: 2026,
    });

    // August carries a 2019 baseline; July does not, so July must not offer it.
    expect(augustWindows.map((window) => window.id)).toEqual(["current", "2024", "2019"]);
    expect(julyWindows.map((window) => window.id)).toEqual(["current", "2024"]);
  });

  it("returns only the selected period's figures", async () => {
    const repo = repository();
    const august = await repo.getFactRows({
      periodId: AUG.id,
      metricCodes: ["total_revenue"],
    });
    const july = await repo.getFactRows({ periodId: JUL.id, metricCodes: ["total_revenue"] });

    expect(august).toHaveLength(30);
    expect(july).toHaveLength(28);
    // The two periods use disjoint value ranges, so a single leaked row would
    // fail this rather than hide inside a plausible total.
    for (const row of august) expect(row.value).toBeGreaterThan(500_000);
    for (const row of july) expect(row.value).toBeLessThan(500_000);
  });

  it("returns only the selected period's source sheets", async () => {
    const repo = repository();
    expect(await repo.listSourceViews(AUG.id)).toHaveLength(1);
    expect((await repo.listSourceViews(AUG.id))[0].factCount).toBe(30);
    expect((await repo.listSourceViews(JUL.id))[0].factCount).toBe(28);
    // Unscoped it still returns everything, for a panel describing the whole
    // ingestion history rather than one report.
    expect(await repo.listSourceViews()).toHaveLength(2);
  });

  it("narrows facts to the salons a period-scoped filter admitted", async () => {
    const repo = repository();
    const salons = await repo.listSalons(JUL.id, {
      ...DEFAULT_FILTERS,
      districts: ["Invented-District, Four"],
    });
    const facts = await repo.getFactRows({
      periodId: JUL.id,
      metricCodes: ["total_revenue"],
      salonNumbers: salons.map((salon) => salon.salonNumber),
    });

    expect(salons).toHaveLength(5);
    expect(facts).toHaveLength(10);
    expect(new Set(facts.map((fact) => fact.salonNumber))).toEqual(
      new Set(["0307", "0309", "0310", "0311", "0312"]),
    );
  });
});

describe("switching period changes everything, consistently", () => {
  /** Everything the dashboard resolves for one period, in one call. */
  async function render(periodEnd: string | null, search = "") {
    const repo = repository();
    const parsed = parseReportFilters(new URLSearchParams(search));
    const scope = await repo.getScope(periodEnd ?? parsed.filters.periodEnd);
    if (!scope) throw new Error("no scope");

    const [options, catalogue, allSalons, periods] = await Promise.all([
      repo.getFilterOptions(scope.periodId),
      repo.getMetricCatalogue(scope.periodId),
      repo.listSalons(scope.periodId, DEFAULT_FILTERS),
      repo.listPeriods(),
    ]);
    const windows = reportWindows(catalogue, { currentYear: 2026, grainLabel: "MTD" });
    const canonical = canonicalizeReportFilters({
      filters: { ...parsed.filters, periodEnd: periodEnd ?? parsed.filters.periodEnd },
      windows,
      selectableMetricCodes: catalogue.map((metric) => metric.code),
      facetOptions: options,
      salons: allSalons,
      periodEnds: periods.map((period) => period.periodEnd),
      availableGrains: reportingGrainOptions(periods)
        .filter((grain) => grain.available)
        .map((grain) => grain.id),
    });
    const salons = await repo.listSalons(scope.periodId, canonical.filters);
    const facts = await repo.getFactRows({
      periodId: scope.periodId,
      metricCodes: [canonical.filters.metricCodes[0]],
      salonNumbers: salons.map((salon) => salon.salonNumber),
    });

    return { scope, options, catalogue, windows, canonical, salons, facts, allSalons };
  }

  it("swaps the whole dataset with nothing carried over", async () => {
    const august = await render("2026-08-30");
    const july = await render("2026-07-31");

    expect(august.scope.periodId).not.toBe(july.scope.periodId);
    expect(august.salons).toHaveLength(15);
    expect(july.salons).toHaveLength(14);
    expect(august.windows.length).not.toBe(july.windows.length);

    // No fact from one period reaches the other's render.
    const augustValues = new Set(august.facts.map((fact) => fact.value));
    for (const fact of july.facts) expect(augustValues.has(fact.value)).toBe(false);
  });

  it("drops a district that does not exist in the newly selected period", async () => {
    // `Invented-District, Two` is August's district. Carrying it into July would return
    // an empty dashboard with a filter chip explaining nothing.
    const july = await render("2026-07-31", "district=Invented-District%2C+Two");
    expect(july.canonical.filters.districts).toEqual([]);
    expect(july.canonical.dropped.join(" ")).toContain("district");
    expect(july.salons).toHaveLength(14);
  });

  it("drops a salon that does not exist in the newly selected period", async () => {
    const july = await render("2026-07-31", "salon=0476");
    expect(july.canonical.filters.salonNumbers).toEqual([]);
    expect(july.salons).toHaveLength(14);
  });

  it("drops a comparison the newly selected period does not carry", async () => {
    // August has a 2019 baseline and July does not.
    const august = await render("2026-08-30", "vs=2019");
    expect(august.canonical.window?.id).toBe("2019");

    const july = await render("2026-07-31", "vs=2019");
    expect(july.canonical.window?.id).toBe("2024");
    expect(july.canonical.dropped.join(" ")).toContain("comparison");
  });

  it("drops a measure the newly selected period does not report", async () => {
    const august = await render("2026-08-30", "metric=spa_sessions");
    expect(august.canonical.filters.metricCodes).toEqual(["spa_sessions"]);

    const july = await render("2026-07-31", "metric=spa_sessions");
    expect(july.canonical.filters.metricCodes).toEqual(["total_revenue"]);
  });

  it("keeps a district that exists in both periods, with its own salons", async () => {
    const august = await render("2026-08-30", "district=Invented-District%2C+One");
    const july = await render("2026-07-31", "district=Invented-District%2C+One");

    expect(august.canonical.filters.districts).toEqual(["Invented-District, One"]);
    expect(july.canonical.filters.districts).toEqual(["Invented-District, One"]);
    // Same district, different membership — one of its salons closed.
    expect(august.salons.map((salon) => salon.salonNumber)).toEqual([
      "0313",
      "0314",
      "0410",
      "0495",
    ]);
    expect(july.salons.map((salon) => salon.salonNumber)).toEqual(["0313", "0314", "0410"]);
  });

  it("recomputes the eligible salon set from the selected period", async () => {
    const july = await render("2026-07-31");
    const eligible = eligibleSalons(july.allSalons, {
      ...DEFAULT_FILTERS,
      districts: ["Invented-District, Three"],
    });
    // July's third district, including the salon that only exists in July.
    expect(eligible.map((salon) => salon.salonNumber)).toContain("0202");
    expect(eligible.map((salon) => salon.salonNumber)).not.toContain("0476");
  });

  it("still refuses Weekly with two periods loaded", async () => {
    // Two periods make MONTHLY available. A weekly selection must still be
    // dropped: the source is not produced weekly, which no number of periods
    // changes.
    const july = await render("2026-07-31", "grain=weekly");
    expect(july.canonical.filters.grain).toBeNull();

    const monthly = await render("2026-07-31", "grain=monthly");
    expect(monthly.canonical.filters.grain).toBe("monthly");
  });

  it("offers a history grain once two periods exist, and only then", async () => {
    const periods = await repository().listPeriods();
    const grains = reportingGrainOptions(periods);
    const monthly = grains.find((grain) => grain.id === "monthly");
    expect(monthly?.available).toBe(true);
    expect(monthly?.periodCount).toBe(2);

    // Weekly stays unavailable however many periods arrive: the source is not
    // produced weekly, which is a different gap from "not yet loaded".
    expect(grains.find((grain) => grain.id === "weekly")?.available).toBe(false);
    // ...and one period is still not enough for monthly.
    expect(
      reportingGrainOptions([periods[0]]).find((grain) => grain.id === "monthly")?.available,
    ).toBe(false);
  });
});
