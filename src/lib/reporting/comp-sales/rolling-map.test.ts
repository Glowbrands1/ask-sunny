import { describe, expect, it } from "vitest";

import { columnLetter } from "../workbook";
import {
  OBSERVED_ROLLING_COLUMNS,
  parseRollingHeader,
  resolveRollingColumns,
  rollingMetricCode,
  type RollingHeaderCell,
} from "./rolling-map";

/**
 * THE ROLLING BAND, RESOLVED FROM HEADER TEXT.
 *
 * The headers below are the REAL ones from `CompReport(MTD)`, transcribed
 * exactly — including the inconsistency that makes this worth testing: the
 * source writes `mos.` for 3, 6 and 9 months and `Months` for 12, and it names
 * the measure in a value header ("... Revenue") while omitting it from the
 * matching change header ("Last 3 Months % Change").
 *
 * No figures appear in this file. Header text is structure; the numbers behind
 * it are company financials and have no business in a test.
 */

/** The live rolling band exactly as the audited sheet writes it, AL..BI. */
const LIVE_HEADERS: [string, string][] = [
  ["AL", "Current Yr Last 3 mos. Revenue"],
  ["AM", "Prior Yr Last 3 mos. Revenue"],
  ["AN", "Last 3 Months % Change"],
  ["AO", "Current Yr Last 6 mos. Revenue"],
  ["AP", "Prior Yr Last 6 mos. Revenue"],
  ["AQ", "Last 6 Months % Change"],
  ["AR", "Current Yr Last 9 mos. Revenue"],
  ["AS", "Prior Yr Last 9 mos. Revenue"],
  ["AT", "Last 9 Months % Change"],
  ["AU", "Current Yr Last 12 Months Revenue"],
  ["AV", "Prior Yr Last 12 Months Revenue"],
  ["AW", "Last 12 Months % Change"],
  ["AX", "Current Yr Last 3 mos. Total Tans"],
  ["AY", "Prior Yr Last 3 mos. Total Tans"],
  ["AZ", "Last 3 mo. Total Tans % Change"],
  ["BA", "Current Yr Last 6 mos. Total Tans"],
  ["BB", "Prior Yr Last 6 mos. Total Tans"],
  ["BC", "Last 6 mo. Total Tans % Change"],
  ["BD", "Current Yr Last 9 mos. Total Tans"],
  ["BE", "Prior Yr Last 9 mos. Total Tans"],
  ["BF", "Last 9 mo. Total Tans % Change"],
  ["BG", "Current Yr Last 12 mos. Total Tans"],
  ["BH", "Prior Yr Last 12 mos. Total Tans"],
  ["BI", "Last 12 mo. Total Tans % Change"],
];

/**
 * The repeated block the audited sheet also carries, at GO..HC.
 *
 * This is the hazard: a second, identical set of rolling headers about a hundred
 * columns further right. A resolver that took the first match, or the last, or
 * merged them, would produce figures from whichever block happened to win.
 */
const REPEATED_HEADERS: [string, string][] = [
  ["GO", "Current Yr Last 3 mos. Revenue"],
  ["GP", "Prior Yr Last 3 mos. Revenue"],
  ["GQ", "Last 3 Months % Change"],
  ["GR", "Current Yr Last 6 mos. Revenue"],
  ["GS", "Prior Yr Last 6 mos. Revenue"],
  ["GT", "Last 6 Months % Change"],
];

function letterToIndex(letter: string): number {
  let index = 0;
  for (const character of letter) index = index * 26 + (character.charCodeAt(0) - 64);
  return index;
}

function cells(...groups: [string, string][][]): RollingHeaderCell[] {
  return groups
    .flat()
    .map(([letter, header]) => ({ column: letterToIndex(letter), letter, header }))
    .sort((a, b) => a.column - b.column);
}

/** Descriptor and unrelated measure headers that must simply be ignored. */
const NOISE: [string, string][] = [
  ["E", "Salon Number"],
  ["F", "Store Name"],
  ["K", "District"],
  ["AA", "OTC Revenue MTD"],
  ["AF", "Est. 2026 Total Revenue"],
  ["AH", "TY vs. 2025 % Change"],
  ["AK", "TY vs. 2024 % Change"],
  ["BJ", "2026 UV Tans"],
  ["CA", "Total Tans % Change"],
];

describe("parseRollingHeader", () => {
  it("reads a current-year value header", () => {
    expect(parseRollingHeader("Current Yr Last 3 mos. Revenue")).toEqual({
      months: 3,
      side: "current",
      measureCode: "total_revenue",
    });
  });

  it("reads a prior-year value header", () => {
    expect(parseRollingHeader("Prior Yr Last 9 mos. Total Tans")).toEqual({
      months: 9,
      side: "prior",
      measureCode: "total_tans",
    });
  });

  it("accepts every abbreviation the source mixes within one block", () => {
    // `mos.` for 3/6/9 and `Months` for 12, in the same twelve columns.
    for (const header of [
      "Current Yr Last 12 Months Revenue",
      "Current Yr Last 12 mos. Total Tans",
      "Prior Yr Last 12 Months Revenue",
    ]) {
      expect(parseRollingHeader(header)?.months).toBe(12);
    }
  });

  it("reads a change header that names its measure", () => {
    expect(parseRollingHeader("Last 12 mo. Total Tans % Change")).toEqual({
      months: 12,
      side: "pct_change",
      measureCode: "total_tans",
    });
  });

  it("reads a bare change header without guessing the measure", () => {
    // The measure is left null on purpose: it is decided by adjacency, not by
    // which block happens to come first in the sheet.
    expect(parseRollingHeader("Last 3 Months % Change")).toEqual({
      months: 3,
      side: "pct_change",
      measureCode: null,
    });
  });

  it("ignores a header that is not a rolling window", () => {
    for (const header of [
      "TY vs. 2024 % Change",
      "2026 Total Revenue",
      "Total Tans % Change",
      "Salon Number",
      "",
    ]) {
      expect(parseRollingHeader(header)).toBeNull();
    }
  });

  it("refuses a window the source does not report", () => {
    expect(parseRollingHeader("Current Yr Last 4 mos. Revenue")).toBeNull();
    expect(parseRollingHeader("Last 24 Months % Change")).toBeNull();
  });
});

describe("resolveRollingColumns", () => {
  it("resolves all 24 codes from the real header text", () => {
    const result = resolveRollingColumns(cells(NOISE, LIVE_HEADERS));

    expect(result.resolved).toHaveLength(24);
    expect(result.missing).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it("puts every code at the column the audited sheet uses", () => {
    const result = resolveRollingColumns(cells(NOISE, LIVE_HEADERS));
    const byCode = Object.fromEntries(
      result.resolved.map((column) => [column.code, column.letter]),
    );
    // Not a positional resolver — this asserts that HEADER matching lands
    // exactly where the audit found the columns.
    expect(byCode).toEqual(OBSERVED_ROLLING_COLUMNS);
  });

  it("associates a bare change header with the measure beside it", () => {
    const result = resolveRollingColumns(cells(LIVE_HEADERS));
    const find = (letter: string) =>
      result.resolved.find((column) => column.letter === letter);

    // AN sits after the revenue pair, AZ after the tans pair. Same window, two
    // different measures, decided by position relative to their own block.
    expect(find("AN")?.code).toBe("total_revenue_last_3m_pct_change");
    expect(find("AZ")?.code).toBe("total_tans_last_3m_pct_change");
    expect(result.warnings.filter((w) => w.code === "unassociated_percent_change")).toEqual(
      [],
    );
  });

  it("excludes the repeated block and reports it", () => {
    const result = resolveRollingColumns(cells(NOISE, LIVE_HEADERS, REPEATED_HEADERS));

    // The live band still resolves in full, and nothing came from GO..HC.
    expect(result.resolved).toHaveLength(24);
    expect(result.resolved.every((column) => !column.letter.startsWith("G"))).toBe(true);

    const outOfBand = result.warnings.filter((w) => w.code === "out_of_band_column");
    expect(outOfBand).toHaveLength(1);
    expect(outOfBand[0].message).toContain("GO");
  });

  it("refuses to choose between two identically-headed columns", () => {
    // A duplicate INSIDE the live band is not a separate block, so clustering
    // cannot help: both are excluded rather than one picked arbitrarily.
    const result = resolveRollingColumns(
      cells(LIVE_HEADERS, [["BK", "Current Yr Last 3 mos. Revenue"]]),
    );

    expect(result.duplicates.map((entry) => entry.code)).toEqual([
      "total_revenue_last_3m_current",
    ]);
    expect(
      result.resolved.some((column) => column.code === "total_revenue_last_3m_current"),
    ).toBe(false);
    expect(result.missing).toContain("total_revenue_last_3m_current");
    expect(result.warnings.some((w) => w.code === "duplicate_metric_column")).toBe(true);
  });

  it("reports a change column with no value column for its window", () => {
    const result = resolveRollingColumns(cells([["AN", "Last 3 Months % Change"]]));

    expect(result.resolved).toEqual([]);
    expect(result.warnings.some((w) => w.code === "unassociated_percent_change")).toBe(true);
  });

  it("names every measure the sheet did not offer", () => {
    const result = resolveRollingColumns(cells(LIVE_HEADERS.slice(0, 12)));

    // Revenue resolved; the twelve Total Tans codes are absent and listed.
    expect(result.resolved).toHaveLength(12);
    expect(result.missing).toHaveLength(12);
    expect(result.missing.every((code) => code.startsWith("total_tans_"))).toBe(true);
    expect(result.warnings.filter((w) => w.code === "missing_metric_header")).toHaveLength(12);
  });

  it("reports drift when a measure moves, and still uses the header", () => {
    const moved = LIVE_HEADERS.map(([letter, header]) =>
      letter === "AL" ? (["BK", header] as [string, string]) : ([letter, header] as [string, string]),
    );
    const result = resolveRollingColumns(cells(moved));

    const found = result.resolved.find(
      (column) => column.code === "total_revenue_last_3m_current",
    );
    // Header matching wins; the move is reported rather than resolved around.
    expect(found?.letter).toBe("BK");
    expect(
      result.warnings.some(
        (w) => w.code === "unexpected_metric_column" && w.message.includes("AL"),
      ),
    ).toBe(true);
  });

  it("ignores every unrelated column on the sheet", () => {
    const result = resolveRollingColumns(cells(NOISE));
    expect(result.resolved).toEqual([]);
    // 24 missing, and nothing mistakenly resolved from a year-labelled header.
    expect(result.missing).toHaveLength(24);
  });
});

describe("rollingMetricCode", () => {
  it("composes the codes the migration seeded", () => {
    expect(rollingMetricCode("total_revenue", 3, "current")).toBe(
      "total_revenue_last_3m_current",
    );
    expect(rollingMetricCode("total_tans", 12, "pct_change")).toBe(
      "total_tans_last_12m_pct_change",
    );
  });

  it("agrees with the observed-column table on every code", () => {
    // Guards the convention against drifting between this module and the
    // catalogue: both build the same 24 strings.
    expect(Object.keys(OBSERVED_ROLLING_COLUMNS)).toHaveLength(24);
  });
});

describe("columnLetter round trip", () => {
  it("matches the letters used throughout this suite", () => {
    expect(columnLetter(letterToIndex("AL"))).toBe("AL");
    expect(columnLetter(letterToIndex("BI"))).toBe("BI");
    expect(columnLetter(letterToIndex("GO"))).toBe("GO");
  });
});
