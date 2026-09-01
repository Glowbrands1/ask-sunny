import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { METRICS_BY_CODE } from "./comp-sales/metric-map";
import { resolveRollingColumns } from "./comp-sales/rolling-map";
import { asText } from "./cells";
import { SALON_NUMBER_PATTERN } from "./comp-sales/parser";
import { detectReport, parseReportWorkbook } from "./index";
import { ROLLING_PARSER_KEY } from "./comp-sales/rolling-parser";
import { columnLetter, readWorkbook } from "./workbook";

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

/**
 * THE ROLLING BAND, AGAINST THE REAL SHEET.
 *
 * The unit tests resolve headers I transcribed by hand; this resolves the ones
 * the workbook actually contains. Transcription is exactly the step where a
 * `mos.` quietly becomes a `mos`, so the two checks are not redundant — this is
 * the one that would catch it.
 *
 * Structure only. No figure from the data band is read, printed or asserted.
 */
describe.skipIf(!available)("rolling band on the real CompReport(MTD) sheet", () => {
  it("resolves all 24 rolling measures from the sheet's own header text", async () => {
    const bytes = new Uint8Array(readFileSync(workbookPath as string));
    const workbook = await readWorkbook(bytes);

    const sheet = workbook.sheet("CompReport(MTD)");
    expect(sheet, "CompReport(MTD) is present in the workbook").not.toBeNull();
    if (!sheet) return;

    // The descriptor header row, found structurally rather than by position.
    let headerRow = 0;
    for (let row = 1; row <= Math.min(sheet.rowCount, 60) && headerRow === 0; row += 1) {
      for (let column = 1; column <= 40; column += 1) {
        if (asText(sheet.cell(row, column)) === "Salon Number") {
          headerRow = row;
          break;
        }
      }
    }
    expect(headerRow).toBeGreaterThan(0);

    const headers: { column: number; letter: string; header: string }[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const header = asText(sheet.cell(headerRow, column)) ?? "";
      if (header !== "") {
        headers.push({ column, letter: columnLetter(column), header });
      }
    }

    const result = resolveRollingColumns(headers);
    const byCode = Object.fromEntries(
      result.resolved.map((entry) => [entry.code, entry.letter]),
    );

    const report = [
      "=== ROLLING BAND DRY RUN (read-only) ===",
      `  sheet: CompReport(MTD)`,
      `  descriptor header row: ${headerRow}`,
      `  non-empty headers on that row: ${headers.length}`,
      `  rolling measures resolved: ${result.resolved.length} of 24`,
      `  missing: ${result.missing.length === 0 ? "none" : result.missing.join(", ")}`,
      `  duplicates: ${result.duplicates.length}`,
      `  warnings: ${JSON.stringify(tally(result.warnings, (warning) => warning.code))}`,
      `  resolved columns: ${JSON.stringify(byCode)}`,
    ];
    console.log(report.join("\n"));

    expect(result.resolved).toHaveLength(24);
    expect(result.missing).toEqual([]);
    expect(result.duplicates).toEqual([]);
    // The repeated block further right must have been excluded, not merged.
    expect(
      result.warnings.some((warning) => warning.code === "out_of_band_column"),
    ).toBe(true);
  });
});

/**
 * THE ROLLING PARSER, END TO END, AGAINST THE REAL SHEET.
 *
 * The unit suite parses a synthetic sheet; this parses the file the business
 * actually sent. Structure and counts only — no salon-level figure is printed,
 * and the assertions are about shape, lineage and identity.
 */
describe.skipIf(!available)("rolling parser on the real workbook", () => {
  it("parses CompReport(MTD) into rolling facts with full lineage", async () => {
    const bytes = new Uint8Array(readFileSync(workbookPath as string));
    const workbook = await readWorkbook(bytes);

    const detection = detectReport(workbook, { parserKey: ROLLING_PARSER_KEY });
    expect(detection.supported, "the rolling sheet is detected").toBe(true);

    const parsed = await parseReportWorkbook(bytes, { parserKey: ROLLING_PARSER_KEY });

    const codes = new Set(parsed.facts.map((fact) => fact.metricCode));
    const columns = new Set(parsed.facts.map((fact) => fact.sourceColumn));
    const factKeys = parsed.facts.map(
      (fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear ?? -1}`,
    );

    const report: string[] = ["=== ROLLING PARSER DRY RUN (read-only) ==="];
    const line = (label: string, value: unknown) => report.push(`  ${label}: ${String(value)}`);
    line("sheet selected", parsed.diagnostics.sheetSelected);
    line("parser", `${parsed.parserKey} v${parsed.parserVersion}`);
    line("period", `${parsed.period.grain} ${parsed.period.periodStart}..${parsed.period.periodEnd}`);
    line("salons parsed", parsed.salons.length);
    line("salon numbers with a leading zero", parsed.salons.filter((s) => /^0/.test(s.salonNumber)).length);
    line("distinct rolling metrics", codes.size);
    line("facts produced", parsed.facts.length);
    line("source columns used", [...columns].sort().join(", "));
    line("warnings", JSON.stringify(tally(parsed.warnings, (warning) => warning.code)));
    line("skipped rows", JSON.stringify(tally(parsed.skippedRows, (row) => row.reason)));
    line("requires review", parsed.diagnostics.requiresReview);
    console.log(report.join("\n"));

    // Identity and scope.
    expect(parsed.parserKey).toBe("comp_sales_mtd_rolling");
    expect(parsed.sourceSheetNames).toEqual(["CompReport(MTD)"]);
    expect(parsed.period.grain).toBe("mtd");

    // All 24 measures, on all 15 salons, and nothing else.
    expect(codes.size).toBe(24);
    expect(parsed.salons).toHaveLength(15);
    expect(parsed.facts).toHaveLength(24 * 15);

    // The business key holds, and every fact carries lineage.
    expect(new Set(factKeys).size).toBe(factKeys.length);
    for (const fact of parsed.facts) {
      expect(fact.sourceSheet).toBe("CompReport(MTD)");
      expect(fact.sourceColumn).toMatch(/^[A-Z]{1,3}$/);
      expect(fact.basisYear).toBeNull();
      expect(fact.metricBasisYearRequired).toBe(false);
    }

    // Only the live band contributed: the repeat at GO..HC was excluded.
    expect([...columns].every((column) => !column.startsWith("G") && !column.startsWith("H")))
      .toBe(true);
    expect(parsed.warnings.some((warning) => warning.code === "out_of_band_column")).toBe(true);

    // Zero padding survives, and nothing needs adjudication.
    expect(parsed.salons.every((salon) => SALON_NUMBER_PATTERN.test(salon.salonNumber))).toBe(true);
    expect(parsed.diagnostics.requiresReview).toBe(false);

    // Percentages are fractions, so a scale error would show up here.
    for (const fact of parsed.facts) {
      if (fact.metricCode.endsWith("_pct_change")) expect(Math.abs(fact.value)).toBeLessThan(10);
    }
  });
});
