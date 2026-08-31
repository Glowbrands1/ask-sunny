import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { METRICS_BY_CODE } from "./comp-sales/metric-map";
import { SALON_NUMBER_PATTERN } from "./comp-sales/parser";
import { detectReport, parseReportWorkbook } from "./index";
import { readWorkbook } from "./workbook";

/**
 * REAL-WORKBOOK DRY RUN — READ ONLY.
 *
 * Point `COMP_REPORT_XLSX` at the real workbook and run:
 *
 *   COMP_REPORT_XLSX=/path/to/workbook.xlsx npm run dry-run:comp-sales
 *
 * Skipped entirely when the variable is unset, so the normal suite is
 * unaffected and no real file is ever required to make the build pass.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   * It does not upload anything, to Storage or anywhere else.
 *   * It does not insert a single row.
 *   * It does not print salon-level figures. Only counts, structural facts and
 *     HEADER TEXT are reported — header names are needed for mapping review;
 *     the numbers behind them are not, and a CI log is not a place for company
 *     financials.
 */

const workbookPath = process.env.COMP_REPORT_XLSX;
const available = Boolean(workbookPath && existsSync(workbookPath));

if (workbookPath && !available) {
  throw new Error(`COMP_REPORT_XLSX is set but no file exists at: ${workbookPath}`);
}

/** Groups a list into `key -> count`, so nothing individual is echoed. */
function tally<T>(items: T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe.skipIf(!available)("real workbook dry run (read-only)", () => {
  it("parses the supplied workbook and reports structure only", async () => {
    const path = workbookPath as string;
    const bytes = new Uint8Array(readFileSync(path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const report: string[] = [];
    const line = (label: string, value: unknown) => report.push(`  ${label}: ${String(value)}`);

    report.push("=== COMP SALES DRY RUN (read-only) ===");
    line("file size (bytes)", statSync(path).size);
    line("sha256", sha256);

    const workbook = await readWorkbook(bytes);
    line("sheets in workbook", workbook.sheetNames.length);
    line("sheet names", workbook.sheetNames.join(" | "));

    const detection = detectReport(workbook);
    line("parser detected", detection.supported);
    if (detection.supported) {
      line("source sheet selected", detection.sheetName);
      line("structural markers matched", detection.markersMatched.join(" ; "));
    } else {
      line("rejection kind", detection.kind);
      line("reason", detection.reason);
      line("markers missing", detection.markersMissing.join(" ; "));
    }
    expect(detection.supported, `detection failed: ${JSON.stringify(detection)}`).toBe(true);

    const parsed = await parseReportWorkbook(bytes);

    report.push("--- period ---");
    line("grain", parsed.period.grain);
    line("period end", parsed.period.periodEnd);
    line("period start", parsed.period.periodStart);
    line("fiscal year", parsed.period.fiscalYear);
    line("source period label", parsed.period.labelRaw);

    report.push("--- volumes ---");
    line("salon rows parsed", parsed.salons.length);
    line("attribute rows produced", parsed.salonPeriodAttributes.length);
    line("supported facts produced", parsed.facts.length);
    line("warnings", parsed.warnings.length);
    line("skipped rows", parsed.skippedRows.length);
    line("descriptor header row", parsed.diagnostics.headerRow);
    line("measure header row", parsed.diagnostics.metricHeaderRow);
    line("REQUIRES REVIEW", parsed.diagnostics.requiresReview);
    line("first/last data row", `${parsed.diagnostics.firstDataRow}/${parsed.diagnostics.lastDataRow}`);
    line("columns scanned", parsed.diagnostics.columnsScanned);
    line("separator columns", parsed.diagnostics.separatorColumns.length);

    report.push("--- metric resolution (codes and counts only) ---");
    for (const [code, count] of Object.entries(tally(parsed.facts, (fact) => fact.metricCode)).sort()) {
      const years = [
        ...new Set(
          parsed.facts.filter((fact) => fact.metricCode === code).map((fact) => fact.basisYear),
        ),
      ].sort();
      line(code, `${count} facts, basis years [${years.join(", ")}]`);
    }

    report.push("--- resolved metric columns (header text, for mapping review) ---");
    for (const column of parsed.diagnostics.resolvedMetricColumns) {
      line(
        column.column,
        `"${column.header}" -> ${column.metricCode} (basis ${column.basisYear ?? "none"}, by ${column.resolvedBy})`,
      );
    }

    report.push("--- resolved dimension columns ---");
    for (const column of parsed.diagnostics.resolvedDimensionColumns) {
      line(column.column, `"${column.header}" -> ${column.field}`);
    }

    report.push("--- UNRESOLVED / UNKNOWN headers (ignored; review for mapping) ---");
    if (parsed.diagnostics.unresolvedColumns.length === 0) {
      report.push("  (none)");
    }
    for (const column of parsed.diagnostics.unresolvedColumns) {
      line(column.column, `"${column.header}"`);
    }

    report.push("--- findings that gate ingestion ---");
    for (const warning of parsed.warnings.filter((w) =>
      ["stale_header_suspected", "conflicting_metric_column", "out_of_band_column"].includes(w.code),
    )) {
      line(warning.code, warning.message);
    }

    report.push("--- warnings by code ---");
    for (const [code, count] of Object.entries(tally(parsed.warnings, (w) => w.code)).sort()) {
      line(code, count);
    }

    report.push("--- skipped rows by reason ---");
    for (const [reason, count] of Object.entries(tally(parsed.skippedRows, (r) => r.reason)).sort()) {
      line(reason, count);
    }

    // ---- structural validations, reported as booleans ----
    const everyFactHasLineage = parsed.facts.every(
      (fact) =>
        fact.sourceSheet.trim().length > 0 &&
        /^[A-Z]{1,3}$/.test(fact.sourceColumn) &&
        fact.sourceRow > 0,
    );
    const everyMetricSeeded = parsed.facts.every((fact) => METRICS_BY_CODE.has(fact.metricCode));
    const basisYearRuleHolds = parsed.facts.every(
      (fact) => fact.metricBasisYearRequired === (fact.basisYear !== null),
    );
    const factKeys = parsed.facts.map(
      (fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear ?? -1}`,
    );
    const uniquenessHolds = new Set(factKeys).size === factKeys.length;
    const salonKeysValid = parsed.salons.every((salon) =>
      SALON_NUMBER_PATTERN.test(salon.salonNumber),
    );
    const zeroPadded = parsed.salons.filter((salon) => /^0/.test(salon.salonNumber)).length;
    const metricUnitsConsistent = parsed.facts.every((fact) => {
      const mapping = METRICS_BY_CODE.get(fact.metricCode);
      if (!mapping) return false;
      // A percentage must be a fraction, so |value| beyond 10 is a scale error.
      return mapping.unit !== "percent" || Math.abs(fact.value) <= 10;
    });

    report.push("--- contract checks ---");
    line("every fact has valid source lineage", everyFactHasLineage);
    line("every metric code exists in the seeded catalogue", everyMetricSeeded);
    line("basis-year rule holds on every fact", basisYearRuleHolds);
    line("fact uniqueness grain holds", uniquenessHolds);
    line("every salon number fits the text key", salonKeysValid);
    line("salon numbers with a leading zero", zeroPadded);
    line("percent metrics are stored as fractions", metricUnitsConsistent);

    console.log(report.join("\n"));

    expect(everyFactHasLineage).toBe(true);
    expect(everyMetricSeeded).toBe(true);
    expect(basisYearRuleHolds).toBe(true);
    expect(uniquenessHolds).toBe(true);
    expect(salonKeysValid).toBe(true);
    expect(metricUnitsConsistent).toBe(true);
    expect(parsed.salons.length).toBeGreaterThan(0);
    expect(parsed.facts.length).toBeGreaterThan(0);
  });
});
