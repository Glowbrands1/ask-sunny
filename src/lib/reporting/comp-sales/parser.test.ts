import { describe, expect, it } from "vitest";

import {
  buildCompSalesWorkbook,
  buildDecoyOnlyWorkbook,
  DEFAULT_FIXTURE_SALONS,
  FIXTURE_BASIS_YEAR,
  FIXTURE_CURRENT_YEAR,
  fixturePct,
  fixtureValue,
} from "../__fixtures__/comp-sales-workbook";
import { detectReport, parseReportWorkbook } from "../index";
import { readWorkbook } from "../workbook";
import { compSalesReportParser } from "./parser";

/**
 * Every fixture in this suite is generated in-process with invented data. The
 * real workbook is never committed and never read here.
 */

async function parseFixture(options: Parameters<typeof buildCompSalesWorkbook>[0] = {}) {
  return parseReportWorkbook(await buildCompSalesWorkbook(options));
}

async function detectFixture(options: Parameters<typeof buildCompSalesWorkbook>[0] = {}) {
  return detectReport(await readWorkbook(await buildCompSalesWorkbook(options)));
}

describe("sheet detection is structural, not by name", () => {
  it("accepts the audited structure", async () => {
    const detection = await detectFixture();
    expect(detection.supported).toBe(true);
    if (!detection.supported) return;
    expect(detection.sheetName).toBe("CompReport(MTD) vs 2024");
    // Named markers, not a count: the point is WHICH structure was confirmed.
    const markers = detection.markersMatched.join(" | ");
    expect(markers).toContain("header row located");
    expect(markers).toContain("salon number column");
    expect(markers).toContain("store name column");
    expect(markers).toContain("core metric headers");
    expect(markers).toContain("reporting period marker (F1)");
  });

  it("rejects a workbook whose sheet has the right NAME but unrelated contents", async () => {
    const detection = detectReport(await readWorkbook(await buildDecoyOnlyWorkbook()));
    expect(detection.supported).toBe(false);
    if (detection.supported) return;
    // Named like the report, so this is drift rather than "wrong file".
    expect(detection.kind).toBe("template_drift");
    expect(detection.markersMissing.length).toBeGreaterThan(0);
  });

  it("accepts the structure even when the sheet is named something else", async () => {
    // Structure is what matters; the name only orders the candidates.
    const detection = await detectFixture({ sheetName: "Sheet1" });
    expect(detection.supported).toBe(true);
  });

  it("reports template drift when a core metric header is missing", async () => {
    const detection = await detectFixture({ omitMetricLabel: "Total Revenue" });
    expect(detection.supported).toBe(false);
    if (detection.supported) return;
    expect(detection.kind).toBe("template_drift");
    expect(detection.markersMissing.join(" ")).toContain("total_revenue");
  });

  it("reports drift when the salon number column header is gone", async () => {
    const detection = await detectFixture({
      renameDimensionHeader: { header: "Salon Number", to: "Location Code" },
    });
    expect(detection.supported).toBe(false);
    if (detection.supported) return;
    expect(detection.kind).toBe("template_drift");
    // Without the salon key there is no header row at all, by design: the
    // header row is defined as the row carrying BOTH required descriptors.
    expect(detection.markersMissing.join(" ")).toContain("salon-number");
  });

  it("reports drift when the store name column header is gone", async () => {
    const detection = await detectFixture({
      renameDimensionHeader: { header: "Store Name", to: "Site Descriptor" },
    });
    expect(detection.supported).toBe(false);
  });
});

describe("period detection", () => {
  it("normalises the MTD marker deterministically", async () => {
    const report = await parseFixture();
    expect(report.period.grain).toBe("mtd");
    expect(report.period.periodEnd).toBe("2026-08-30");
    expect(report.period.periodStart).toBe("2026-08-01");
    expect(report.period.fiscalYear).toBe(2026);
    expect(report.period.labelRaw).toBe("MTD 08/30/2026");
  });

  it("fails ingestion when the period marker is absent — never falls back to today", async () => {
    await expect(parseFixture({ periodMarker: null })).rejects.toMatchObject({
      code: "period_unreadable",
    });
  });

  it("fails on an impossible date rather than rolling it forward", async () => {
    await expect(parseFixture({ periodMarker: "MTD 02/30/2026" })).rejects.toMatchObject({
      code: "period_unreadable",
    });
  });

  it("fails on a two-digit year rather than guessing the century", async () => {
    await expect(parseFixture({ periodMarker: "MTD 08/30/26" })).rejects.toMatchObject({
      code: "period_unreadable",
    });
  });

  it("refuses a marker whose grain contradicts the parser", async () => {
    await expect(parseFixture({ periodMarker: "YTD 08/30/2026" })).rejects.toMatchObject({
      code: "period_unreadable",
    });
  });

  it("accepts a real date cell as well as formatted text", async () => {
    const report = await parseFixture({ periodMarker: new Date(Date.UTC(2026, 7, 30)) });
    expect(report.period.periodEnd).toBe("2026-08-30");
  });
});

describe("salon and location normalization", () => {
  it("preserves a zero-padded salon number as text", async () => {
    const report = await parseFixture();
    const numbers = report.salons.map((salon) => salon.salonNumber);
    expect(numbers).toContain("0468");
    // The hazard: never coerced to 468.
    expect(numbers).not.toContain("468");
    expect(numbers).not.toContain(468 as unknown as string);
  });

  it("parses every salon row", async () => {
    const report = await parseFixture();
    expect(report.salons).toHaveLength(3);
    expect(report.salonPeriodAttributes).toHaveLength(3);
  });

  it("keeps district and region as period-scoped descriptive labels", async () => {
    const report = await parseFixture();
    const alpha = report.salonPeriodAttributes.find((a) => a.salonNumber === "0468");
    expect(alpha?.districtLabel).toBe("Fictional District One");
    expect(alpha?.regionLabel).toBe("Fictional Region North");
    // They live on the period-scoped record, never on the salon identity.
    expect(report.salons.find((s) => s.salonNumber === "0468")).not.toHaveProperty("districtLabel");
  });

  it("normalises the full descriptor set", async () => {
    const report = await parseFixture();
    const alpha = report.salonPeriodAttributes.find((a) => a.salonNumber === "0468");
    expect(alpha).toMatchObject({
      company: "Invented Holdings",
      ownershipGroup: "Group Alpha",
      dma: "Invented DMA 101",
      pricingPlan: "Plan A",
      isCompSalon: true,
      spaPieces: 3,
      spaInstallDate: "2021-05-17",
      quintileGroup: "Q1",
      revenueRank: 12,
      salonAgeYears: 7.5,
      avgClientAge: 31.25,
      marketConsolidation: "Low",
      nearestCompetitorDistance: 2.75,
    });
    const salonAlpha = report.salons.find((s) => s.salonNumber === "0468");
    expect(salonAlpha).toMatchObject({
      storeName: "Invented Store Alpha",
      ownerRef: "OWN-A",
      ownerUid: "UID-0001",
      openedAt: "2018-11-02",
    });
  });

  it("reads a text date and a boolean flag in their several spellings", async () => {
    const report = await parseFixture();
    const beta = report.salons.find((s) => s.salonNumber === "1207");
    expect(beta?.openedAt).toBe("2023-03-14");
    const betaAttrs = report.salonPeriodAttributes.find((a) => a.salonNumber === "1207");
    expect(betaAttrs?.isCompSalon).toBe(false);
    const gamma = report.salonPeriodAttributes.find((a) => a.salonNumber === "0031");
    expect(gamma?.isCompSalon).toBe(true);
  });

  it("leaves absent optional descriptors null rather than inventing them", async () => {
    const report = await parseFixture();
    const gamma = report.salonPeriodAttributes.find((a) => a.salonNumber === "0031");
    expect(gamma?.company).toBeNull();
    expect(gamma?.dma).toBeNull();
    expect(gamma?.spaPieces).toBeNull();
    const gammaSalon = report.salons.find((s) => s.salonNumber === "0031");
    expect(gammaSalon?.ownerRef).toBeNull();
    expect(gammaSalon?.openedAt).toBeNull();
  });
});

describe("metric mapping", () => {
  it("produces facts only for the 16 seeded codes", async () => {
    const report = await parseFixture();
    const codes = new Set(report.facts.map((fact) => fact.metricCode));
    expect(codes.size).toBeLessThanOrEqual(16);
    for (const code of codes) {
      expect(code).toMatch(/^(otc_revenue|eft_revenue|total_revenue|uv_tans|sunless_tans|spa_sessions|unique_tanners|total_tans)(_pct_change)?$/);
    }
  });

  it("carries the basis year from the header, not from the metric code", async () => {
    const report = await parseFixture();
    const otc = report.facts.filter((fact) => fact.metricCode === "otc_revenue");
    expect(new Set(otc.map((fact) => fact.basisYear))).toEqual(
      new Set([FIXTURE_CURRENT_YEAR, FIXTURE_BASIS_YEAR]),
    );
  });

  it("associates a bare '% change' header with the block it follows", async () => {
    const report = await parseFixture();
    const pct = report.facts.filter((fact) => fact.metricCode === "otc_revenue_pct_change");
    expect(pct.length).toBeGreaterThan(0);
    // The baseline year is the year compared AGAINST.
    for (const fact of pct) expect(fact.basisYear).toBe(FIXTURE_BASIS_YEAR);
  });

  it("stores percentages as fractions, including negatives and zero", async () => {
    const report = await parseFixture();
    const pct = report.facts.filter((fact) => fact.metricCode.endsWith("_pct_change"));
    expect(pct.some((fact) => fact.value < 0)).toBe(true);
    expect(pct.some((fact) => fact.value === 0)).toBe(true);
    // Every percentage is a fraction, so nothing may exceed |1| in this fixture.
    for (const fact of pct) expect(Math.abs(fact.value)).toBeLessThan(1);
    const alphaOtcPct = pct.find(
      (fact) => fact.salonNumber === "0468" && fact.metricCode === "otc_revenue_pct_change",
    );
    expect(alphaOtcPct?.value).toBe(fixturePct(0, 0));
  });

  it("keeps a genuine zero as a fact and an absent measure as no fact", async () => {
    const report = await parseFixture();
    const gammaSpa = report.facts.filter(
      (fact) => fact.salonNumber === "0031" && fact.metricCode === "spa_sessions",
    );
    expect(gammaSpa.length).toBeGreaterThan(0);
    for (const fact of gammaSpa) expect(fact.value).toBe(0);

    const gammaSunless = report.facts.filter(
      (fact) => fact.salonNumber === "0031" && fact.metricCode.startsWith("sunless_tans"),
    );
    expect(gammaSunless).toHaveLength(0);
  });

  it("resolves a shifted metric column by header, with corrected lineage", async () => {
    const baseline = await parseFixture();
    const shifted = await parseFixture({ shiftBeforeMetricIndex: 2 });

    const codesOf = (report: Awaited<ReturnType<typeof parseFixture>>) =>
      new Set(report.facts.map((fact) => fact.metricCode));
    // The same metrics resolve despite the inserted spacer column.
    expect(codesOf(shifted)).toEqual(codesOf(baseline));

    const columnFor = (report: Awaited<ReturnType<typeof parseFixture>>, code: string) =>
      report.diagnostics.resolvedMetricColumns.find((entry) => entry.metricCode === code)?.column;

    // OTC sits before the insertion point and does not move.
    expect(columnFor(shifted, "otc_revenue")).toBe(columnFor(baseline, "otc_revenue"));
    // Total Revenue sits after it and moves exactly one column right.
    expect(columnFor(shifted, "total_revenue")).not.toBe(columnFor(baseline, "total_revenue"));

    // The values still belong to the right metric after the shift.
    const alphaTotal = shifted.facts.find(
      (fact) =>
        fact.salonNumber === "0468" &&
        fact.metricCode === "total_revenue" &&
        fact.basisYear === FIXTURE_CURRENT_YEAR,
    );
    expect(alphaTotal?.value).toBe(fixtureValue(0, 2, "current"));
  });

  it("never silently reads the neighbour when a header is renamed", async () => {
    const report = await parseFixture({
      renameMetricHeader: { label: "UV Tans", header: "Ultraviolet Sessions Count" },
    });
    // The renamed column produced no fact for the current year...
    const uvCurrent = report.facts.filter(
      (fact) => fact.metricCode === "uv_tans" && fact.basisYear === FIXTURE_CURRENT_YEAR,
    );
    expect(uvCurrent).toHaveLength(0);
    // ...and said so.
    expect(report.warnings.some((warning) => warning.code === "unresolved_column")).toBe(true);
  });

  it("ignores the abandoned duplicate block and keeps the first block's figures", async () => {
    const report = await parseFixture({ withStaleDuplicateBlock: true });
    const alphaOtc = report.facts.filter(
      (fact) =>
        fact.salonNumber === "0468" &&
        fact.metricCode === "otc_revenue" &&
        fact.basisYear === FIXTURE_CURRENT_YEAR,
    );
    // Exactly one fact, and it is the live block's value, not the stale 999999.
    expect(alphaOtc).toHaveLength(1);
    expect(alphaOtc[0].value).toBe(fixtureValue(0, 0, "current"));
    expect(alphaOtc[0].value).not.toBe(999_999.99);
    expect(report.warnings.some((warning) => warning.code === "duplicate_metric_column")).toBe(true);
  });

  it("ignores unknown extra columns and reports them", async () => {
    const report = await parseFixture({ withUnknownColumns: true });
    const headers = report.diagnostics.unresolvedColumns.map((entry) => entry.header);
    expect(headers).toContain("Beds Per Salon Index");
    expect(headers).toContain("Operator Notes");
    expect(report.warnings.some((warning) => warning.code === "unresolved_column")).toBe(true);
    // Nothing from those columns became a fact.
    expect(report.facts.every((fact) => fact.metricCode !== "Beds Per Salon Index")).toBe(true);
  });

  it("reads a cached formula result as a number", async () => {
    const report = await parseFixture({
      salons: [
        { ...DEFAULT_FIXTURE_SALONS[0], cachedFormulaFor: "OTC Revenue" },
      ],
    });
    const fact = report.facts.find(
      (f) => f.metricCode === "otc_revenue" && f.basisYear === FIXTURE_CURRENT_YEAR,
    );
    expect(fact?.value).toBe(fixtureValue(0, 0, "current"));
  });
});

describe("row handling", () => {
  it("skips blank interior rows and trailing padding, distinguishing them", async () => {
    const report = await parseFixture({ withInteriorBlankRow: true, trailingPaddingRows: 4 });
    expect(report.salons).toHaveLength(3);
    const reasons = report.skippedRows.map((row) => row.reason);
    expect(reasons).toContain("blank_row");
    expect(reasons).toContain("trailing_padding");
  });

  it("skips a totals row instead of treating it as a salon", async () => {
    const report = await parseFixture({ withTotalsRow: true });
    expect(report.salons).toHaveLength(3);
    expect(report.skippedRows.map((row) => row.reason)).toContain("totals_row");
    expect(report.salons.every((salon) => salon.storeName !== "All Invented Stores")).toBe(true);
  });

  it("skips a duplicate salon row rather than doubling its figures", async () => {
    const report = await parseFixture({ duplicateSalonNumber: "0468" });
    expect(report.salons.filter((salon) => salon.salonNumber === "0468")).toHaveLength(1);
    expect(report.skippedRows.map((row) => row.reason)).toContain("duplicate_salon");
    expect(report.warnings.some((warning) => warning.code === "duplicate_salon_row")).toBe(true);
    // And the first occurrence is the one that survived.
    expect(report.salons.find((salon) => salon.salonNumber === "0468")?.storeName).toBe(
      "Invented Store Alpha",
    );
  });

  it("rejects a malformed salon number rather than reshaping it", async () => {
    const report = await parseFixture({ withMalformedSalonNumberRow: true });
    expect(report.skippedRows.map((row) => row.reason)).toContain("malformed_salon_number");
    expect(report.warnings.some((warning) => warning.code === "malformed_salon_number")).toBe(true);
    expect(report.salons.every((salon) => !salon.salonNumber.includes("!"))).toBe(true);
  });

  it("fails when the sheet is recognised but holds no salon rows", async () => {
    await expect(parseFixture({ salons: [] })).rejects.toMatchObject({
      code: "no_data_rows",
    });
  });
});

describe("parsed output shape and lineage", () => {
  it("reports parser identity and the sheets actually read", async () => {
    const report = await parseFixture();
    expect(report.parserKey).toBe("comp_sales_mtd_vs_2024");
    expect(report.parserVersion).toBe(1);
    expect(report.reportFamily).toBe("comp_sales");
    expect(report.sourceSheetNames).toEqual(["CompReport(MTD) vs 2024"]);
  });

  it("gives every fact cell-level lineage", async () => {
    const report = await parseFixture();
    expect(report.facts.length).toBeGreaterThan(0);
    for (const fact of report.facts) {
      expect(fact.sourceSheet).toBe("CompReport(MTD) vs 2024");
      // Matches the schema's own source_column format.
      expect(fact.sourceColumn).toMatch(/^[A-Z]{1,3}$/);
      expect(fact.sourceRow).toBeGreaterThan(report.diagnostics.headerRow);
    }
  });

  it("produces one fact per salon, metric and basis year", async () => {
    const report = await parseFixture();
    const keys = report.facts.map(
      (fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear ?? "none"}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts exactly the facts the fixture describes", async () => {
    const report = await parseFixture();
    // 8 measures x 3 columns = 24 per salon; Gamma omits Sunless Tans entirely.
    expect(report.facts).toHaveLength(24 + 24 + 21);
    expect(report.diagnostics.factsProduced).toBe(report.facts.length);
    expect(report.diagnostics.salonRowsParsed).toBe(3);
  });

  it("records separator columns without complaining about them", async () => {
    const report = await parseFixture({ shiftBeforeMetricIndex: 2 });
    expect(report.diagnostics.separatorColumns.length).toBeGreaterThan(0);
  });

  it("does not compute any company total", async () => {
    const report = await parseFixture({ withTotalsRow: true });
    // No aggregate row, and no synthesised aggregate salon.
    expect(report.salons.every((salon) => !/total|company|all/i.test(salon.storeName))).toBe(true);
  });
});

describe("parser registry", () => {
  it("exposes the comp sales parser and nothing that claims other families", async () => {
    expect(compSalesReportParser.key).toBe("comp_sales_mtd_vs_2024");
    expect(compSalesReportParser.family).toBe("comp_sales");
  });

  it("raises unsupported_workbook for bytes that are not a workbook", async () => {
    await expect(parseReportWorkbook(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "workbook_unreadable",
    });
  });
});
