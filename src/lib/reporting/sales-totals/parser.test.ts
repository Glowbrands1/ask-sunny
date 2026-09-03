import { describe, expect, it } from "vitest";

import {
  salesTotalsFixtureBytes,
  salesTotalsFixtureHtml,
} from "../__fixtures__/sales-totals-report";
import { ReportParseError } from "../errors";
import { looksLikeHtmlReport, readHtmlReport } from "../html-report";
import { SALES_TOTALS_MEASURES } from "./metric-map";
import {
  detectSalesTotals,
  parseSalesTotals,
  parseSalesTotalsDate,
  parseSalesTotalsNumber,
  SALES_TOTALS_FAMILY,
  SALES_TOTALS_PARSER_KEY,
} from "./parser";

/**
 * THE SALES TOTALS PARSER.
 *
 * Every figure here is invented; the STRUCTURE is faithful to the real report.
 * The two real samples (09-01-2026 and 09-02-2026) were parsed during
 * development and are not committed — they carry live salon financials.
 *
 * The tests worth reading are the fail-closed ones. This parser turns an
 * untrusted HTML document into money, and the failure that matters is not a
 * crash: it is a column shifting sideways so that Tans are filed as EFTs and
 * every number on the dashboard is confidently wrong.
 */

function parse(options = {}) {
  return parseSalesTotals(readHtmlReport(salesTotalsFixtureBytes(options)));
}

function valueOf(
  row: { values: readonly { metricCode: string; window: string; value: number | null }[] },
  metricCode: string,
  window: "daily" | "mtd",
): number | null {
  const found = row.values.find(
    (value) => value.metricCode === metricCode && value.window === window,
  );
  if (!found) throw new Error(`No ${metricCode} (${window}) on this row`);
  return found.value;
}

describe("recognising the file at all", () => {
  it("sees HTML wearing an .xls extension", () => {
    // The whole trap: the extension says workbook, the bytes say HTML.
    expect(looksLikeHtmlReport(salesTotalsFixtureBytes())).toBe(true);
  });

  it("does not mistake a real xlsx for HTML", () => {
    // A ZIP local-file header, which is how every .xlsx begins.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(looksLikeHtmlReport(zip)).toBe(false);
  });

  it("is unbothered by a BOM or leading whitespace", () => {
    const withBom = new TextEncoder().encode(`﻿\n  ${salesTotalsFixtureHtml()}`);
    expect(looksLikeHtmlReport(withBom)).toBe(true);
  });

  it("detects the report and names the markers it matched", () => {
    const detection = detectSalesTotals(readHtmlReport(salesTotalsFixtureBytes()));
    expect(detection.supported).toBe(true);
    if (detection.supported) expect(detection.markersMatched).toContain("09-02-2026");
  });
});

describe("script and markup are never treated as data or followed", () => {
  it("never reads script source as a report value", () => {
    /*
     * THE TEST THAT MATTERS MOST HERE. The script body below is written to look
     * exactly like a data row. If `<script>` contents survived into the cell
     * scanner, this would become a scope called "Injected Scope" with a
     * fabricated total, and it would look like a figure somebody sent us.
     */
    const report = parse({
      scriptBody:
        'document.write("<tr><td>Injected Scope</td><td>999</td><td>$999.99</td><td>$999.99</td></tr>");',
    });

    const labels = [
      ...report.summaryRows.map((row) => row.scopeLabel),
      ...report.salonRows.map((row) => row.scopeLabel),
    ];
    expect(labels).not.toContain("Injected Scope");
    expect(JSON.stringify(report)).not.toContain("document.write");
    expect(JSON.stringify(report)).not.toContain("999.99");
  });

  it("never surfaces the script src or the form action", () => {
    // Nothing is fetched because no attribute is ever read. Proven by their
    // absence from the parsed output.
    const serialized = JSON.stringify(parse());
    expect(serialized).not.toContain("number_formats.js");
    expect(serialized).not.toContain("SalesTotals.php");
    expect(serialized.toLowerCase()).not.toContain("javascript");
  });

  it("ignores a row hidden in an HTML comment", () => {
    const html = salesTotalsFixtureHtml().replace(
      "<tr><td>All Salons</td>",
      "<!-- <tr><td>Commented Scope</td><td>1</td></tr> --><tr><td>All Salons</td>",
    );
    const report = parseSalesTotals(readHtmlReport(new TextEncoder().encode(html)));
    expect(report.summaryRows.map((row) => row.scopeLabel)).not.toContain("Commented Scope");
  });
});

describe("the report date comes from the content", () => {
  it("reads it from the heading, not the filename", () => {
    const report = parse({ reportDate: "10-31-2026" });
    expect(report.reportDate).toBe("2026-10-31");
    expect(report.reportDateRaw).toBe("10-31-2026");
  });

  it("derives the MTD window's start from the month, not from the day", () => {
    // MTD opens on the first of the month whatever day the report covers.
    expect(parse({ reportDate: "09-02-2026" }).monthStart).toBe("2026-09-01");
    expect(parse({ reportDate: "12-25-2026" }).monthStart).toBe("2026-12-01");
  });

  it("parses MM-DD-YYYY and refuses impossible dates", () => {
    expect(parseSalesTotalsDate("Sales Totals for 09-02-2026")?.iso).toBe("2026-09-02");
    // The month is first: this is 1 February, not 2 January.
    expect(parseSalesTotalsDate("02-01-2026")?.iso).toBe("2026-02-01");
    for (const bad of ["13-01-2026", "02-30-2026", "00-10-2026", "09-2026", "not a date"]) {
      expect(parseSalesTotalsDate(bad), bad).toBeNull();
    }
  });

  it("fails closed when the date heading is missing", () => {
    // Guessing the date from the delivery time would file a whole day of
    // figures under the wrong day, silently.
    expect(() => parse({ omitDateHeading: true })).toThrow(ReportParseError);
  });
});

describe("the six measures", () => {
  it("reads all six, with both windows, for every row", () => {
    const report = parse();
    const codes = SALES_TOTALS_MEASURES.map((measure) => measure.code);
    expect(codes).toHaveLength(6);

    for (const row of [...report.summaryRows, ...report.salonRows]) {
      expect(row.values).toHaveLength(12); // 6 measures x 2 windows
      for (const code of codes) {
        expect(valueOf(row, code, "daily"), `${row.scopeLabel} ${code} daily`).not.toBeNull();
        expect(valueOf(row, code, "mtd"), `${row.scopeLabel} ${code} mtd`).not.toBeNull();
      }
    }
  });

  it("keeps the day value and the MTD value apart", () => {
    /*
     * The pairing IS the report: each measure owns two adjacent columns. Reading
     * them into one field, or swapping them, is the defect this catches.
     */
    const report = parse();
    const all = report.summaryRows.find((row) => row.scopeLabel === "All Salons")!;
    expect(valueOf(all, "grand_total", "daily")).toBe(811.11);
    expect(valueOf(all, "grand_total", "mtd")).toBe(1622.22);
    expect(valueOf(all, "tans", "daily")).toBe(121);
    expect(valueOf(all, "tans", "mtd")).toBe(242);
  });

  it("does not shift figures when a measure is renamed upstream", () => {
    /*
     * THE SILENT-CORRUPTION CASE. A renamed header must fail, not be skipped:
     * skipping would slide EFTs into the Tans slot and every later measure
     * along with it.
     */
    expect(() => parse({ renameMeasure: { Tans: "Sessions" } })).toThrow(/Tans/);
  });

  it("fails closed when a measure's column pair is removed", () => {
    expect(() => parse({ dropMeasure: "EFTs" })).toThrow(ReportParseError);
  });

  it("fails closed when the MTD column stops saying MTD", () => {
    // If the right-hand column were relabelled to something else, it is no
    // longer safe to assume it is cumulative.
    expect(() => parse({ mtdLabel: "Month" })).toThrow(/MTD/);
  });

  it("reads currency and counts in the formats the report uses", () => {
    expect(parseSalesTotalsNumber("$1,601.20")).toBe(1601.2);
    expect(parseSalesTotalsNumber("239")).toBe(239);
    expect(parseSalesTotalsNumber("$0.00")).toBe(0);
    // Accounting negative.
    expect(parseSalesTotalsNumber("($45.10)")).toBe(-45.1);
  });

  it("treats a blank as unavailable rather than zero", () => {
    /*
     * A salon that reported nothing and a salon that took nothing are different
     * facts, and only one of them is $0.
     */
    for (const blank of ["", "   ", "-", "—"]) {
      expect(parseSalesTotalsNumber(blank), JSON.stringify(blank)).toBeNull();
    }
    expect(parseSalesTotalsNumber("n/a")).toBeNull();
  });
});

describe("the two blocks are different populations", () => {
  it("returns summary scopes with their salon counts", () => {
    const report = parse();
    expect(report.summaryRows.map((row) => row.scopeLabel)).toEqual([
      "All Salons",
      "STC Consolidated",
      "STC Franchisees",
    ]);
    expect(report.summaryRows.map((row) => row.salonCount)).toEqual([249, 98, 151]);
    // A summary scope has no owning company; it IS the grouping.
    expect(report.summaryRows.every((row) => row.company === null)).toBe(true);
  });

  it("returns salon rows with their company and no salon count", () => {
    const report = parse();
    expect(report.salonRows.map((row) => row.scopeLabel)).toEqual([
      "KS Lawrence",
      "MO Kansas City Liberty",
      "NE Omaha 144th and Center",
    ]);
    expect(report.salonRows.every((row) => row.company === "STC Franchisees")).toBe(true);
    expect(report.salonRows.every((row) => row.salonCount === null)).toBe(true);
  });

  it("never files a summary scope as a salon", () => {
    /*
     * "All Salons" as a salon row would appear in a salon ranking as the
     * biggest store in the estate. The two blocks stay separate.
     */
    const report = parse();
    const salonLabels = report.salonRows.map((row) => row.scopeLabel);
    for (const scope of ["All Salons", "STC Consolidated", "STC Franchisees"]) {
      expect(salonLabels).not.toContain(scope);
    }
    expect(report.summaryRows.every((row) => row.scopeKind === "summary")).toBe(true);
    expect(report.salonRows.every((row) => row.scopeKind === "salon")).toBe(true);
  });

  it("records that the summary figures are averages, not totals", () => {
    /*
     * WHY THIS IS PINNED. In the real 09-02-2026 report:
     *   (98 x 734.50 + 151 x 872.94) / 249 = 818.45, the All Salons figure.
     * It is a per-salon AVERAGE. A KPI card calling it a total would overstate
     * the business by a factor of 249, so the flag has to travel with the
     * measure rather than living in somebody's memory.
     */
    expect(SALES_TOTALS_MEASURES.every((measure) => measure.summaryIsAverage)).toBe(true);
  });

  it("marks PPTA as never summable", () => {
    // Money per transaction. An average of averages is not the average.
    const ppta = SALES_TOTALS_MEASURES.find((measure) => measure.code === "ppta")!;
    expect(ppta.aggregation).toBe("average");
  });

  it("fails closed when either block has no data rows", () => {
    expect(() => parse({ omitSalonBlock: true })).toThrow(ReportParseError);
    expect(() => parse({ omitSummaryData: true })).toThrow(ReportParseError);
  });
});

describe("determinism and identity", () => {
  it("produces identical output for identical bytes", () => {
    // The basis of idempotency upstream: same file, same facts, every time.
    expect(JSON.stringify(parse())).toBe(JSON.stringify(parse()));
  });

  it("carries its parser identity for lineage", () => {
    const report = parse();
    expect(report.parserKey).toBe(SALES_TOTALS_PARSER_KEY);
    expect(report.reportFamily).toBe(SALES_TOTALS_FAMILY);
    expect(report.parserVersion).toBeGreaterThanOrEqual(1);
  });

  it("counts what it read, for a caller that wants to check", () => {
    const report = parse();
    // (3 summary + 3 salon) rows x 6 measures x 2 windows.
    expect(report.diagnostics.valueCount).toBe(6 * 6 * 2);
    expect(report.diagnostics.summaryRowCount).toBe(3);
    expect(report.diagnostics.salonRowCount).toBe(3);
    expect(report.warnings).toHaveLength(0);
  });
});

describe("things that are not this report", () => {
  it("refuses an empty file", () => {
    expect(() => readHtmlReport(new Uint8Array())).toThrow(ReportParseError);
  });

  it("refuses HTML with no tables", () => {
    const bytes = new TextEncoder().encode("<html><title>Something else</title></html>");
    // Reads, because it is HTML with a heading — then fails detection.
    expect(() => parseSalesTotals(readHtmlReport(bytes))).toThrow(ReportParseError);
  });

  it("refuses a different report that happens to be HTML", () => {
    const bytes = new TextEncoder().encode(
      "<html><title>Payroll Summary</title><h3>Payroll for 09-02-2026</h3>" +
        "<table><tr><th>Employee</th><th>Hours</th></tr>" +
        "<tr><td>Invented Person</td><td>38</td></tr></table></html>",
    );
    expect(() => parseSalesTotals(readHtmlReport(bytes))).toThrow(ReportParseError);
  });

  it("says drift rather than unsupported when it IS Sales Totals but changed", () => {
    /*
     * The distinction is operational: "our parser is out of date" is somebody's
     * job to fix, "unrecognised file" means check what was sent.
     */
    const detection = detectSalesTotals(
      readHtmlReport(salesTotalsFixtureBytes({ renameMeasure: { Tans: "Sessions" } })),
    );
    expect(detection.supported).toBe(false);
    if (!detection.supported) expect(detection.kind).toBe("template_drift");
  });
});
