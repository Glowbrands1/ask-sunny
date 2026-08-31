import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCompSalesWorkbook } from "./__fixtures__/comp-sales-workbook";
import { COMP_SALES_METRICS, METRICS_BY_CODE } from "./comp-sales/metric-map";
import { parseReportWorkbook } from "./index";
import type { ParsedReport } from "./types";

/**
 * DATABASE CONTRACT VALIDATION.
 *
 * Checkpoint 4 does not insert anything. This suite instead proves that what
 * the parser produces WOULD satisfy the schema already deployed, by reading the
 * rules out of the migration SQL rather than restating them here.
 *
 * That indirection is the point. A hand-copied regex in a test drifts silently
 * the moment someone edits the migration; a regex extracted from the migration
 * cannot. If a constraint changes and the parser no longer satisfies it, this
 * file fails — which is exactly the failure we want before an ingest route
 * exists to discover it against a live project.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
    .join("\n");
}

/** Strips `--` comment lines so prose cannot satisfy an assertion. */
function statementsOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const SQL = statementsOnly(allMigrationSql());

/** Pulls the regex literal out of a named `check (... ~ '...')` constraint. */
function checkRegex(constraintName: string): RegExp {
  const pattern = new RegExp(
    `constraint\\s+${constraintName}\\s+check\\s*\\([^~)]*~\\s*'([^']+)'`,
    "i",
  );
  const found = pattern.exec(SQL);
  if (!found) throw new Error(`No check constraint regex found for ${constraintName}`);
  return new RegExp(found[1]);
}

/** The 8 base metric codes seeded by the reporting seed migration. */
function seededBaseCodes(): string[] {
  const insertStart = SQL.indexOf("insert into public.report_metrics (code, label, family, unit");
  expect(insertStart, "seed insert for report_metrics").toBeGreaterThan(-1);
  const block = SQL.slice(insertStart, SQL.indexOf("on conflict (code) do nothing", insertStart));
  return [...block.matchAll(/^\s*\('([a-z][a-z0-9_]*)',/gm)].map((match) => match[1]);
}

/** Every code the deployed catalogue holds: the 8 base plus their % changes. */
function seededCodes(): string[] {
  const base = seededBaseCodes();
  return [...base, ...base.map((code) => `${code}_pct_change`)];
}

let report: ParsedReport;

async function parsed(): Promise<ParsedReport> {
  report ??= await parseReportWorkbook(
    await buildCompSalesWorkbook({ withStaleDuplicateBlock: true, withUnknownColumns: true }),
  );
  return report;
}

describe("the parser's metric vocabulary matches the deployed catalogue", () => {
  it("seeds exactly 16 codes, and the parser maps exactly those", () => {
    const seeded = seededCodes();
    expect(seeded).toHaveLength(16);
    expect(new Set(METRICS_BY_CODE.keys())).toEqual(new Set(seeded));
  });

  it("never invents a metric code", async () => {
    const seeded = new Set(seededCodes());
    for (const fact of (await parsed()).facts) {
      expect(seeded.has(fact.metricCode), fact.metricCode).toBe(true);
    }
  });

  it("gives every code a form report_metrics_code_format accepts", () => {
    const codeFormat = checkRegex("report_metrics_code_format");
    for (const metric of COMP_SALES_METRICS) {
      expect(metric.code, metric.code).toMatch(codeFormat);
    }
  });

  it("marks only percentage metrics as a comparison, as the schema requires", () => {
    // `report_metrics_comparison_is_percent`: comparison_of implies unit=percent.
    for (const metric of COMP_SALES_METRICS) {
      if (metric.comparisonOf !== null) expect(metric.unit).toBe("percent");
    }
  });

  it("never makes a metric a comparison of itself", () => {
    for (const metric of COMP_SALES_METRICS) {
      expect(metric.comparisonOf).not.toBe(metric.code);
    }
  });
});

describe("facts satisfy comp_sales_facts", () => {
  it("matches the basis-year rule the composite key enforces", async () => {
    // `comp_sales_facts_basis_year_matches_metric`:
    //   metric_basis_year_required = (basis_year is not null)
    for (const fact of (await parsed()).facts) {
      expect(fact.metricBasisYearRequired).toBe(fact.basisYear !== null);
      // And the flag must agree with the catalogue, or the composite FK has no
      // parent row to point at.
      expect(fact.metricBasisYearRequired).toBe(
        METRICS_BY_CODE.get(fact.metricCode)?.basisYearRequired,
      );
    }
  });

  it("keeps every basis year inside the plausible range", async () => {
    for (const fact of (await parsed()).facts) {
      if (fact.basisYear === null) continue;
      expect(fact.basisYear).toBeGreaterThanOrEqual(1990);
      expect(fact.basisYear).toBeLessThanOrEqual(2100);
    }
  });

  it("populates lineage in the form source_column expects", async () => {
    const columnFormat = checkRegex("comp_sales_facts_source_column_format");
    for (const fact of (await parsed()).facts) {
      expect(fact.sourceColumn).toMatch(columnFormat);
      // `comp_sales_facts_source_sheet_not_blank`
      expect(fact.sourceSheet.trim().length).toBeGreaterThan(0);
      expect(fact.sourceRow).toBeGreaterThan(0);
    }
  });

  it("holds a finite numeric value on every fact", async () => {
    for (const fact of (await parsed()).facts) {
      expect(Number.isFinite(fact.value)).toBe(true);
    }
  });

  it("satisfies the live business key: one fact per salon, period, metric, year", async () => {
    // `comp_sales_facts_live_key` on
    //   (salon_id, period_id, metric_id, coalesce(basis_year, -1))
    // One period per report, so the salon/metric/year triple must be unique.
    const keys = (await parsed()).facts.map(
      (fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear ?? -1}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("references only salons the report also declares", async () => {
    const result = await parsed();
    const declared = new Set(result.salons.map((salon) => salon.salonNumber));
    for (const fact of result.facts) {
      expect(declared.has(fact.salonNumber), fact.salonNumber).toBe(true);
    }
  });
});

describe("salons satisfy the text business key", () => {
  it("matches salons_salon_number_format", async () => {
    const format = checkRegex("salons_salon_number_format");
    for (const salon of (await parsed()).salons) {
      expect(salon.salonNumber, salon.salonNumber).toMatch(format);
    }
  });

  it("proves the key is text by round-tripping a leading zero", async () => {
    const result = await parsed();
    const padded = result.salons.find((salon) => salon.salonNumber.startsWith("0"));
    expect(padded, "fixture must include a zero-padded salon").toBeDefined();
    expect(padded?.salonNumber).toBe("0468");
    // The integer-coerced form is a DIFFERENT key and must not appear.
    expect(result.salons.some((salon) => salon.salonNumber === "468")).toBe(false);
  });

  it("keeps salon_number unique, as salons_salon_number_key requires", async () => {
    const numbers = (await parsed()).salons.map((salon) => salon.salonNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("never leaves store_name blank, as salons_store_name_not_blank requires", async () => {
    for (const salon of (await parsed()).salons) {
      expect(salon.storeName.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("attributes satisfy salon_period_attributes", () => {
  it("emits one attribute row per salon for the single period", async () => {
    const result = await parsed();
    // `salon_period_attributes_live_key` is unique on (salon_id, period_id).
    const keys = result.salonPeriodAttributes.map((attributes) => attributes.salonNumber);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(result.salons.length);
  });

  it("respects the schema's numeric floors", async () => {
    for (const attributes of (await parsed()).salonPeriodAttributes) {
      if (attributes.spaPieces !== null) expect(attributes.spaPieces).toBeGreaterThanOrEqual(0);
      if (attributes.revenueRank !== null) expect(attributes.revenueRank).toBeGreaterThanOrEqual(1);
      if (attributes.salonAgeYears !== null) expect(attributes.salonAgeYears).toBeGreaterThanOrEqual(0);
      if (attributes.avgClientAge !== null) expect(attributes.avgClientAge).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps manager names as period-scoped labels, never as identities", async () => {
    const result = await parsed();
    // District/region live only on the period-scoped record.
    for (const salon of result.salons) {
      expect(Object.keys(salon)).not.toContain("districtLabel");
      expect(Object.keys(salon)).not.toContain("regionLabel");
    }
    expect(
      result.salonPeriodAttributes.some((attributes) => attributes.districtLabel !== null),
    ).toBe(true);
  });
});

describe("period satisfies report_periods", () => {
  it("matches the fiscal-year check", async () => {
    const { period } = await parsed();
    // `report_periods_fiscal_year_matches`
    expect(period.fiscalYear).toBe(Number(period.periodEnd.slice(0, 4)));
  });

  it("keeps period_start on or before period_end", async () => {
    const { period } = await parsed();
    expect(period.periodStart <= period.periodEnd).toBe(true);
  });

  it("never leaves label_raw blank", async () => {
    const { period } = await parsed();
    expect(period.labelRaw.trim().length).toBeGreaterThan(0);
  });

  it("uses a grain the report_period_grain enum declares", async () => {
    const { period } = await parsed();
    const enumBlock = /create type public\.report_period_grain as enum \(([^)]+)\)/.exec(SQL);
    expect(enumBlock).not.toBeNull();
    const labels = [...(enumBlock?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    expect(labels).toContain(period.grain);
  });
});

describe("ingestion identity satisfies report_ingestions", () => {
  it("uses a parser key the schema's format accepts", async () => {
    const format = checkRegex("report_ingestions_parser_key_format");
    expect((await parsed()).parserKey).toMatch(format);
  });

  it("uses a report family the schema's format accepts", async () => {
    const format = checkRegex("report_sources_family_format");
    expect((await parsed()).reportFamily).toMatch(format);
  });

  it("reports a parser version the schema's check accepts", async () => {
    // `check (parser_version >= 1)`
    expect((await parsed()).parserVersion).toBeGreaterThanOrEqual(1);
  });

  it("names the sheets it read, for report_ingestions.source_sheet_names", async () => {
    const result = await parsed();
    expect(result.sourceSheetNames.length).toBeGreaterThan(0);
    // Every fact's sheet must be one the ingestion claims to have read.
    for (const fact of result.facts) {
      expect(result.sourceSheetNames).toContain(fact.sourceSheet);
    }
  });

  it("keeps warnings free of workbook figures", async () => {
    // report_ingestions.warnings is surfaced in an admin view; it must never
    // carry report content.
    for (const warning of (await parsed()).warnings) {
      expect(warning.message).not.toMatch(/999999|888888/);
    }
  });
});
