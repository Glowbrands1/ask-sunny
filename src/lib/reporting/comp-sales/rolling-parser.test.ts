import { describe, expect, it } from "vitest";

import {
  buildRollingWorkbook,
  DEFAULT_ROLLING_SALONS,
  ROLLING_FIXTURE_HEADERS,
  rollingFixtureValue,
  type RollingFixtureOptions,
} from "../__fixtures__/comp-sales-rolling-workbook";
import { buildCompSalesWorkbook } from "../__fixtures__/comp-sales-workbook";
import { isReportParseError } from "../errors";
import { detectReport, parseReportWorkbook } from "../index";
import { readWorkbook } from "../workbook";
import { compSalesRollingParser, ROLLING_PARSER_KEY } from "./rolling-parser";
import { COMP_SALES_PARSER_KEY } from "./parser";

/**
 * THE ROLLING SHEET PARSER.
 *
 * Every fixture is generated in-process with invented data. The real workbook is
 * never committed and never read here; the env-gated dry run in
 * `real-workbook.dry-run.test.ts` is what exercises the real file.
 */

const KEY = { parserKey: ROLLING_PARSER_KEY };

async function parseRolling(options: RollingFixtureOptions = {}) {
  return parseReportWorkbook(await buildRollingWorkbook(options), KEY);
}

async function detectRolling(options: RollingFixtureOptions = {}) {
  return detectReport(await readWorkbook(await buildRollingWorkbook(options)), KEY);
}

describe("detection", () => {
  it("recognises the rolling sheet", async () => {
    const detection = await detectRolling();
    expect(detection.supported).toBe(true);
    if (detection.supported) {
      expect(detection.sheetName).toBe("CompReport(MTD)");
      expect(detection.markersMatched.join(" ")).toContain("rolling window headers");
    }
  });

  it("is structural, not by name", async () => {
    // A sheet with the right structure under a different name is still accepted.
    const detection = await detectRolling({ sheetName: "Invented Rolling Export" });
    expect(detection.supported).toBe(true);
  });

  it("reports drift when a named sheet loses its rolling headers", async () => {
    const detection = await detectRolling({
      omitHeaders: [...ROLLING_FIXTURE_HEADERS],
      repeatBlockGap: null,
    });
    expect(detection.supported).toBe(false);
    if (!detection.supported) {
      expect(detection.kind).toBe("template_drift");
      expect(detection.markersMissing.join(" ")).toContain("rolling window headers");
    }
  });

  it("does not claim the vs-2024 sheet", async () => {
    // The two parsers read different sheets of the same workbook. A loose name
    // or marker check here would make each claim the other's sheet, and
    // whichever ran first would win.
    const detection = detectReport(await readWorkbook(await buildCompSalesWorkbook()), KEY);
    expect(detection.supported).toBe(false);
  });

  it("does not let the vs-2024 parser claim the rolling sheet", async () => {
    const detection = detectReport(await readWorkbook(await buildRollingWorkbook()), {
      parserKey: COMP_SALES_PARSER_KEY,
    });
    expect(detection.supported).toBe(false);
  });

  it("refuses an unknown parser key rather than falling back", async () => {
    // Falling back would file one sheet's figures under another view's name.
    const detection = detectReport(await readWorkbook(await buildRollingWorkbook()), {
      parserKey: "invented_parser",
    });
    expect(detection.supported).toBe(false);
    if (!detection.supported) expect(detection.reason).toContain("invented_parser");

    await expect(
      parseReportWorkbook(await buildRollingWorkbook(), { parserKey: "invented_parser" }),
    ).rejects.toThrow(/invented_parser/);
  });
});

describe("period", () => {
  it("reads the period from the sheet", async () => {
    const report = await parseRolling();
    expect(report.period).toMatchObject({
      grain: "mtd",
      periodEnd: "2026-08-30",
      periodStart: "2026-08-01",
      fiscalYear: 2026,
    });
  });

  it("fails rather than assuming today when the marker is missing", async () => {
    await expect(parseRolling({ periodMarker: null })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "period_unreadable",
    );
  });

  it("fails on a marker it cannot read", async () => {
    await expect(parseRolling({ periodMarker: "sometime last month" })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "period_unreadable",
    );
  });
});

describe("the rolling band", () => {
  it("produces a fact for all 24 measures on every salon", async () => {
    const report = await parseRolling();
    expect(report.salons).toHaveLength(DEFAULT_ROLLING_SALONS.length);
    expect(report.facts).toHaveLength(24 * DEFAULT_ROLLING_SALONS.length);

    const codes = new Set(report.facts.map((fact) => fact.metricCode));
    expect(codes.size).toBe(24);
  });

  it("carries no basis year, because the window is the period", async () => {
    const report = await parseRolling();
    for (const fact of report.facts) {
      expect(fact.basisYear).toBeNull();
      expect(fact.metricBasisYearRequired).toBe(false);
    }
  });

  it("reads the value the source stated, not a derived one", async () => {
    const report = await parseRolling();
    const salonIndex = 1;
    const salonNumber = DEFAULT_ROLLING_SALONS[salonIndex].salonNumber;

    // The 3-month revenue change, exactly as the fixture wrote it. Nothing is
    // recomputed from the current/prior pair.
    const changeColumn = ROLLING_FIXTURE_HEADERS.indexOf("Last 3 Months % Change");
    const fact = report.facts.find(
      (entry) =>
        entry.salonNumber === salonNumber &&
        entry.metricCode === "total_revenue_last_3m_pct_change",
    );
    expect(fact?.value).toBe(rollingFixtureValue(salonIndex, changeColumn));
  });

  it("keeps source lineage on every fact", async () => {
    const report = await parseRolling();
    for (const fact of report.facts) {
      expect(fact.sourceSheet).toBe("CompReport(MTD)");
      expect(fact.sourceColumn).toMatch(/^[A-Z]{1,3}$/);
      expect(fact.sourceRow).toBeGreaterThan(0);
    }
  });

  it("excludes the repeated block instead of merging it", async () => {
    const report = await parseRolling();

    // The fixture fills the repeat with negative sentinels, so a single one
    // reaching a fact would be unmistakable.
    expect(report.facts.some((fact) => fact.value < -1 && fact.value > -100)).toBe(false);
    expect(
      report.warnings.some((warning) => warning.code === "out_of_band_column"),
    ).toBe(true);
  });

  it("reports a window the sheet does not carry", async () => {
    const report = await parseRolling({
      omitHeaders: [
        "Current Yr Last 12 Months Revenue",
        "Prior Yr Last 12 Months Revenue",
        "Last 12 Months % Change",
      ],
      repeatBlockGap: null,
    });

    const codes = new Set(report.facts.map((fact) => fact.metricCode));
    expect(codes.has("total_revenue_last_12m_current")).toBe(false);
    expect(codes.size).toBe(21);
    expect(
      report.warnings.filter((warning) => warning.code === "missing_metric_header").length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("failing closed", () => {
  it("refuses a duplicate mapping inside the live band", async () => {
    // Ingesting 22 of 24 measures would leave a view that looks complete and is
    // not, so this is a hard failure rather than a warning.
    await expect(
      parseRolling({
        duplicateInBand: "Current Yr Last 3 mos. Revenue",
        repeatBlockGap: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isReportParseError(error) &&
        error.code === "template_drift" &&
        /total_revenue_last_3m_current/.test(error.message),
    );
  });

  it("refuses a duplicate salon number, naming the numbers and nothing else", async () => {
    const salons = [
      DEFAULT_ROLLING_SALONS[0],
      DEFAULT_ROLLING_SALONS[1],
      { ...DEFAULT_ROLLING_SALONS[2], salonNumber: DEFAULT_ROLLING_SALONS[0].salonNumber },
    ];

    await expect(parseRolling({ salons })).rejects.toSatisfy((error: unknown) => {
      if (!isReportParseError(error)) return false;
      if (error.code !== "duplicate_salon_number") return false;
      // The number is named, because that is what makes it actionable...
      if (!error.message.includes("0468")) return false;
      // ...and no store name and no figure appear anywhere in it. A decimal is
      // the tell for a leaked measure; the salon number itself is an integer.
      return !/Invented Store/.test(error.message) && !/\d+\.\d/.test(error.message);
    });
  });

  it("refuses a sheet missing a required rolling measure", async () => {
    await expect(
      parseRolling({
        omitHeaders: ["Last 3 mo. Total Tans % Change"],
        repeatBlockGap: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "template_drift",
    );
  });

  it("refuses a sheet with no salon rows", async () => {
    await expect(parseRolling({ salons: [] })).rejects.toSatisfy(
      (error: unknown) => isReportParseError(error) && error.code === "no_data_rows",
    );
  });
});

describe("the salon band", () => {
  it("preserves a leading zero", async () => {
    const report = await parseRolling();
    expect(report.salons.map((salon) => salon.salonNumber)).toContain("0468");
    expect(report.facts.some((fact) => fact.salonNumber === "0468")).toBe(true);
  });

  it("carries the period's reported attributes", async () => {
    const report = await parseRolling();
    const attributes = report.salonPeriodAttributes.find(
      (entry) => entry.salonNumber === "0468",
    );
    expect(attributes).toMatchObject({
      districtLabel: "Invented District One",
      regionLabel: "Invented Region North",
      ownershipGroup: "Invented Group A",
      quintileGroup: "Top 20%",
      revenueRank: 12,
      isCompSalon: true,
    });
  });

  it("names unused template slots as placeholders, not as lost keys", async () => {
    const report = await parseRolling({ templatePlaceholderRows: 6 });
    const reasons = new Set(report.skippedRows.map((row) => row.reason));
    expect(reasons.has("missing_salon_number")).toBe(false);
  });

  it("skips the summary rows above the data band", async () => {
    const report = await parseRolling({ headerRow: 8 });
    // Rows 3 and 4 carry "Filtered Totals >>>" style labels with no salon.
    expect(report.salons).toHaveLength(DEFAULT_ROLLING_SALONS.length);
  });
});

describe("the parsed report", () => {
  it("declares its own parser identity and sheet", async () => {
    const report = await parseRolling();
    expect(report.parserKey).toBe("comp_sales_mtd_rolling");
    expect(report.parserVersion).toBe(1);
    expect(report.reportFamily).toBe("comp_sales");
    expect(report.sourceSheetNames).toEqual(["CompReport(MTD)"]);
  });

  it("needs no human adjudication once it parses", async () => {
    // Every duplicate and every missing core measure has already thrown, so a
    // report that gets here is not "possibly wrong, please look".
    const report = await parseRolling();
    expect(report.diagnostics.requiresReview).toBe(false);
  });

  it("keeps one fact per salon, metric and window", async () => {
    const report = await parseRolling();
    const keys = report.facts.map(
      (fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear ?? -1}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is registered under its own key", () => {
    expect(compSalesRollingParser.key).toBe("comp_sales_mtd_rolling");
    expect(compSalesRollingParser.key).not.toBe(COMP_SALES_PARSER_KEY);
  });
});
