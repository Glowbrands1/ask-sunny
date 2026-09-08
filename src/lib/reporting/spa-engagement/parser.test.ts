import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY,
  ENGAGEMENT_FIXTURE_OTHER_COMPANY,
  ENGAGEMENT_FIXTURE_SALONS,
  ENGAGEMENT_FIXTURE_WEIGHTS,
  expectedEngagementRanks,
  spaEngagementFixtureBytes,
} from "../__fixtures__/spa-engagement-workbook";
import { readWorkbook } from "../workbook";
import { rankAscending, rankDescending } from "./metric-map";
import {
  detectSpaEngagement,
  parseEngagementTitleRange,
  parseSpaEngagement,
  SPA_ENGAGEMENT_PARSER_KEY,
} from "./parser";

const SCOPE = { company: ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY };

async function parse(options: Parameters<typeof spaEngagementFixtureBytes>[0] = {}) {
  return parseSpaEngagement(await readWorkbook(await spaEngagementFixtureBytes(options)), SCOPE);
}

describe("report recognition", () => {
  it("recognises the report from its structure", async () => {
    const workbook = await readWorkbook(await spaEngagementFixtureBytes());
    expect(detectSpaEngagement(workbook)).toMatchObject({
      supported: true,
      sheetName: "All Summary",
    });
  });

  it("reports an unrelated workbook as unsupported", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Sheet1").getCell("A1").value = "Inventory count";
    const bytes = new Uint8Array((await other.xlsx.writeBuffer()) as ArrayBuffer);
    expect(detectSpaEngagement(await readWorkbook(bytes))).toMatchObject({
      supported: false,
      kind: "unsupported",
    });
  });

  it("treats a missing Roster as drift, because nothing could be scoped without it", async () => {
    const workbook = await readWorkbook(await spaEngagementFixtureBytes({ omitRosterSheet: true }));
    const detection = detectSpaEngagement(workbook);
    expect(detection).toMatchObject({ supported: false, kind: "template_drift" });
    if (detection.supported) throw new Error("unreachable");
    expect(detection.markersMissing.join(" ")).toContain("Roster");
  });

  it("treats a renamed measure header as drift", async () => {
    await expect(
      parse({ renameHeader: { from: "# of Spa Beds", to: "Spa Bed Count" } }),
    ).rejects.toMatchObject({ code: "template_drift" });
  });
});

describe("the period, whose year the title does not carry", () => {
  it("parses the month and day pair without inventing a year", () => {
    expect(parseEngagementTitleRange("Spa Sessions per Unique Tanner per Spa Bed: 9/1 - 9/1")).toEqual(
      {
        startMonth: 9,
        startDay: 1,
        endMonth: 9,
        endDay: 1,
        label: "Spa Sessions per Unique Tanner per Spa Bed: 9/1 - 9/1",
      },
    );
  });

  it("resolves the year from the daily sheet's real dates", async () => {
    const report = await parse();
    expect(report.period).toEqual({
      grain: "mtd",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-01",
      fiscalYear: 2026,
      labelRaw: "Spa Sessions per Unique Tanner per Spa Bed: 9/1 - 9/1",
    });
  });

  it("follows the daily sheet when the year changes", async () => {
    const report = await parse({ titleRange: "3/1 - 3/15", dailyEnd: "2027-03-15" });
    expect(report.period.periodStart).toBe("2027-03-01");
    expect(report.period.periodEnd).toBe("2027-03-15");
  });

  it("refuses when no sheet can supply the year", async () => {
    // "Assume this year" is how a September report gets filed under the wrong
    // one at the turn of a year.
    await expect(parse({ omitDailySheet: true })).rejects.toMatchObject({
      code: "period_unreadable",
    });
  });

  it("refuses when the daily sheet's coverage does not end on the title's date", async () => {
    await expect(parse({ titleRange: "9/1 - 9/1", dailyEnd: "2026-08-20" })).rejects.toMatchObject({
      code: "period_unreadable",
    });
  });

  it("steps the start year back for a window that crosses a year end", async () => {
    const report = await parse({ titleRange: "12/28 - 1/3", dailyEnd: "2027-01-03" });
    expect(report.period.periodStart).toBe("2026-12-28");
    expect(report.period.periodEnd).toBe("2027-01-03");
  });
});

describe("the roster is the only bridge to a canonical identity", () => {
  it("takes the company from the roster, not from the summary's Ownership column", async () => {
    const report = await parse();
    // `Ownership` holds `Corp` / `Fran` — a franchise flag. Scoping on it would
    // select every franchise in the chain.
    expect(report.salons.map((salon) => salon.ownership)).toEqual(["Fran", "Fran", "Fran"]);
    expect(new Set(report.salons.map((salon) => salon.company))).toEqual(
      new Set([ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY]),
    );
  });

  it("preserves a zero-padded salon number", async () => {
    const report = await parse();
    expect(report.salons.map((salon) => salon.salonNumber).sort()).toEqual([
      "0307",
      "0312",
      "0468",
    ]);
  });

  it("preserves the leading zero even when the roster stores it as a number", async () => {
    // `0468` read as a number is `468`, and the next report that reads it
    // correctly creates a second salon for the same store.
    const report = await parse({ numericSalonNumbers: true });
    expect(report.salons.map((salon) => salon.salonNumber).sort()).toEqual([
      "0307",
      "0312",
      "0468",
    ]);
  });

  it("surfaces a summary salon the roster does not name", async () => {
    const salons = ENGAGEMENT_FIXTURE_SALONS.map((salon) =>
      salon.salon === "Calder Vale" ? { ...salon, omitFromRoster: true } : salon,
    );
    const report = await parse({ salons });
    // Reported, not dropped in silence: an unmatched salon is a visible gap.
    expect(report.diagnostics.unrosteredSalons).toEqual(["Calder Vale"]);
    expect(report.salons.map((salon) => salon.storeName)).not.toContain("Calder Vale");
  });

  it("refuses when the roster names no salon of the authorized company", async () => {
    const bytes = await spaEngagementFixtureBytes();
    await expect(
      async () => parseSpaEngagement(await readWorkbook(bytes), { company: "Someone Else Ltd" }),
    ).rejects.toMatchObject({ code: "authorized_company_absent" });
  });
});

describe("company scoping", () => {
  it("keeps only the authorized company's salons", async () => {
    const report = await parse();
    expect(report.salons.map((salon) => salon.storeName).sort()).toEqual([
      "Aurora Springs",
      "Brookmere Park",
      "Calder Vale",
    ]);
  });

  it("names no other company's salon anywhere in the parsed report", async () => {
    const report = await parse();
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(ENGAGEMENT_FIXTURE_OTHER_COMPANY);
    expect(serialised).not.toContain("Dunmore Cross");
    expect(serialised).not.toContain("Eastmoor Row");
  });

  it("keeps the chain population count, which the rank depends on", async () => {
    const report = await parse();
    // "Rank 2 of 5" needs the 5. It is a count, and it names nobody.
    expect(report.rankPopulation).toBe(5);
    expect(report.diagnostics.sourceSalonCount).toBe(5);
  });

  it("filters the daily series and the inventory through the same roster", async () => {
    const report = await parse();
    expect(new Set(report.dailyEngagement.map((row) => row.storeName))).toEqual(
      new Set(["Aurora Springs", "Brookmere Park", "Calder Vale"]),
    );
    // `Corp` and `Fran` are pseudo-stores in the daily sheet, not salons.
    expect(report.dailyEngagement.map((row) => row.storeName)).not.toContain("Corp");
    expect(new Set(report.bedInventory.map((row) => row.storeName)).size).toBe(3);
  });
});

describe("the workbook's ranking, reproduced", () => {
  it("reads the weights off the sheet rather than assuming them", async () => {
    const report = await parse();
    expect(report.rankWeights).toEqual({
      rank_spa_sessions_per_bed: ENGAGEMENT_FIXTURE_WEIGHTS.perBed,
      rank_spa_sessions_per_unique_per_bed: ENGAGEMENT_FIXTURE_WEIGHTS.perUniquePerBed,
      rank_unique_spa_tanner_pct: ENGAGEMENT_FIXTURE_WEIGHTS.uniquePct,
    });
  });

  it("refuses rather than defaulting when the weights cannot be read", async () => {
    // A ranking computed on invented weights would look authoritative and
    // disagree with the report a manager is holding.
    await expect(parse({ omitWeights: true })).rejects.toMatchObject({ code: "template_drift" });
  });

  it("reproduces every published per-metric rank exactly", async () => {
    const report = await parse();
    for (const salon of report.salons) {
      for (const code of Object.keys(salon.reportedRanks)) {
        expect(salon.computedRanks[code], `${salon.storeName} ${code}`).toBe(
          salon.reportedRanks[code],
        );
      }
    }
  });

  it("reproduces every published Overall Rank exactly", async () => {
    const report = await parse();
    for (const salon of report.salons) {
      expect(salon.computedOverallRank, salon.storeName).toBe(salon.reportedOverallRank);
    }
  });

  it("shares a rank on a tie and skips the next, as RANK.EQ does", async () => {
    // Aurora Springs and Brookmere Park both run 8.0 sessions per bed. A
    // sort-position index would give them 2 and 3; RANK.EQ gives both 2 and
    // nothing gets 3. On the real file the two agree on only 107 of 248 rows.
    const report = await parse();
    const aurora = report.salons.find((salon) => salon.storeName === "Aurora Springs")!;
    const brookmere = report.salons.find((salon) => salon.storeName === "Brookmere Park")!;
    expect(aurora.reportedSpaSessionsPerBed).toBe(8);
    expect(brookmere.reportedSpaSessionsPerBed).toBe(8);
    expect(aurora.computedRanks.rank_spa_sessions_per_bed).toBe(2);
    expect(brookmere.computedRanks.rank_spa_sessions_per_bed).toBe(2);
    const perBedRanks = report.salons.map((salon) => salon.computedRanks.rank_spa_sessions_per_bed);
    expect(perBedRanks).not.toContain(3);
  });

  it("computes the weighted score as the sum of weight times rank", async () => {
    const report = await parse();
    const expected = expectedEngagementRanks(ENGAGEMENT_FIXTURE_SALONS);
    for (const salon of report.salons) {
      const match = expected.find((entry) => entry.salon.salon === salon.storeName)!;
      expect(salon.computedWeightedScore).toBeCloseTo(match.score, 10);
    }
  });

  it("ranks the chain, not the slice", async () => {
    // A rank recomputed over the three authorized salons alone would be 1-3.
    // The published figure is a position among all five.
    const report = await parse();
    const ranks = report.salons.map((salon) => salon.computedOverallRank);
    expect(Math.max(...(ranks as number[]))).toBeGreaterThan(3);
  });

  it("implements RANK.EQ, not a sort position", () => {
    expect(rankDescending([10, 8, 8, 5], 8)).toBe(2);
    expect(rankDescending([10, 8, 8, 5], 5)).toBe(4);
    expect(rankAscending([1, 2, 2, 4], 2)).toBe(2);
    expect(rankAscending([1, 2, 2, 4], 4)).toBe(4);
  });

  it("reproduces the district-manager ranking too", async () => {
    const report = await parse();
    expect(report.managers.length).toBeGreaterThan(0);
    for (const manager of report.managers) {
      expect(manager.computedOverallRank, manager.districtLabel).toBe(manager.reportedOverallRank);
    }
  });
});

describe("the four engagement figures, as the workbook states them", () => {
  it("matches the source's own per-bed and bed-normalized columns", async () => {
    const report = await parse();
    const aurora = report.salons.find((salon) => salon.storeName === "Aurora Springs")!;
    expect(aurora.spaSessions).toBe(32);
    expect(aurora.totalUniqueTanners).toBe(80);
    expect(aurora.uniqueSpaTanners).toBe(20);
    expect(aurora.spaBeds).toBe(4);
    // 32 / 4
    expect(aurora.reportedSpaSessionsPerBed).toBeCloseTo(8, 10);
    // 32 / 80 / 4
    expect(aurora.reportedSpaSessionsPerUniquePerBed).toBeCloseTo(0.1, 10);
    // 20 / 80
    expect(aurora.reportedUniqueSpaTannerPct).toBeCloseTo(0.25, 10);
  });

  it("keeps the chain scope rows, which are never a source for a salon figure", async () => {
    const report = await parse();
    expect(report.scopes.map((scope) => scope.label)).toEqual(["Corp", "Fran", "All"]);
  });

  it("records its parser identity and the sheets it read", async () => {
    const report = await parse();
    expect(report.parserKey).toBe(SPA_ENGAGEMENT_PARSER_KEY);
    expect(report.reportFamily).toBe("spa_engagement");
    expect(report.sourceSheetNames).toEqual(
      expect.arrayContaining(["Roster", "All Summary", "Unique by Day", "Equipment Counts"]),
    );
  });

  it("reports an absent optional sheet as a warning rather than failing", async () => {
    const report = await parse({ omitDmSheet: true, omitEquipmentSheet: true });
    expect(report.managers).toHaveLength(0);
    expect(report.bedInventory).toHaveLength(0);
    expect(report.warnings.join(" ")).toContain("All DM Ranking");
    expect(report.warnings.join(" ")).toContain("Equipment Counts");
  });
});
