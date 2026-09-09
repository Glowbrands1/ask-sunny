import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { looksLikeHtmlReport, readHtmlReport } from "./html-report";
import {
  SALES_TOTALS_MEASURES,
  SALES_TOTALS_METRIC_CODES,
  SALES_TOTALS_WINDOWS,
} from "./sales-totals/metric-map";
import {
  detectSalesTotals,
  parseSalesTotals,
  SALES_TOTALS_PARSER_KEY,
} from "./sales-totals/parser";
import { aggregateMeasure } from "./read/sales-totals-aggregate";
import type { SalesTotalsSubject } from "./read/sales-totals-read";
import { orderSalonsByMetric } from "./read/sales-totals-view";
import { readWorkbook } from "./workbook";

/**
 * ============================================================================
 * REAL-WORKBOOK DRY RUN — READ ONLY
 * ============================================================================
 *
 * Point the variable at the real file and run:
 *
 *   SALES_TOTALS_XLS=/path/to/SalesTotals.xls npm run dry-run:sales-totals
 *
 * Skipped entirely when the variable is unset, so the normal suite is
 * unaffected and no real file is ever required to make the build pass. The
 * committed suite uses a synthetic fixture — the real delivery carries the
 * takings of 249 salons and fifteen named stores, which does not belong in a
 * git history.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   * It does not upload anything, to Storage or anywhere else.
 *   * It does not insert a single row.
 *   * It does not print salon-level figures. Structural facts, counts and
 *     HEADER TEXT are reported — header names are needed for mapping review;
 *     the money behind them is not, and a CI log is not a place for company
 *     financials.
 *
 * ============================================================================
 * WHY THE ASSERTIONS ARE IDENTITIES RATHER THAN CONSTANTS
 * ============================================================================
 *
 * A hard-coded "$11,838.81" would put a real business figure in the repository
 * AND would stop being true tomorrow morning, because this report is delivered
 * daily. An identity is both stronger and permanent: it holds for every future
 * delivery and it cannot be satisfied by a parser that reads the wrong column.
 * The four asserted here are
 *
 *   six measures, in column order, each a (current day, MTD) pair with the MTD
 *   column immediately right of its day column;
 *   every estate figure lying BETWEEN its two sub-scopes, which an average must
 *   and a sum cannot;
 *   the dashboard's aggregate of a summable measure equalling the sum of the
 *   rows it aggregated, and PPTA refusing to produce one at all;
 *   the briefing's ordering keeping every salon and sinking the unreported.
 *
 * THE FILE IS NOT A WORKBOOK. `SalesTotals.xls` is an HTML page wearing an
 * .xls extension, complete with a `<script src>` and a `<form action>`. This
 * dry run reads it through `html-report.ts` — the same text extractor the
 * ingestion path uses, which never constructs a DOM — and asserts that the
 * sniffer recognises it from its CONTENT rather than its filename, because the
 * whole problem with this source is that the extension lies.
 */

const SALES_PATH = process.env.SALES_TOTALS_XLS;

if (SALES_PATH && !existsSync(SALES_PATH)) {
  throw new Error(`SALES_TOTALS_XLS is set but no file exists at: ${SALES_PATH}`);
}

const available = Boolean(SALES_PATH && existsSync(SALES_PATH));

/** Structural report lines. The output IS the deliverable of a dry run. */
function report(lines: string[]): void {
  console.log(lines.join("\n"));
}

describe.skipIf(!available)("Sales Totals — real delivery", () => {
  it("parses, and every derived figure agrees with the source", async () => {
    const path = SALES_PATH as string;
    const bytes = new Uint8Array(readFileSync(path));

    /* ------------------------------------------------ it is HTML, not xlsx */
    const isHtml = looksLikeHtmlReport(bytes);
    const workbook = isHtml ? readHtmlReport(bytes) : await readWorkbook(bytes);

    const detection = detectSalesTotals(workbook);
    const parsed = parseSalesTotals(workbook);

    const lines = [
      "=== SALES TOTALS DRY RUN (read-only) ===",
      `  file size (bytes): ${statSync(path).size}`,
      `  sha256: ${createHash("sha256").update(bytes).digest("hex")}`,
      `  recognised as HTML from its content, not its extension: ${isHtml}`,
      `  sheets: ${workbook.sheetNames.join(" | ")}`,
      `  parser detected: ${detection.supported}`,
      `  structural markers matched: ${
        detection.supported ? detection.markersMatched.join(" ; ") : "-"
      }`,
      `  parser: ${parsed.parserKey} v${parsed.parserVersion}`,
      `  report date: ${parsed.reportDate} (source wrote it ${parsed.reportDateRaw})`,
      `  month-to-date window opens: ${parsed.monthStart}`,
      `  windows per measure: ${SALES_TOTALS_WINDOWS.map((w) => w.id).join(", ")}`,
      `  estate summary rows: ${parsed.summaryRows.length} (${parsed.summaryRows
        .map((row) => `${row.scopeLabel}/${row.salonCount ?? "?"}`)
        .join(" | ")})`,
      `  salon rows in the delivery: ${parsed.salonRows.length}`,
      `  values parsed: ${parsed.diagnostics.valueCount}`,
      `  measure column pairs (code: current-day, MTD): ${parsed.diagnostics.measureColumns
        .map((entry) => `${entry.code}: ${entry.daily}, ${entry.mtd}`)
        .join(" | ")}`,
      `  warnings: ${parsed.warnings.length}`,
    ];

    expect(isHtml, "the delivery is an HTML page wearing an .xls extension").toBe(true);
    expect(detection.supported, `detection failed: ${JSON.stringify(detection)}`).toBe(true);
    expect(parsed.parserKey).toBe(SALES_TOTALS_PARSER_KEY);

    /* ------------------------------------------------ the six measures, paired */
    /*
     * EVERY MEASURE PRESENT, EACH AS A PAIR, IN COLUMN ORDER, AND THE MTD
     * COLUMN IMMEDIATELY RIGHT OF ITS DAY COLUMN.
     *
     * This is the assertion that catches the failure mode that matters most: a
     * column inserted, removed or reordered upstream shifts every figure one
     * measure to the left, and every individual number still looks plausible.
     */
    expect(parsed.diagnostics.measureColumns.map((entry) => entry.code)).toEqual([
      ...SALES_TOTALS_METRIC_CODES,
    ]);
    for (const entry of parsed.diagnostics.measureColumns) {
      expect(entry.mtd, `${entry.code} MTD must sit immediately right of its day column`).toBe(
        entry.daily + 1,
      );
    }

    /* ------------------------------------------------------- both windows, everywhere */
    for (const row of [...parsed.summaryRows, ...parsed.salonRows]) {
      for (const measure of SALES_TOTALS_MEASURES) {
        for (const window of ["daily", "mtd"] as const) {
          expect(
            row.values.some(
              (value) => value.metricCode === measure.code && value.window === window,
            ),
            `${row.scopeLabel} is missing ${measure.code} for ${window}`,
          ).toBe(true);
        }
      }
    }

    /* ---------------------------------------- the estate block really is averages */
    /*
     * THE IDENTITY THAT PROVES IT, AND IT IS NOT THE WEIGHTED MEAN.
     *
     * `sales-totals/metric-map.ts` records that the summary block holds
     * per-salon averages, verified against the 09-02 delivery by reproducing
     * All Salons Grand Total as the weighted mean of the two sub-scopes to the
     * cent. Run against a later delivery, that reproduction holds for the
     * CURRENT-DAY Grand Total and not for the rest — measured on 09-03:
     *
     *   grand_total daily   824.1365 vs 824.14 reported   to the cent
     *   grand_total mtd    2399.07  vs 2438.86 reported   $39.79 apart
     *   ppta daily            2.4237 vs    2.38 reported   1.8% apart
     *   the four counts    within 0.7 of integers          rounded
     *
     * The counts are averages rounded to whole numbers, so they cannot be
     * exact. The month-to-date figures are further off than rounding explains,
     * which means the source's month-to-date average uses a denominator it does
     * not publish — the same thing `sales-totals-aggregate.ts` already records
     * about PPTA, and the reason it refuses to combine PPTA at all.
     *
     * So the weighted mean is reported below as a DIAGNOSTIC, not asserted: a
     * test that demanded it would fail on a delivery for a reason that is a
     * property of the source rather than a defect in the parser.
     *
     * WHAT IS ASSERTED IS BETWEEN-NESS, which is rounding-proof, denominator-
     * proof and permanent: a weighted mean of two values must lie between them,
     * and a SUM of two positive values cannot. Every measure and both windows
     * must satisfy it. That is the property the presentation layer depends on —
     * it is what makes "Average sales per salon" the honest heading and "Grand
     * Total" a card that would overstate the business 249-fold.
     */
    const summaryBy = (label: string) =>
      parsed.summaryRows.find((row) => row.scopeLabel.toLowerCase() === label);
    const all = summaryBy("all salons");
    const consolidated = summaryBy("stc consolidated");
    const franchisees = summaryBy("stc franchisees");

    expect(all, "the delivery must carry an All Salons estate row").toBeDefined();

    if (all && consolidated && franchisees) {
      const counts = {
        all: all.salonCount ?? 0,
        consolidated: consolidated.salonCount ?? 0,
        franchisees: franchisees.salonCount ?? 0,
      };
      expect(
        counts.consolidated + counts.franchisees,
        "the two sub-scopes must account for every salon in All Salons",
      ).toBe(counts.all);

      let between = 0;
      let reproducedExactly = 0;
      let compared = 0;
      const notBetween: string[] = [];

      for (const measure of SALES_TOTALS_MEASURES) {
        for (const window of ["daily", "mtd"] as const) {
          const pick = (row: typeof all) =>
            row.values.find(
              (value) => value.metricCode === measure.code && value.window === window,
            )?.value ?? null;
          const a = pick(all);
          const c = pick(consolidated);
          const f = pick(franchisees);
          if (a === null || c === null || f === null || counts.all === 0) continue;
          compared += 1;

          // A whole unit of tolerance, because the counts are averages the
          // source rounded to integers before publishing them.
          const low = Math.min(c, f) - 1;
          const high = Math.max(c, f) + 1;
          if (a >= low && a <= high) between += 1;
          else notBetween.push(`${measure.code}/${window}`);

          const weighted =
            (counts.consolidated * c + counts.franchisees * f) / counts.all;
          if (Math.abs(weighted - a) <= 0.01) reproducedExactly += 1;
        }
      }

      lines.push(
        `  estate figures compared: ${compared}`,
        `  estate figures lying between their two sub-scopes (an average must, a total cannot): ${between}`,
        `  estate figures reproduced exactly as a weighted mean (diagnostic only — see the note in this test): ${reproducedExactly}`,
      );

      expect(
        notBetween,
        "every estate figure must lie between its two sub-scopes; one that does not is a total, and the presentation layer labels these as averages",
      ).toEqual([]);
      expect(compared, "there must be estate figures to compare").toBeGreaterThan(0);
    }

    /* ------------------------------ the aggregate agrees with the rows it sums */
    /*
     * The dashboard's own aggregator, run over the parsed salon rows, must
     * reproduce the sum of those rows for a summable measure and REFUSE to
     * produce one for PPTA. That is the identity that keeps the chat briefing
     * and the dashboard saying the same thing: both call this function.
     */
    const subjects: SalesTotalsSubject[] = parsed.salonRows.map((row) => ({
      kind: "salon",
      key: row.scopeLabel,
      label: row.scopeLabel,
      salonNumber: null,
      salonCount: null,
      figures: SALES_TOTALS_MEASURES.map((measure) => ({
        metricCode: measure.code,
        metricLabel: measure.label,
        unit: measure.unit,
        aggregation: measure.aggregation,
        summaryIsAverage: measure.summaryIsAverage,
        note: measure.note,
        value:
          row.values.find(
            (value) => value.metricCode === measure.code && value.window === "daily",
          )?.value ?? null,
      })),
    }));

    const tans = aggregateMeasure(subjects, "tans");
    const manualTans = subjects.reduce((total, subject) => {
      const value = subject.figures.find((figure) => figure.metricCode === "tans")?.value;
      return value === null || value === undefined ? total : total + value;
    }, 0);
    expect(tans.basis).toBe("summed");
    expect(tans.value).toBe(manualTans);

    const ppta = aggregateMeasure(subjects, "ppta");
    expect(ppta.basis, "PPTA is an average at every scope and must never combine").toBe(
      "not_aggregatable",
    );
    expect(ppta.value).toBeNull();
    expect(ppta.reason, "a refusal must carry its reason").toBeTruthy();

    lines.push(
      `  aggregate of a summable measure equals the sum of its rows: true`,
      `  PPTA refused a combined figure, with a reason: true`,
    );

    /* ------------------------------- the ordering the briefing truncates through */
    /*
     * A salon with no figure for the selected measure must sink rather than
     * sort as zero, and every salon must survive the ordering — the chat
     * briefing writes all six measures per row, so dropping a salon because one
     * measure was blank there would lose it from the answer entirely.
     */
    const ordered = orderSalonsByMetric(subjects, "grand_total");
    expect(ordered).toHaveLength(subjects.length);
    const values = ordered.map(
      (subject) =>
        subject.figures.find((figure) => figure.metricCode === "grand_total")?.value ?? null,
    );
    const reported = values.filter((value): value is number => value !== null);
    expect(
      [...reported].sort((left, right) => right - left),
      "the ordering must be descending on the selected measure",
    ).toEqual(reported);
    expect(
      values.slice(reported.length).every((value) => value === null),
      "salons with no figure for the measure must sink to the bottom",
    ).toBe(true);

    lines.push(
      `  ordering keeps every salon and sinks the unreported: true`,
      `  skipped rows / warnings: ${parsed.warnings.join(" ; ") || "none"}`,
    );

    report(lines);
  });
});
