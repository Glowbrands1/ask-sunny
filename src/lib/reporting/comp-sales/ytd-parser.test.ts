import { describe, expect, it } from "vitest";

import {
  buildYtdWorkbook,
  DEFAULT_YTD_SALONS,
  YTD_CONTRADICTORY_HEADERS,
  YTD_EXPECTED_RESOLUTION,
  YTD_LIVE_HEADERS,
  YTD_TRAILING_HEADERS,
  REPEAT_BLOCK_SENTINEL,
  ytdFixtureValue,
  type YtdFixtureOptions,
} from "../__fixtures__/comp-sales-ytd-workbook";
import { buildRollingWorkbook } from "../__fixtures__/comp-sales-rolling-workbook";
import { buildCompSalesWorkbook } from "../__fixtures__/comp-sales-workbook";
import { isReportParseError } from "../errors";
import { detectReport, parseReportWorkbook } from "../index";
import { readWorkbook } from "../workbook";
import { COMP_SALES_PARSER_KEY } from "./parser";
import { ROLLING_PARSER_KEY } from "./rolling-parser";
import { compSalesYtdParser, YTD_PARSER_KEY } from "./ytd-parser";

/**
 * THE YEAR-TO-DATE SHEET PARSER.
 *
 * Every fixture is generated in-process with invented data. The real workbook is
 * never committed and never read here; the env-gated dry run in
 * `real-workbook.dry-run.test.ts` is what exercises the real file.
 */

const KEY = { parserKey: YTD_PARSER_KEY };

async function parseYtd(options: YtdFixtureOptions = {}) {
  return parseReportWorkbook(await buildYtdWorkbook(options), KEY);
}

async function detectYtd(options: YtdFixtureOptions = {}) {
  return detectReport(await readWorkbook(await buildYtdWorkbook(options)), KEY);
}

describe("detection", () => {
  it("recognises the year-to-date sheet", async () => {
    const detection = await detectYtd();
    expect(detection.supported).toBe(true);
    if (detection.supported) {
      expect(detection.sheetName).toBe("CompReport(YTD)");
      expect(detection.markersMatched.join(" ")).toContain("year-to-date measure headers");
      expect(detection.markersMatched.join(" ")).toContain("year-to-date period marker");
    }
  });

  it("is structural, not by name", async () => {
    const detection = await detectYtd({ sheetName: "Invented Annual Export" });
    expect(detection.supported).toBe(true);
  });

  it("refuses the month-to-date sheets, whose grain disagrees", async () => {
    // This is the marker that separates the sheets. `CompReport(YTD)` shares its
    // descriptor band and much of its measure vocabulary with the other two, so
    // structure alone would match; the period marker's grain word is what says
    // this is a year, not a month.
    expect(detectReport(await readWorkbook(await buildRollingWorkbook()), KEY).supported).toBe(
      false,
    );
    expect(detectReport(await readWorkbook(await buildCompSalesWorkbook()), KEY).supported).toBe(
      false,
    );
  });

  it("does not let the other parsers PARSE the year-to-date sheet", async () => {
    // The month-to-date parsers identify a sheet structurally and treat the
    // period marker as a value question, not an identity one — deliberately, so
    // one bad cell is not reported as a changed template. So the year-comparison
    // parser can RECOGNISE this sheet: it shares the descriptor band and much of
    // the measure vocabulary.
    //
    // What it cannot do is read it. Its period detection demands a month-to-date
    // marker, this sheet states a year-to-date one, and it refuses rather than
    // filing seven months of accumulation as one month. That refusal is the
    // guarantee that matters, so it is the one asserted here.
    const bytes = await buildYtdWorkbook();
    for (const parserKey of [COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY]) {
      await expect(parseReportWorkbook(bytes, { parserKey })).rejects.toSatisfy(
        (error: unknown) => isReportParseError(error),
      );
    }
  });

  it("reports drift when a named sheet loses its measures", async () => {
    const detection = await detectYtd({
      omitHeaders: [...YTD_LIVE_HEADERS],
      includeContradictoryColumns: false,
      includeTrailingWindows: false,
      repeatBlockGap: null,
    });
    expect(detection.supported).toBe(false);
    if (!detection.supported) expect(detection.kind).toBe("template_drift");
  });
});

describe("the period", () => {
  it("reads a year-to-date period from a month-precision marker", async () => {
    const report = await parseYtd();
    expect(report.period).toMatchObject({
      grain: "ytd",
      periodStart: "2026-01-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      labelRaw: "YTD 07 2026",
    });
  });

  it("starts on 1 January, not on the first of the marker's month", async () => {
    // Year-to-date accumulates from the start of the year. A period starting in
    // July would describe one month and be labelled as seven.
    const report = await parseYtd({ periodMarker: "YTD 07 2026" });
    expect(report.period.periodStart).toBe("2026-01-01");
  });

  it("fails rather than assuming a period when the marker is missing", async () => {
    await expect(parseYtd({ periodMarker: null })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "period_unreadable",
    );
  });

  it("refuses a sheet whose marker states another grain", async () => {
    // A sheet carrying a month-to-date marker is not this report, whatever else
    // matches — and it is refused at DETECTION rather than at parse, because a
    // readable marker for another grain is a statement about which sheet this
    // is. Filing a month of figures under a year-to-date period would overstate
    // every one of them by roughly a factor of nine.
    const detection = await detectYtd({ periodMarker: "MTD 08/30/2026" });
    expect(detection.supported).toBe(false);
    if (!detection.supported) {
      expect(detection.markersMissing.join(" ")).toContain("states another grain");
    }
    await expect(parseYtd({ periodMarker: "MTD 08/30/2026" })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "template_drift",
    );
  });

  it("treats an unreadable marker as a bad cell, not a changed template", async () => {
    // The distinction matters to whoever has to act on it: "the period cell is
    // unreadable" sends someone to one cell, "the template has drifted" sends
    // them to compare a whole sheet against a parser.
    const detection = await detectYtd({ periodMarker: null });
    expect(detection.supported).toBe(true);
    await expect(parseYtd({ periodMarker: null })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "period_unreadable",
    );
  });
});

describe("the measure band", () => {
  it("produces a fact for every live measure on every salon", async () => {
    const report = await parseYtd();
    expect(report.salons).toHaveLength(DEFAULT_YTD_SALONS.length);
    // 8 measures x 2 years + 8 changes = 24 columns.
    expect(report.facts).toHaveLength(24 * DEFAULT_YTD_SALONS.length);
  });

  it("resolves every live header to the code and year the audit expects", async () => {
    const report = await parseYtd();
    const bySalon = report.facts.filter((fact) => fact.salonNumber === "0468");
    const seen = new Set(bySalon.map((fact) => `${fact.metricCode}|${fact.basisYear}`));
    for (const expected of Object.values(YTD_EXPECTED_RESOLUTION)) {
      expect(seen.has(`${expected.code}|${expected.basisYear}`)).toBe(true);
    }
    expect(seen.size).toBe(24);
  });

  it("compares against 2025, and carries no 2024 or 2019 baseline", async () => {
    const report = await parseYtd();
    const years = new Set(report.facts.map((fact) => fact.basisYear));
    expect([...years].sort()).toEqual([2025, 2026]);
  });

  it("reads a change column that names its year", async () => {
    const report = await parseYtd();
    const fact = report.facts.find(
      (entry) =>
        entry.salonNumber === "0468" &&
        entry.metricCode === "total_revenue_pct_change" &&
        entry.basisYear === 2025,
    );
    expect(fact?.value).toBe(ytdFixtureValue(0, "TY vs. 2025 % Change"));
  });

  it("reads a change column that does NOT name its year, from its block", async () => {
    // `UV Tans % Change` follows `2026 UV Tans` and `2025 UV Tans`. Refusing it
    // for naming no year would discard seven real measures over a header style.
    const report = await parseYtd();
    const fact = report.facts.find(
      (entry) =>
        entry.salonNumber === "0468" &&
        entry.metricCode === "uv_tans_pct_change" &&
        entry.basisYear === 2025,
    );
    expect(fact?.value).toBe(ytdFixtureValue(0, "UV Tans % Change"));
  });

  it("keeps source lineage on every fact", async () => {
    const report = await parseYtd();
    for (const fact of report.facts) {
      expect(fact.sourceSheet).toBe("CompReport(YTD)");
      expect(fact.sourceColumn).toMatch(/^[A-Z]{1,3}$/);
      expect(fact.sourceRow).toBeGreaterThan(0);
    }
  });

  it("carries a basis year on every fact, because this sheet is year-keyed", async () => {
    const report = await parseYtd();
    for (const fact of report.facts) {
      expect(fact.basisYear).not.toBeNull();
      expect(fact.metricBasisYearRequired).toBe(true);
    }
  });
});

describe("the contradictory AJ/AK pair", () => {
  /**
   * The sheet carries a SECOND column headed `2025 Total Revenue`, holding a
   * different figure from the one two columns earlier, followed by a change
   * headed `TY vs. 2024 % Change` computed from it — on a sheet with no 2024
   * figure anywhere. Two labels contradict each other and neither can be
   * confirmed, so both columns are excluded and reported.
   */
  it("keeps the first 2025 total revenue column and drops the second", async () => {
    const report = await parseYtd();
    const facts = report.facts.filter(
      (fact) =>
        fact.salonNumber === "0468" &&
        fact.metricCode === "total_revenue" &&
        fact.basisYear === 2025,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe(ytdFixtureValue(0, "YTD 2025 Total Revenue"));
    expect(facts[0].value).not.toBe(ytdFixtureValue(0, "2025 Total Revenue"));
  });

  it("publishes no 2024 comparison at all", async () => {
    const report = await parseYtd();
    expect(report.facts.some((fact) => fact.basisYear === 2024)).toBe(false);
  });

  it("says why the pair was excluded, naming both columns", async () => {
    const report = await parseYtd();
    const warning = report.warnings.find((entry) =>
      entry.message.includes("name different years for one comparison"),
    );
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("2025 Total Revenue");
    expect(warning?.message).toContain("TY vs. 2024 % Change");
    expect(warning?.message).toMatch(/EXCLUDED/);
  });

  it("ignores the column that merely repeats total revenue", async () => {
    // `2026 Revenue (if >24 mos. old)` equals the total revenue column exactly
    // on every row of the real sheet, and answers a different question.
    const report = await parseYtd();
    const facts = report.facts.filter(
      (fact) =>
        fact.salonNumber === "0468" &&
        fact.metricCode === "total_revenue" &&
        fact.basisYear === 2026,
    );
    expect(facts).toHaveLength(1);
  });

  it("still reads the sheet correctly when the pair is absent", async () => {
    // A future template that drops the contradiction must not change what the
    // other measures resolve to.
    const withPair = await parseYtd();
    const without = await parseYtd({ includeContradictoryColumns: false });
    expect(without.facts).toHaveLength(withPair.facts.length);
    expect(new Set(without.facts.map((f) => `${f.metricCode}|${f.basisYear}`))).toEqual(
      new Set(withPair.facts.map((f) => `${f.metricCode}|${f.basisYear}`)),
    );
  });
});

describe("the trailing-window block", () => {
  it("produces no trailing-window fact", async () => {
    // Seven of the eight blocks are byte-identical to the month-to-date sheet's
    // and the eighth contradicts that, so they are not year-to-date figures.
    const report = await parseYtd();
    expect(report.facts.some((fact) => /_last_\d+m_/.test(fact.metricCode))).toBe(false);
  });

  it("does not let a trailing change column stand in for the real one", async () => {
    // `Last 3 Months % Change` names no year, so the block rule would attach it
    // to the preceding Total Revenue block — becoming an exact duplicate of the
    // real change column, right answer for the wrong reason. Remove the real
    // column and it would silently take its place.
    //
    // It does not. With the real change column gone the sheet is missing a
    // required measure and the whole file is refused, which is the correct
    // outcome: a Total Revenue change is either reported or it is not.
    const detection = await detectYtd({ omitHeaders: ["TY vs. 2025 % Change"] });
    expect(detection.supported).toBe(false);
    if (!detection.supported) {
      expect(detection.markersMissing.join(" ")).toContain("total_revenue_pct_change");
    }
    await expect(parseYtd({ omitHeaders: ["TY vs. 2025 % Change"] })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "template_drift",
    );
  });

  it("reports the exclusion rather than skipping it silently", async () => {
    const report = await parseYtd();
    const warning = report.warnings.find((entry) =>
      entry.message.includes("trailing-window columns"),
    );
    expect(warning).toBeDefined();
    expect(warning?.message).toContain(String(YTD_TRAILING_HEADERS.length));
  });

  it("parses identically whether or not the block is present", async () => {
    const withBlock = await parseYtd();
    const without = await parseYtd({ includeTrailingWindows: false });
    expect(without.facts).toHaveLength(withBlock.facts.length);
  });
});

describe("failing closed", () => {
  it("refuses a duplicate measure inside the live band", async () => {
    await expect(
      parseYtd({ duplicateInBand: "2026 Total Tans", repeatBlockGap: null }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isReportParseError(error) &&
        error.code === "template_drift" &&
        /total_tans/.test(error.message),
    );
  });

  it("refuses a duplicate salon number, naming the numbers and nothing else", async () => {
    const salons = [
      DEFAULT_YTD_SALONS[0],
      DEFAULT_YTD_SALONS[1],
      { ...DEFAULT_YTD_SALONS[2], salonNumber: DEFAULT_YTD_SALONS[0].salonNumber },
    ];
    await expect(parseYtd({ salons })).rejects.toSatisfy((error: unknown) => {
      if (!isReportParseError(error)) return false;
      if (error.code !== "duplicate_salon_number") return false;
      if (!error.message.includes("0468")) return false;
      // No store name and no figure leaks into the message; a decimal point is
      // the tell for a measure, and the salon number itself is an integer.
      return !/Invented Store/.test(error.message) && !/\d+\.\d/.test(error.message);
    });
  });

  it("refuses a sheet missing the core comparison", async () => {
    await expect(
      parseYtd({
        omitHeaders: ["YTD 2026 Total Revenue", "YTD 2025 Total Revenue"],
        includeContradictoryColumns: false,
        includeTrailingWindows: false,
        repeatBlockGap: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "template_drift",
    );
  });

  it("refuses a third basis year rather than publishing it", async () => {
    // Rolling the years forward is fine. A third baseline changes what the
    // report means and must be reviewed before the figures are published.
    await expect(
      parseYtd({
        extraBasisYearHeaders: ["2023 Total Tans"],
        repeatBlockGap: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isReportParseError(error) &&
        error.code === "template_drift" &&
        /basis years/.test(error.message),
    );
  });

  it("refuses a sheet with no salon rows", async () => {
    await expect(parseYtd({ salons: [] })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "no_data_rows",
    );
  });
});

describe("the salon band", () => {
  it("preserves a leading zero", async () => {
    const report = await parseYtd();
    expect(report.salons.map((salon) => salon.salonNumber)).toContain("0468");
    expect(report.facts.some((fact) => fact.salonNumber === "0468")).toBe(true);
  });

  it("carries the period's reported attributes", async () => {
    const report = await parseYtd();
    expect(
      report.salonPeriodAttributes.find((entry) => entry.salonNumber === "0468"),
    ).toMatchObject({
      districtLabel: "Invented District One",
      regionLabel: "Invented Region North",
      ownershipGroup: "Invented Group A",
      quintileGroup: "Top 20%",
      revenueRank: 12,
      isCompSalon: true,
    });
  });

  it("names unused template slots as placeholders, not as lost keys", async () => {
    const report = await parseYtd({ templatePlaceholderRows: 6 });
    expect(new Set(report.skippedRows.map((row) => row.reason)).has("missing_salon_number")).toBe(
      false,
    );
  });

  it("skips the summary rows above the data band", async () => {
    const report = await parseYtd({ headerRow: 8 });
    expect(report.salons).toHaveLength(DEFAULT_YTD_SALONS.length);
  });
});

describe("the stale repeat block", () => {
  it("reads none of it", async () => {
    // The real sheet's repeat is headed `Est. 2014 Total Revenue` and
    // `2013 Total Revenue` — a template copy from years past. The fixture fills
    // it with negative sentinels, so a single one reaching a fact is obvious.
    const report = await parseYtd();
    // A `% change` fact is legitimately negative, so the sentinel is a value no
    // real measure could take.
    expect(report.facts.some((fact) => fact.value <= REPEAT_BLOCK_SENTINEL)).toBe(false);
    expect(report.facts.some((fact) => (fact.basisYear ?? 0) < 2025)).toBe(false);
  });
});

describe("the parsed report", () => {
  it("declares its own parser identity, sheet and grain", async () => {
    const report = await parseYtd();
    expect(report.parserKey).toBe("comp_sales_ytd");
    expect(report.parserVersion).toBe(1);
    expect(report.reportFamily).toBe("comp_sales");
    expect(report.sourceSheetNames).toEqual(["CompReport(YTD)"]);
    expect(report.period.grain).toBe("ytd");
  });

  it("needs no human adjudication once it parses", async () => {
    const report = await parseYtd();
    expect(report.diagnostics.requiresReview).toBe(false);
  });

  it("keeps one fact per salon, metric and basis year", async () => {
    const report = await parseYtd();
    const keys = report.facts.map(
      (fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is registered under its own key, distinct from the other two", () => {
    expect(compSalesYtdParser.key).toBe("comp_sales_ytd");
    expect(compSalesYtdParser.key).not.toBe(COMP_SALES_PARSER_KEY);
    expect(compSalesYtdParser.key).not.toBe(ROLLING_PARSER_KEY);
  });

  it("names every column it excluded, so nothing is dropped silently", async () => {
    const report = await parseYtd();
    const text = report.warnings.map((warning) => warning.message).join(" ");
    expect(text).toMatch(/trailing-window columns/);
    expect(text).toMatch(/name different years for one comparison/);
    // Both halves of the contradictory pair are named in that warning.
    for (const header of YTD_CONTRADICTORY_HEADERS.slice(1)) {
      expect(text).toContain(header);
    }
    // And the stale repeat is accounted for: the live table ends at a blank
    // column and everything past it is named as a stale copy.
    expect(text).toMatch(/the live measure table ends at the blank column/);
    expect(text).toMatch(/OTC Revenue MTD/);
  });
});
