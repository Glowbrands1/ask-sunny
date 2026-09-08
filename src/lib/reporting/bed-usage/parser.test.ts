import { describe, expect, it } from "vitest";

import {
  BED_FIXTURE_AUTHORIZED_COMPANY,
  BED_FIXTURE_CHAIN,
  BED_FIXTURE_OTHER_COMPANY,
  BED_FIXTURE_ROWS,
  bedUsageFixtureBytes,
} from "../__fixtures__/bed-usage-workbook";
import { ReportParseError } from "../errors";
import {
  classifyVersusChain,
  isReportableFinding,
  percentFromRatio,
} from "../performance/classification";
import { readWorkbook } from "../workbook";
import {
  BED_USAGE_PARSER_KEY,
  detectBedUsage,
  parseBedUsage,
  parseBedUsageRange,
} from "./parser";

/**
 * The fixture's authorized company, not the production one: the parser takes
 * the company as a seam precisely so a test can scope to invented data.
 */
const SCOPE = { company: BED_FIXTURE_AUTHORIZED_COMPANY };

async function parse(options: Parameters<typeof bedUsageFixtureBytes>[0] = {}) {
  return parseBedUsage(await readWorkbook(await bedUsageFixtureBytes(options)), SCOPE);
}

describe("bed usage period extraction", () => {
  it("reads the range out of the report's own title", () => {
    expect(parseBedUsageRange("Bed Usage Report: 8/1/2026 to 8/31/2026")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
      label: "Bed Usage Report: 8/1/2026 to 8/31/2026",
    });
  });

  it("accepts the Usage Detail sheet's wording too", () => {
    expect(parseBedUsageRange("Bed Usage Detail: 1/1/2027 to 1/31/2027")?.start).toBe("2027-01-01");
  });

  it("refuses a date that is not a real calendar date", () => {
    // Rolling 8/32 forward into September is how a month's figures get filed
    // under the wrong period.
    expect(parseBedUsageRange("Bed Usage Report: 8/32/2026 to 8/31/2026")).toBeNull();
    expect(parseBedUsageRange("Bed Usage Report: 2/30/2026 to 3/31/2026")).toBeNull();
  });

  it("refuses a range that runs backwards", () => {
    expect(parseBedUsageRange("Bed Usage Report: 9/1/2026 to 8/1/2026")).toBeNull();
  });

  it("takes the period from the workbook, never from a filename", async () => {
    const report = await parse({ periodStart: "2027-03-01", periodEnd: "2027-03-31" });
    expect(report.period).toEqual({
      grain: "mtd",
      periodStart: "2027-03-01",
      periodEnd: "2027-03-31",
      fiscalYear: 2027,
      labelRaw: "Bed Usage Report: 3/1/2027 to 3/31/2027",
    });
  });

  it("refuses a workbook whose header band names two different periods", async () => {
    // Guessing between them would file one month's figures under the other.
    await expect(
      parse({ secondPeriodMarker: { start: "2026-07-01", end: "2026-07-31" } }),
    ).rejects.toMatchObject({ code: "period_unreadable" });
  });

  it("refuses a workbook whose two sheets disagree about the period", async () => {
    await expect(
      parse({ detailPeriod: { start: "2026-07-01", end: "2026-07-31" } }),
    ).rejects.toMatchObject({ code: "period_unreadable" });
  });
});

describe("bed usage report recognition", () => {
  it("recognises the report from its structure", async () => {
    const workbook = await readWorkbook(await bedUsageFixtureBytes());
    expect(detectBedUsage(workbook)).toMatchObject({ supported: true, sheetName: "Summary" });
  });

  it("reports an unrelated workbook as unsupported rather than as drift", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Sheet1").getCell("A1").value = "Quarterly headcount";
    const bytes = new Uint8Array((await other.xlsx.writeBuffer()) as ArrayBuffer);
    expect(detectBedUsage(await readWorkbook(bytes))).toMatchObject({
      supported: false,
      kind: "unsupported",
    });
  });

  it("reports a missing required column as template drift, naming it", async () => {
    const workbook = await readWorkbook(await bedUsageFixtureBytes({ dropColumn: "v Chain" }));
    const detection = detectBedUsage(workbook);
    expect(detection.supported).toBe(false);
    if (detection.supported) throw new Error("unreachable");
    expect(detection.kind).toBe("template_drift");
    expect(detection.markersMissing.join(" ")).toContain("usage v chain");
  });

  it("fails closed rather than reading a renamed column by position", async () => {
    // The failure mode this prevents: every measure silently shifting one
    // column sideways and the dashboard looking complete.
    await expect(
      parse({ renameColumn: { from: "per Bed", to: "per Unit" } }),
    ).rejects.toBeInstanceOf(ReportParseError);
  });

  it("tolerates an extra column the parser does not know about", async () => {
    const report = await parse({ extraTrailingColumn: "Tan Minutes" });
    expect(report.salons).toHaveLength(3);
  });

  it("records a missing OPTIONAL column as a warning rather than refusing", async () => {
    const report = await parse({ dropColumn: "Ratio" });
    expect(report.warnings.join(" ")).toContain("cnt/use ratio");
    expect(report.salons).toHaveLength(3);
  });
});

describe("company scoping", () => {
  it("keeps only the authorized company's salons", async () => {
    const report = await parse();
    expect(report.salons.map((salon) => salon.storeName)).toEqual([
      "Aurora Springs",
      "Brookmere Park",
      "Calder Vale",
    ]);
    expect(new Set(report.equipment.map((row) => row.company))).toEqual(
      new Set([BED_FIXTURE_AUTHORIZED_COMPANY]),
    );
  });

  it("never lets another company's salon reach the parsed report at all", async () => {
    const report = await parse();
    const serialised = JSON.stringify(report);
    // Not merely "is not rendered" — the other company's name and its salon
    // are absent from the object, so nothing downstream can leak them.
    expect(serialised).not.toContain(BED_FIXTURE_OTHER_COMPANY);
    expect(serialised).not.toContain("Dunmore Cross");
  });

  it("still counts the whole source population in diagnostics, without naming it", async () => {
    const report = await parse();
    // Coverage honesty: the banner needs to be able to say the delivery was
    // wider than the slice, and it needs a count to do that.
    expect(report.diagnostics.sourceSalonCount).toBe(4);
    expect(report.diagnostics.sourceCompanyCount).toBe(2);
  });

  it("refuses a delivery that holds no rows for the authorized company", async () => {
    const bytes = await bedUsageFixtureBytes();
    await expect(
      async () => parseBedUsage(await readWorkbook(bytes), { company: "Someone Else Ltd" }),
    ).rejects.toMatchObject({ code: "authorized_company_absent" });
  });
});

describe("salon totals are read once, never summed", () => {
  it("reads Total Tans from the salon's flagged row", async () => {
    const report = await parse();
    const aurora = report.salons.find((salon) => salon.storeName === "Aurora Springs")!;
    // 440 + 660 + 60. Summing the repeated column over three rows would give
    // 3,480 — the defect this test exists for.
    expect(aurora.totalTans).toBe(1160);
    expect(aurora.bedCount).toBe(5);
  });

  it("produces exactly one salon row per salon however many equipment rows it has", async () => {
    const report = await parse();
    expect(report.equipment).toHaveLength(8);
    expect(report.salons).toHaveLength(3);
  });

  it("agrees with the sum of its own equipment rows' client tans", async () => {
    // The identity that holds in the real report for all fifteen salons, and
    // the strongest available check that the right column was read.
    const report = await parse();
    for (const salon of report.salons) {
      const summed = report.equipment
        .filter((row) => row.storeName === salon.storeName)
        .reduce((total, row) => total + (row.clientTans ?? 0), 0);
      expect(summed).toBe(salon.totalTans);
    }
  });

  it("keeps client tans and tans-including-employees apart", async () => {
    const report = await parse();
    const instant = report.equipment.find(
      (row) => row.storeName === "Aurora Springs" && row.level === "INSTANT",
    )!;
    expect(instant.clientTans).toBe(660);
    expect(instant.totalTansWithEmployee).toBe(684);
  });
});

describe("v Chain is converted from a ratio to a percentage", () => {
  it("converts the source's multiple into a percentage difference", async () => {
    const report = await parse();
    const faster = report.equipment.find(
      (row) => row.storeName === "Aurora Springs" && row.level === "FASTER",
    )!;
    // 440 / 2 = 220 per bed against a chain average of 200 -> a ratio of 1.1.
    expect(faster.perBed).toBe(220);
    expect(faster.vChainRatio).toBeCloseTo(1.1, 10);
    expect(faster.vChainPercent).toBeCloseTo(10, 10);
  });

  it("keeps the raw ratio as the source stated it", async () => {
    const report = await parse();
    for (const row of report.equipment) {
      if (row.vChainRatio === null) continue;
      expect(row.vChainPercent).toBeCloseTo(percentFromRatio(row.vChainRatio)!, 10);
    }
  });

  it("classifies a level running at the chain average as At Market, not Outperforming", async () => {
    const report = await parse();
    const instant = report.equipment.find(
      (row) => row.storeName === "Brookmere Park" && row.level === "INSTANT",
    )!;
    // 300 per bed against a chain average of 300 -> exactly 0%.
    expect(instant.vChainPercent).toBeCloseTo(0, 10);
    expect(classifyVersusChain(instant.vChainPercent)).toBe("at_market");
  });
});

describe("the chain benchmark comes from All Salons, never from Filtered Data", () => {
  it("reads the unfiltered block", async () => {
    // `Filtered Data` is SUBTOTAL over VISIBLE rows, so its value depends on
    // the autofilter state the sender happened to leave in the file. The
    // fixture writes 999 there so reading it is unmistakable.
    const report = await parse();
    expect(report.chainBenchmarks).toHaveLength(BED_FIXTURE_CHAIN.length);
    for (const benchmark of report.chainBenchmarks) {
      const expected = BED_FIXTURE_CHAIN.find(
        (entry) => entry.level.toUpperCase() === benchmark.level,
      )!;
      expect(benchmark.tansPerBed).toBe(expected.tansPerBed);
      expect(benchmark.totalBeds).toBe(expected.totalBeds);
    }
  });

  it("carries no salon, company or store name into the benchmark", async () => {
    const report = await parse();
    const serialised = JSON.stringify(report.chainBenchmarks);
    for (const row of BED_FIXTURE_ROWS) {
      expect(serialised).not.toContain(row.salon);
      expect(serialised).not.toContain(row.company);
    }
  });

  it("warns rather than refusing when the benchmark block is absent", async () => {
    const report = await parse({ omitChainBlock: true });
    expect(report.chainBenchmarks).toHaveLength(0);
    expect(report.warnings.join(" ")).toContain("chain benchmark block");
    // The v Chain figures the source computed are still usable.
    expect(report.equipment.some((row) => row.vChainPercent !== null)).toBe(true);
  });
});

describe("the FAST rule", () => {
  it("still reports FAST's shortfall as a figure", async () => {
    const report = await parse();
    const fast = report.equipment.find((row) => row.level === "FAST")!;
    // 60 / 2 = 30 per bed against a chain average of 100 -> -70%.
    expect(fast.vChainPercent).toBeCloseTo(-70, 10);
    expect(classifyVersusChain(fast.vChainPercent)).toBe("significantly_underperforming");
  });

  it("does not let that shortfall become a reportable finding", async () => {
    // FAST removals are intentional. -70% is the expected consequence of a
    // decision already taken, not a performance failure to raise.
    const report = await parse();
    const fast = report.equipment.find((row) => row.level === "FAST")!;
    expect(isReportableFinding(fast.level, classifyVersusChain(fast.vChainPercent))).toBe(false);
  });

  it("does not suppress a FAST level that is doing well", async () => {
    // The rule exists so a deliberate removal is not read as failure, not so
    // good news is hidden.
    expect(isReportableFinding("FAST", "outperforming")).toBe(true);
    expect(isReportableFinding("FAST", "at_market")).toBe(true);
  });

  it("suppresses nothing for any other level", async () => {
    expect(isReportableFinding("SPA", "significantly_underperforming")).toBe(true);
    expect(isReportableFinding("FASTER", "below_market")).toBe(true);
  });
});

describe("parser identity", () => {
  it("records its key, version and family on every parse", async () => {
    const report = await parse();
    expect(report.parserKey).toBe(BED_USAGE_PARSER_KEY);
    expect(report.parserVersion).toBeGreaterThanOrEqual(1);
    expect(report.reportFamily).toBe("bed_usage");
    expect(report.sourceSheetNames).toEqual(["Summary", "Usage Detail"]);
  });

  it("still parses when the Usage Detail sheet is absent", async () => {
    const report = await parse({ omitDetailSheet: true });
    expect(report.sourceSheetNames).toEqual(["Summary"]);
    expect(report.salons).toHaveLength(3);
  });
});
