import { describe, expect, it } from "vitest";

import {
  buildCompSalesWorkbook,
  DEFAULT_FIXTURE_SALONS,
  FIXTURE_BASIS_YEAR,
  FIXTURE_CURRENT_YEAR,
} from "../__fixtures__/comp-sales-workbook";
import { parseReportWorkbook } from "../index";

/**
 * ============================================================================
 * A COMPARISON WINDOW WHOSE FIGURES BELONG TO A DIFFERENT YEAR
 * ============================================================================
 *
 * WHAT PRODUCTION HELD. For the September delivery the database carried 210
 * facts under basis year 2019 — fourteen measures across fifteen salons — and
 * every single one was bit-identical to the 2024 fact beside it:
 *
 *   select a.metric_code, count(*) filter (where abs(a.value-b.value) < 1e-9)
 *   ...  ->  14 measures, 15/15 salons identical, max abs diff 0.000000000
 *
 * Salon Performance offered a "2019 baseline" comparison built from those
 * facts. A manager who selected it was shown the 2024 comparison under a 2019
 * label, and nothing on the page said so.
 *
 * WHY BOTH EXISTING GUARDS MISSED IT.
 *
 *   `verifyDuplicateColumns` fires on two columns claiming the same measure AND
 *   the same year. These claim DIFFERENT years, so there is no collision to
 *   detect — the check is not weak here, it is aimed elsewhere.
 *
 *   `out_of_band_column` excludes a block separated from the live band by a
 *   wide run of unheaded columns. This block is CONTIGUOUS with it — AR to AU
 *   is a two-column gap — so the clustering correctly sees one band.
 *
 * WHERE IT COMES FROM is the workbook. Row 34 of `CompReport(MTD) vs 2024`
 * heads AU..BO `2024 OTC Revenue`, `2019 OTC Revenue`, `TY vs 2019 % Change`,
 * and every one of those columns holds the 2024 figure — verified on rows
 * 35..49 of the 09-08 and 09-10 deliveries, seven measures, fifteen salons.
 *
 * WHAT SETTLES IT is the agreement itself: two different years cannot produce
 * identical figures for a dozen measures on every salon in the delivery.
 */

const SALONS = DEFAULT_FIXTURE_SALONS.length;
const MIRRORED_YEAR = 2019;

async function parseWithMirror(year: number | null = MIRRORED_YEAR) {
  return parseReportWorkbook(
    await buildCompSalesWorkbook({ withMirroredBasisYear: year }),
  );
}

describe("a basis-year block that repeats another year's figures", () => {
  it("publishes no facts under the mirrored year", async () => {
    const report = await parseWithMirror();

    const mirrored = report.facts.filter((fact) => fact.basisYear === MIRRORED_YEAR);
    expect(mirrored).toEqual([]);
  });

  it("keeps every fact of the year it repeated", async () => {
    const clean = await parseReportWorkbook(await buildCompSalesWorkbook({}));
    const withMirror = await parseWithMirror();

    const baselineOf = (report: Awaited<ReturnType<typeof parseWithMirror>>) =>
      report.facts
        .filter((fact) => fact.basisYear === FIXTURE_BASIS_YEAR)
        .map((fact) => `${fact.salonNumber}|${fact.metricCode}|${fact.value}`)
        .sort();

    // Byte-for-byte the same delivery, minus the phantom. Dropping a mirror
    // must not cost the report a single real figure.
    expect(baselineOf(withMirror)).toEqual(baselineOf(clean));
    expect(baselineOf(withMirror).length).toBeGreaterThan(0);
  });

  it("says which block it dropped, which year it repeated, and how much agreed", async () => {
    const report = await parseWithMirror();

    const warning = report.warnings.find(
      (entry) => entry.code === "mirrored_basis_year",
    );
    expect(warning, "no mirrored_basis_year warning was raised").toBeDefined();
    expect(warning!.message).toContain(String(MIRRORED_YEAR));
    expect(warning!.message).toContain(String(FIXTURE_BASIS_YEAR));
    expect(warning!.message).toContain(`all ${SALONS} salons`);
    expect(warning!.message).toContain("EXCLUDED");
  });

  it("does NOT refuse the delivery", async () => {
    /*
     * `requiresReview` blocks ingestion outright. The block being repeated is
     * good data — refusing September's Comp Report over a template remnant
     * would cost the report every figure it got right, which is a worse
     * outcome than the defect.
     */
    const report = await parseWithMirror();
    expect(report.diagnostics.requiresReview).toBe(false);
    expect(report.facts.length).toBeGreaterThan(0);
    expect(report.salons).toHaveLength(SALONS);
  });

  it("leaves the current-year figures alone", async () => {
    const report = await parseWithMirror();
    const current = report.facts.filter(
      (fact) => fact.basisYear === FIXTURE_CURRENT_YEAR,
    );
    expect(current.length).toBeGreaterThan(0);
  });
});

describe("what it must NOT drop", () => {
  it("leaves a delivery with one baseline year untouched", async () => {
    const report = await parseReportWorkbook(await buildCompSalesWorkbook({}));

    expect(
      report.warnings.some((entry) => entry.code === "mirrored_basis_year"),
    ).toBe(false);
    expect(
      report.facts.some((fact) => fact.basisYear === FIXTURE_BASIS_YEAR),
    ).toBe(true);
  });

  it("keeps a second baseline year that holds DIFFERENT figures", async () => {
    /*
     * THE CASE THIS MUST NEVER BREAK. A workbook legitimately reporting two
     * baselines is the whole point of a year-comparison sheet, and a guard that
     * dropped the older one whenever two were present would delete real
     * history. `mirrorOffset` moves every figure, so the two agree nowhere.
     */
    const report = await parseReportWorkbook(
      await buildCompSalesWorkbook({
        withMirroredBasisYear: MIRRORED_YEAR,
        mirrorOffset: 7,
      }),
    );

    expect(
      report.warnings.some((entry) => entry.code === "mirrored_basis_year"),
    ).toBe(false);
    expect(
      report.facts.some((fact) => fact.basisYear === MIRRORED_YEAR),
    ).toBe(true);
  });

  it("needs agreement on EVERY salon, not most of them", async () => {
    /*
     * The rule is "identical on every salon", not "mostly identical". A real
     * second baseline will differ somewhere, and a rule that tolerated near
     * agreement would start deleting real data as soon as two years happened
     * to run close to each other.
     *
     * One salon row is moved here; the blocks agree on every other salon and
     * every measure, and the second baseline must survive.
     */
    const report = await parseReportWorkbook(
      await buildCompSalesWorkbook({
        withMirroredBasisYear: MIRRORED_YEAR,
        mirrorOffset: 3,
        mirrorOffsetSalonIndex: 1,
      }),
    );

    expect(
      report.warnings.some((entry) => entry.code === "mirrored_basis_year"),
    ).toBe(false);
    expect(
      report.facts.some((fact) => fact.basisYear === MIRRORED_YEAR),
    ).toBe(true);
  });
});
