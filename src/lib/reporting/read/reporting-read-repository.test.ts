import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { DEFAULT_FILTERS } from "./filters";
import { ReportingReadRepository } from "./reporting-read-repository";

/**
 * The read repository against a recorded fake client. Nothing here reaches a
 * network; the point is the query SHAPE and the mapping to contracts.
 */

type Call = [string, ...unknown[]];

/** A thenable query builder that records every operator it was handed. */
function fakeTable(result: { data?: unknown; error?: { message: string } }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = { calls };
  for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({ data: result.data ?? null, error: result.error ?? null }));
  return builder as Record<string, unknown> & { calls: Call[] };
}

function fakeClient(tables: Record<string, ReturnType<typeof fakeTable>>) {
  const requested: string[] = [];
  const client = {
    from: (table: string) => {
      requested.push(table);
      const entry = tables[table];
      if (!entry) throw new Error(`Unexpected table: ${table}`);
      return entry;
    },
  } as unknown as SupabaseClient;
  return { client, requested };
}

const SCOPE_ROW = {
  ingestion_id: "ing-1",
  period_id: "period-1",
  grain: "mtd",
  period_start: "2026-08-01",
  period_end: "2026-08-30",
  period_label: "MTD 08/30/2026",
  fiscal_year: 2026,
  parser_key: "comp_sales_mtd_vs_2024",
  parser_version: 1,
  ingested_at: "2026-09-01T09:00:00Z",
  warnings: [
    "stale_header_suspected: Column AU is headed 2024 but holds 2026 values.",
    "stale_header_suspected: Column AX likewise.",
    "duplicate_metric_column: Columns AJ and BR both resolve to Spa Sessions.",
  ],
  warning_count: 3,
  source_sheet_names: ["CompReport(MTD) vs 2024"],
  recorded_fact_count: 562,
  recorded_salon_count: 15,
  live_salon_count: 15,
  live_fact_count: 562,
  live_metric_count: 16,
  file_id: "file-1",
  original_filename: "comp-report.xlsx",
  file_sha256: "e".repeat(64),
  storage_bucket: "reporting-sources",
  storage_path: "comp_sales/mtd-2026-08-30/eeeeeeeeeeeeeeee/comp-report.xlsx",
  size_bytes: 614567,
  received_at: "2026-09-01T08:59:00Z",
  source_code: "comp_report_email",
  source_name: "Comp Report (emailed workbook)",
  source_kind: "email_attachment",
  report_family: "comp_sales",
};

describe("getScope", () => {
  it("maps the view row onto the scope contract", async () => {
    const table = fakeTable({ data: [SCOPE_ROW] });
    const { client } = fakeClient({ comp_sales_report_scope: table });
    const scope = await new ReportingReadRepository(client).getScope();

    expect(scope).toEqual({
      ingestionId: "ing-1",
      periodId: "period-1",
      grain: "mtd",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-30",
      periodLabel: "MTD 08/30/2026",
      fiscalYear: 2026,
      // Derived counts, matching the verified baseline.
      salonCount: 15,
      factCount: 562,
      metricCount: 16,
      ingestedAt: "2026-09-01T09:00:00Z",
      parserKey: "comp_sales_mtd_vs_2024",
      parserVersion: 1,
      companyWide: false,
    });
  });

  it("takes the most recent ingestion, so a correction wins", async () => {
    const table = fakeTable({ data: [SCOPE_ROW] });
    const { client } = fakeClient({ comp_sales_report_scope: table });
    await new ReportingReadRepository(client).getScope();

    expect(table.calls).toEqual(
      expect.arrayContaining([
        ["order", "ingested_at", { ascending: false }],
        ["limit", 1],
      ]),
    );
  });

  it("narrows to a requested period", async () => {
    const table = fakeTable({ data: [SCOPE_ROW] });
    const { client } = fakeClient({ comp_sales_report_scope: table });
    await new ReportingReadRepository(client).getScope("2026-08-30");
    expect(table.calls).toEqual(
      expect.arrayContaining([["eq", "period_end", "2026-08-30"]]),
    );
  });

  it("returns null when nothing has been ingested", async () => {
    const { client } = fakeClient({ comp_sales_report_scope: fakeTable({ data: [] }) });
    expect(await new ReportingReadRepository(client).getScope()).toBeNull();
  });

  it("surfaces a read failure rather than pretending there is no report", async () => {
    const { client } = fakeClient({
      comp_sales_report_scope: fakeTable({ error: { message: "boom" } }),
    });
    await expect(new ReportingReadRepository(client).getScope()).rejects.toThrow(
      /report scope/i,
    );
  });
});

describe("getFilterOptions", () => {
  it("groups facet rows and leaves an absent facet absent", async () => {
    const table = fakeTable({
      data: [
        { period_id: "p", facet: "district", value: "District One", salon_count: 9 },
        { period_id: "p", facet: "district", value: "District Two", salon_count: 6 },
        { period_id: "p", facet: "comp_salon", value: "true", salon_count: 12 },
      ],
    });
    const { client } = fakeClient({ comp_sales_filter_options: table });
    const options = await new ReportingReadRepository(client).getFilterOptions("p");

    expect(options.district).toEqual([
      { value: "District One", salonCount: 9 },
      { value: "District Two", salonCount: 6 },
    ]);
    expect(options.comp_salon).toEqual([{ value: "true", salonCount: 12 }]);
    // A facet with no values must not appear as an empty filter.
    expect(options.pricing_plan).toBeUndefined();
    expect(options.market_consolidation).toBeUndefined();
  });
});

describe("getMetricCatalogue", () => {
  it("maps descriptors and sorts basis years ascending", async () => {
    const table = fakeTable({
      data: [
        {
          period_id: "p",
          code: "spa_sessions",
          label: "Spa Sessions",
          family: "volume",
          unit: "count",
          higher_is_better: true,
          basis_year_required: true,
          comparison_of_code: null,
          description: "Spa equipment sessions.",
          available_basis_years: [2026, 2024],
          fact_count: 30,
          salon_count: 15,
        },
      ],
    });
    const { client } = fakeClient({ comp_sales_metric_catalogue: table });
    const metrics = await new ReportingReadRepository(client).getMetricCatalogue("p");

    // No 2019 entry, because the workbook has no 2019 spa block. Never filled in.
    expect(metrics[0].availableBasisYears).toEqual([2024, 2026]);
    expect(metrics[0]).toMatchObject({ code: "spa_sessions", unit: "count", factCount: 30 });
  });

  it("tolerates a null basis-year array", async () => {
    const table = fakeTable({
      data: [
        {
          period_id: "p", code: "x", label: "X", family: "f", unit: "count",
          higher_is_better: null, basis_year_required: false, comparison_of_code: null,
          description: "", available_basis_years: null, fact_count: 0, salon_count: 0,
        },
      ],
    });
    const { client } = fakeClient({ comp_sales_metric_catalogue: table });
    const metrics = await new ReportingReadRepository(client).getMetricCatalogue("p");
    expect(metrics[0].availableBasisYears).toEqual([]);
    expect(metrics[0].higherIsBetter).toBeNull();
  });
});

describe("getSourceQuality", () => {
  it("groups warnings by code, most frequent first", async () => {
    const { client } = fakeClient({ comp_sales_report_scope: fakeTable({ data: [SCOPE_ROW] }) });
    const quality = await new ReportingReadRepository(client).getSourceQuality("ing-1");

    expect(quality?.warningsByCode).toEqual([
      { code: "stale_header_suspected", count: 2, messages: expect.any(Array) },
      { code: "duplicate_metric_column", count: 1, messages: expect.any(Array) },
    ]);
    expect(quality?.fileSha256).toBe("e".repeat(64));
    expect(quality?.storageBucket).toBe("reporting-sources");
  });

  it("reports skipped rows as NOT RECORDED rather than zero", async () => {
    const { client } = fakeClient({ comp_sales_report_scope: fakeTable({ data: [SCOPE_ROW] }) });
    const quality = await new ReportingReadRepository(client).getSourceQuality("ing-1");
    // "none were skipped" and "we did not record it" are different facts.
    expect(quality?.skippedRowsByReason).toBeNull();
  });

  it("carries THIS ingestion's parser, not the period's newest", async () => {
    /*
     * A month-to-date period holds two ingestions of the same workbook, one per
     * sheet. `getScope` answers with the newest, so a provenance panel reading
     * the parser off the scope would credit the rolling mapping for figures the
     * year-comparison mapping read — the one field in that panel nobody would
     * think to doubt. It comes off the ingestion row instead.
     */
    const { client } = fakeClient({ comp_sales_report_scope: fakeTable({ data: [SCOPE_ROW] }) });
    const quality = await new ReportingReadRepository(client).getSourceQuality("ing-1");
    expect(quality?.parserKey).toBe(SCOPE_ROW.parser_key);
    expect(quality?.parserVersion).toBe(SCOPE_ROW.parser_version);
  });
});

describe("getSheetIngestionId", () => {
  const ROLLING_ROW = {
    ...SCOPE_ROW,
    ingestion_id: "ing-2",
    parser_key: "comp_sales_mtd_rolling",
    source_sheet_names: ["CompReport(MTD)"],
    // Ingested AFTER the year-comparison sheet, which is what makes this the
    // period's "latest" and therefore the wrong answer for the other sheet.
    ingested_at: "2026-09-01T10:30:00Z",
  };

  it("finds the ingestion that produced one sheet, not the period's newest", async () => {
    const { client } = fakeClient({
      comp_sales_report_scope: fakeTable({ data: [ROLLING_ROW, SCOPE_ROW] }),
    });
    const repository = new ReportingReadRepository(client);

    await expect(
      repository.getSheetIngestionId("period-1", "CompReport(MTD) vs 2024"),
    ).resolves.toBe("ing-1");
    await expect(
      repository.getSheetIngestionId("period-1", "CompReport(MTD)"),
    ).resolves.toBe("ing-2");
  });

  it("returns null for a sheet this period does not hold", async () => {
    // Null rather than the first row: guessing would attach one sheet's
    // provenance to another sheet's figures.
    const { client } = fakeClient({
      comp_sales_report_scope: fakeTable({ data: [SCOPE_ROW] }),
    });
    await expect(
      new ReportingReadRepository(client).getSheetIngestionId("period-1", "CompReport(YTD)"),
    ).resolves.toBeNull();
  });
});

describe("listSalons", () => {
  const rows = [
    {
      district_label: "District Two", region_label: "Region", company: null,
      ownership_group: null, dma: null, pricing_plan: null, is_comp_salon: true,
      quintile_group: "Top 20%", revenue_rank: 5, salon_age_years: "7.250",
      avg_client_age: "30.500", spa_pieces: 2,
      salons: { salon_number: "1207", store_name: "Store Beta" },
    },
    {
      district_label: "District One", region_label: "Region", company: null,
      ownership_group: null, dma: null, pricing_plan: null, is_comp_salon: false,
      quintile_group: "Bottom 20%", revenue_rank: 91, salon_age_years: null,
      avg_client_age: null, spa_pieces: null,
      salons: { salon_number: "0468", store_name: "Store Alpha" },
    },
  ];

  it("preserves zero-padded salon numbers and orders by them", async () => {
    const { client } = fakeClient({ salon_period_attributes: fakeTable({ data: rows }) });
    const salons = await new ReportingReadRepository(client).listSalons("p", DEFAULT_FILTERS);

    expect(salons.map((salon) => salon.salonNumber)).toEqual(["0468", "1207"]);
    // Text throughout, on the way out as well as in.
    expect(salons[0].salonNumber).toBe("0468");
  });

  it("coerces numeric strings Postgres returns for numeric columns", async () => {
    const { client } = fakeClient({ salon_period_attributes: fakeTable({ data: rows }) });
    const salons = await new ReportingReadRepository(client).listSalons("p", DEFAULT_FILTERS);
    const beta = salons.find((salon) => salon.salonNumber === "1207");
    expect(beta?.salonAgeYears).toBe(7.25);
    expect(beta?.avgClientAge).toBe(30.5);
    const alpha = salons.find((salon) => salon.salonNumber === "0468");
    expect(alpha?.salonAgeYears).toBeNull();
  });

  it("always restricts to live rows for the period", async () => {
    const table = fakeTable({ data: rows });
    const { client } = fakeClient({ salon_period_attributes: table });
    await new ReportingReadRepository(client).listSalons("p", DEFAULT_FILTERS);

    expect(table.calls).toEqual(
      expect.arrayContaining([
        ["eq", "period_id", "p"],
        ["is", "superseded_by_ingestion_id", null],
      ]),
    );
  });

  it("applies every active filter, so all views narrow identically", async () => {
    const table = fakeTable({ data: rows });
    const { client } = fakeClient({ salon_period_attributes: table });
    await new ReportingReadRepository(client).listSalons("p", {
      ...DEFAULT_FILTERS,
      districts: ["District One"],
      regions: ["Region"],
      companies: ["Holdings"],
      ownershipGroups: ["Group A"],
      dmas: ["DMA"],
      quintiles: ["Top 20%"],
      compSalonOnly: true,
      salonNumbers: ["0468"],
    });

    expect(table.calls).toEqual(
      expect.arrayContaining([
        ["in", "district_label", ["District One"]],
        ["in", "region_label", ["Region"]],
        ["in", "company", ["Holdings"]],
        ["in", "ownership_group", ["Group A"]],
        ["in", "dma", ["DMA"]],
        ["in", "quintile_group", ["Top 20%"]],
        ["eq", "is_comp_salon", true],
        ["in", "salons.salon_number", ["0468"]],
      ]),
    );
  });

  it("adds no filter operators when nothing is selected", async () => {
    const table = fakeTable({ data: rows });
    const { client } = fakeClient({ salon_period_attributes: table });
    await new ReportingReadRepository(client).listSalons("p", DEFAULT_FILTERS);
    expect(table.calls.filter((call) => call[0] === "in")).toHaveLength(0);
  });

  it("distinguishes comp=false from no preference", async () => {
    const table = fakeTable({ data: rows });
    const { client } = fakeClient({ salon_period_attributes: table });
    await new ReportingReadRepository(client).listSalons("p", {
      ...DEFAULT_FILTERS,
      compSalonOnly: false,
    });
    expect(table.calls).toEqual(
      expect.arrayContaining([["eq", "is_comp_salon", false]]),
    );
  });

  it("drops a row whose salon join did not resolve", async () => {
    const { client } = fakeClient({
      salon_period_attributes: fakeTable({ data: [{ ...rows[0], salons: null }] }),
    });
    const salons = await new ReportingReadRepository(client).listSalons("p", DEFAULT_FILTERS);
    expect(salons).toEqual([]);
  });
});
