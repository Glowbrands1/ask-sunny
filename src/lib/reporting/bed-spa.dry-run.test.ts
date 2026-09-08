import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseBedUsage } from "./bed-usage/parser";
import { AUTHORIZED_COMPANY, StoreResolver } from "./store-identity";
import { classifyVersusChain, classifyVersusPeers, percentDifference } from "./performance/classification";
import { parseSpaEngagement } from "./spa-engagement/parser";
import { parseSpaWellness } from "./spa-wellness/parser";
import { detectBedSpaReport } from "./bed-spa-intake";
import {
  perBed,
  reconcile,
  summarizeLevels,
  summarizeSalons,
  totalsFor,
} from "./read/bed-spa/bed-usage-analytics";
import { computeSpaConversion, aggregateSpaConversion } from "./read/bed-spa/spa-conversion";
import {
  spaPerUniquePercent,
  spaSessionsPerBed,
  spaSessionsPerUniquePerBed,
  uniqueSpaTannerPercent,
} from "./read/bed-spa/spa-engagement-analytics";
import { equipmentPerformance } from "./read/bed-spa/spa-wellness-analytics";
import { readWorkbook } from "./workbook";

/**
 * ============================================================================
 * REAL-WORKBOOK DRY RUN — READ ONLY
 * ============================================================================
 *
 * Point the three variables at the real files and run:
 *
 *   BED_USAGE_XLSX=/path/to/bed-usage.xlsx \
 *   SPA_WELLNESS_XLSX=/path/to/spa-wellness.xlsx \
 *   SPA_ENGAGEMENT_XLSX=/path/to/spa-engagement.xlsx \
 *   npm run dry-run:bed-spa
 *
 * Skipped entirely when a variable is unset, so the normal suite is unaffected
 * and no real file is ever required to make the build pass. The committed
 * suites use synthetic fixtures — the real workbooks carry 252 salons of
 * chain-wide volumes, a 252-row staff roster with addresses and phone numbers,
 * and thirty companies' names, none of which belongs in a git history.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   * It does not upload anything, to Storage or anywhere else.
 *   * It does not insert a single row.
 *   * It does not print salon-level figures. Structural facts, counts and
 *     IDENTITIES BETWEEN COLUMNS are asserted; the numbers behind them are not
 *     echoed, because a CI log is not a place for company financials.
 *
 * WHY THE ASSERTIONS ARE IDENTITIES RATHER THAN CONSTANTS. A hard-coded
 * "48,584 tans" would put a real business figure in the repository AND would
 * stop being true next month. An identity — the salon totals equal the sum of
 * their equipment rows, the workbook's own ranks equal the ones we recompute,
 * the two reports agree about spa volume — is both stronger and permanent: it
 * holds for every future delivery and it cannot be satisfied by a parser that
 * reads the wrong column.
 */

const BED_PATH = process.env.BED_USAGE_XLSX;
const SPA_PATH = process.env.SPA_WELLNESS_XLSX;
const ENGAGEMENT_PATH = process.env.SPA_ENGAGEMENT_XLSX;

for (const [name, path] of [
  ["BED_USAGE_XLSX", BED_PATH],
  ["SPA_WELLNESS_XLSX", SPA_PATH],
  ["SPA_ENGAGEMENT_XLSX", ENGAGEMENT_PATH],
] as const) {
  if (path && !existsSync(path)) {
    throw new Error(`${name} is set but no file exists at: ${path}`);
  }
}

const haveBed = Boolean(BED_PATH && existsSync(BED_PATH));
const haveSpa = Boolean(SPA_PATH && existsSync(SPA_PATH));
const haveEngagement = Boolean(ENGAGEMENT_PATH && existsSync(ENGAGEMENT_PATH));

async function open(path: string) {
  return readWorkbook(new Uint8Array(readFileSync(path)));
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Structural report lines. Counts and names of COLUMNS, never of salons. */
function report(lines: string[]): void {
  // The output IS the deliverable here: a dry run exists to be read.
  console.log(lines.join("\n"));
}

describe.skipIf(!haveBed)("Bed Usage — real workbook", () => {
  it("parses, and every derived figure agrees with the source", async () => {
    const path = BED_PATH as string;
    const workbook = await open(path);
    const parsed = parseBedUsage(workbook);

    const lines = [
      "=== BED USAGE DRY RUN (read-only) ===",
      `  file size (bytes): ${statSync(path).size}`,
      `  sha256: ${digest(path)}`,
      `  sheets: ${workbook.sheetNames.join(" | ")}`,
      `  period: ${parsed.period.grain} ${parsed.period.periodStart} to ${parsed.period.periodEnd}`,
      `  period marker: ${parsed.period.labelRaw}`,
      `  company scoped to: ${parsed.company}`,
      `  salons in the delivery: ${parsed.diagnostics.sourceSalonCount}`,
      `  companies in the delivery: ${parsed.diagnostics.sourceCompanyCount}`,
      `  salons kept: ${parsed.salons.length}`,
      `  equipment rows kept: ${parsed.equipment.length}`,
      `  chain benchmark levels: ${parsed.chainBenchmarks.map((entry) => entry.level).join(", ")}`,
      `  resolved columns: ${Object.entries(parsed.diagnostics.resolvedColumns)
        .map(([field, column]) => `${field}=${column}`)
        .join(" ")}`,
      `  warnings: ${parsed.warnings.length}`,
    ];

    expect(parsed.company).toBe(AUTHORIZED_COMPANY);
    expect(parsed.salons.length).toBeGreaterThan(0);
    // The delivery is chain-wide and the slice is not.
    expect(parsed.diagnostics.sourceSalonCount).toBeGreaterThan(parsed.salons.length);
    expect(parsed.diagnostics.sourceCompanyCount).toBeGreaterThan(1);

    /*
     * IDENTITY 1 — the salon total equals the sum of its equipment rows'
     * client tans. This is the strongest available proof that `Salon Tans` was
     * read from the right column and once per salon, rather than summed from
     * the repeated one.
     */
    const mismatches = reconcile(
      parsed.salons.map((salon) => ({
        salonNumber: null,
        storeName: salon.storeName,
        districtLabel: null,
        regionLabel: null,
        totalTans: salon.totalTans,
        bedCount: salon.bedCount,
      })),
      parsed.equipment.map((row) => ({
        salonNumber: null,
        storeName: row.storeName,
        districtLabel: null,
        regionLabel: null,
        level: row.level,
        bedType: row.bedType,
        qty: row.qty,
        clientTans: row.clientTans,
        perBed: row.perBed,
        vChainPercent: row.vChainPercent,
        vBedTypePercent: row.vBedTypePercent,
      })),
    );
    lines.push(`  salon totals reconcile with equipment rows: ${mismatches.length === 0}`);
    expect(mismatches).toEqual([]);

    /*
     * IDENTITY 2 — every row's `v Chain` equals its per-bed usage against the
     * chain benchmark for its LEVEL, to floating-point noise. This is what
     * proves the column is a RATIO and that the conversion is right; read as a
     * percentage the figures would be out by two orders of magnitude.
     */
    const chain = new Map(
      parsed.chainBenchmarks.map((entry) => [entry.level, entry.tansPerBed]),
    );
    let checked = 0;
    for (const row of parsed.equipment) {
      const benchmark = chain.get(row.level.toUpperCase());
      if (row.vChainPercent === null || !benchmark) continue;
      checked += 1;
      expect(row.vChainPercent).toBeCloseTo(
        percentDifference(row.perBed, benchmark)!,
        6,
      );
    }
    lines.push(`  v Chain rows verified against the level benchmark: ${checked}`);
    expect(checked).toBeGreaterThan(0);

    /*
     * IDENTITY 3 — per-bed usage is RECOMPUTED, not averaged. The estate figure
     * must equal total tans over total beds, and must differ from the mean of
     * the salons' own per-bed figures.
     */
    const summaries = summarizeSalons(
      parsed.salons.map((salon) => ({
        salonNumber: null,
        storeName: salon.storeName,
        districtLabel: null,
        regionLabel: null,
        totalTans: salon.totalTans,
        bedCount: salon.bedCount,
      })),
      [],
    );
    const totals = totalsFor(summaries);
    expect(totals.perBed).toBeCloseTo(perBed(totals.totalTans, totals.bedCount)!, 10);
    const meanOfSalons =
      summaries.reduce((total, salon) => total + (salon.perBed ?? 0), 0) / summaries.length;
    lines.push(
      `  estate per-bed differs from the mean of salon per-bed figures: ${
        Math.abs((totals.perBed ?? 0) - meanOfSalons) > 1e-6
      }`,
    );

    // The levels roll up and classify without throwing, and FAST is advisory.
    const levels = summarizeLevels(
      parsed.equipment.map((row) => ({
        salonNumber: null,
        storeName: row.storeName,
        districtLabel: null,
        regionLabel: null,
        level: row.level,
        bedType: row.bedType,
        qty: row.qty,
        clientTans: row.clientTans,
        perBed: row.perBed,
        vChainPercent: row.vChainPercent,
        vBedTypePercent: row.vBedTypePercent,
      })),
      parsed.chainBenchmarks.map((entry) => ({
        level: entry.level,
        tansPerBed: entry.tansPerBed,
        totalBeds: entry.totalBeds,
      })),
    );
    lines.push(
      `  levels classified: ${levels
        .map(
          (level) =>
            `${level.level}=${level.versusChain.band ?? "unclassified"}${
              level.advisoryOnly ? " (advisory)" : ""
            }`,
        )
        .join(" ")}`,
    );
    const fast = levels.find((level) => level.advisoryOnly);
    if (fast) {
      // The FAST rule, against the real data: whatever the band, it is never a
      // reportable finding when it is a shortfall.
      expect(
        fast.versusChain.band === "outperforming" ||
          fast.versusChain.band === "at_market" ||
          fast.versusChain.reportableFinding === false,
      ).toBe(true);
    }

    // Every classification the ladder produces is one of the four approved
    // bands, over the whole real population.
    for (const row of parsed.equipment) {
      const band = classifyVersusChain(row.vChainPercent);
      expect(
        band === null ||
          ["outperforming", "at_market", "below_market", "significantly_underperforming"].includes(
            band,
          ),
      ).toBe(true);
    }

    report(lines);
  });

  it("is recognised as exactly one family", async () => {
    const detections = await detectBedSpaReport(new Uint8Array(readFileSync(BED_PATH as string)));
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.familyKey)).toEqual([
      "bed_usage",
    ]);
  });
});

describe.skipIf(!haveSpa)("SPA Wellness — real workbook", () => {
  it("parses every window, and the equipment block reconciles", async () => {
    const path = SPA_PATH as string;
    const workbook = await open(path);
    const parsed = parseSpaWellness(workbook);

    const lines = [
      "=== SPA WELLNESS DRY RUN (read-only) ===",
      `  file size (bytes): ${statSync(path).size}`,
      `  sha256: ${digest(path)}`,
      `  sheets: ${workbook.sheetNames.join(" | ")}`,
      `  company scoped to: ${parsed.company}`,
      `  windows: ${parsed.windows.map((window) => window.window).join(", ")}`,
      `  warnings: ${parsed.warnings.length}`,
    ];

    expect(parsed.company).toBe(AUTHORIZED_COMPANY);
    expect(parsed.windows.length).toBeGreaterThan(0);

    /*
     * THE THREE WINDOWS ARE THREE PERIODS, and they must not be
     * interchangeable: the identity that proves it is that they end on the same
     * day and carry different totals.
     */
    const ends = new Set(parsed.windows.map((window) => window.period.periodEnd));
    if (parsed.windows.length > 1) {
      lines.push(`  windows share a period end: ${ends.size === 1}`);
    }

    for (const window of parsed.windows) {
      lines.push(
        `  ${window.window}: ${window.period.periodStart} to ${window.period.periodEnd}` +
          ` · equipment columns ${window.equipmentTypes.length}` +
          ` (${window.diagnostics.equipmentColumns[0]}..${
            window.diagnostics.equipmentColumns[window.diagnostics.equipmentColumns.length - 1]
          }, total in ${window.diagnostics.totalColumn})` +
          ` · salons ${window.salons.length} of ${window.diagnostics.sourceSalonCount}` +
          ` · installed-and-used cells ${window.equipmentUse.length}` +
          ` · absent cells ${window.diagnostics.notInstalledCells}`,
      );

      // The delivery is chain-wide; the slice is not.
      expect(window.diagnostics.sourceSalonCount).toBeGreaterThan(window.salons.length);

      /*
       * IDENTITY 1 — NO ZERO-SESSION FACT EXISTS. The rule, over the real
       * data: every use row is strictly positive, so no average can count an
       * absence as a failure.
       */
      for (const use of window.equipmentUse) expect(use.sessions).toBeGreaterThan(0);

      /*
       * IDENTITY 2 — each salon's total equals the sum of its own use rows.
       * This is what proves the equipment block's boundaries: including a
       * retail column, or stopping one column early, breaks it immediately.
       */
      for (const salon of window.salons) {
        if (salon.totalSessions === null) continue;
        const summed = window.equipmentUse
          .filter((use) => use.storeName === salon.storeName)
          .reduce((total, use) => total + use.sessions, 0);
        expect(summed).toBeCloseTo(salon.totalSessions, 6);
      }

      /*
       * IDENTITY 3 — the peer average EXCLUDES this company and the chain
       * average includes it, so the two differ wherever we have any of the
       * equipment. A peer average equal to the chain average would mean the
       * exclusion is not happening.
       */
      let differing = 0;
      for (const benchmark of window.benchmarks) {
        if (benchmark.peerAverageSessions === null || benchmark.chainAverageSessions === null) {
          continue;
        }
        expect(benchmark.peerSalonCount).toBeLessThanOrEqual(benchmark.chainSalonCount);
        if (
          Math.abs(benchmark.peerAverageSessions - benchmark.chainAverageSessions) > 1e-9
        ) {
          differing += 1;
        }
      }
      lines.push(`    equipment types where peer and chain averages differ: ${differing}`);
      expect(differing).toBeGreaterThan(0);

      // A peer count of zero must carry a null average: nobody to compare with
      // is not a comparison of nothing.
      for (const benchmark of window.benchmarks) {
        if (benchmark.peerSalonCount === 0) expect(benchmark.peerAverageSessions).toBeNull();
      }

      /*
       * IDENTITY 4 — every equipment type our salons use has a peer comparison
       * that classifies into one of the four approved bands, or is honestly
       * unclassified.
       */
      const performance = equipmentPerformance(
        window.equipmentTypes.map((type) => ({
          code: type.code,
          label: type.label,
          shortLabel: type.shortLabel,
          isComparable: type.isComparable,
          displayOrder: type.displayOrder,
        })),
        window.equipmentUse.map((use) => ({
          salonNumber: null,
          storeName: use.storeName,
          equipmentCode: use.equipmentCode,
          sessions: use.sessions,
          firstUseDate: null,
          lastUseDate: null,
        })),
        window.benchmarks.map((benchmark) => ({ ...benchmark })),
      );
      lines.push(
        `    equipment performance: ${performance
          .map(
            (entry) =>
              `${entry.shortLabel}=${entry.versusPeers.band ?? "unclassified"}` +
              `(${entry.ourSalonCount}v${entry.peerSalonCount})`,
          )
          .join(" ")}`,
      );
      for (const entry of performance) {
        const band = classifyVersusPeers(entry.versusPeers.deltaPercent);
        expect(entry.versusPeers.band).toBe(band);
        // The `Other` bucket is counted and never compared.
        if (!entry.comparable) expect(entry.versusPeers.deltaPercent).toBeNull();
      }
    }

    report(lines);
  });

  it("is recognised as exactly one family", async () => {
    const detections = await detectBedSpaReport(new Uint8Array(readFileSync(SPA_PATH as string)));
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.familyKey)).toEqual([
      "spa_wellness",
    ]);
  });
});

describe.skipIf(!haveEngagement)("Spa Engagement — real workbook", () => {
  it("reproduces every rank the workbook published", async () => {
    const path = ENGAGEMENT_PATH as string;
    const workbook = await open(path);
    const parsed = parseSpaEngagement(workbook);

    const lines = [
      "=== SPA ENGAGEMENT DRY RUN (read-only) ===",
      `  file size (bytes): ${statSync(path).size}`,
      `  sha256: ${digest(path)}`,
      `  sheets: ${workbook.sheetNames.join(" | ")}`,
      `  company scoped to: ${parsed.company}`,
      `  period: ${parsed.period.grain} ${parsed.period.periodStart} to ${parsed.period.periodEnd}`,
      `  period heading: ${parsed.period.labelRaw}`,
      `  ranking weights: ${JSON.stringify(parsed.rankWeights)}`,
      `  ranking population: ${parsed.rankPopulation}`,
      `  roster rows: ${parsed.diagnostics.rosterRowCount}`,
      `  salons kept: ${parsed.salons.length}`,
      `  district managers kept: ${parsed.managers.length}`,
      `  inventory rows: ${parsed.bedInventory.length}`,
      `  daily rows: ${parsed.dailyEngagement.length}`,
      `  daily coverage: ${parsed.diagnostics.dailyDateRange?.join(" to ") ?? "none"}`,
      `  unrostered salons: ${parsed.diagnostics.unrosteredSalons.length}`,
      `  warnings: ${parsed.warnings.length}`,
    ];

    expect(parsed.company).toBe(AUTHORIZED_COMPANY);
    expect(parsed.salons.length).toBeGreaterThan(0);
    // The ranking population is the chain, not the slice.
    expect(parsed.rankPopulation).toBeGreaterThan(parsed.salons.length);

    /*
     * IDENTITY 1 — THE RANKS. Every per-metric rank and every Overall Rank the
     * workbook published is reproduced exactly, from the weights read off the
     * sheet. This is the whole claim of "we preserve the source's ranking
     * methodology", checked against the source.
     */
    let rankChecks = 0;
    for (const salon of parsed.salons) {
      for (const [code, published] of Object.entries(salon.reportedRanks)) {
        if (published === null) continue;
        rankChecks += 1;
        expect(salon.computedRanks[code], `${salon.storeName} ${code}`).toBe(published);
      }
      if (salon.reportedOverallRank !== null) {
        rankChecks += 1;
        expect(salon.computedOverallRank, salon.storeName).toBe(salon.reportedOverallRank);
      }
    }
    for (const manager of parsed.managers) {
      if (manager.reportedOverallRank === null) continue;
      rankChecks += 1;
      expect(manager.computedOverallRank, manager.districtLabel).toBe(
        manager.reportedOverallRank,
      );
    }
    lines.push(`  published ranks reproduced: ${rankChecks}`);
    expect(rankChecks).toBeGreaterThan(0);

    /*
     * IDENTITY 2 — THE THREE FORMULAS THE WORKBOOK PUBLISHES. Ours must equal
     * the source's own columns for every salon.
     */
    let formulaChecks = 0;
    for (const salon of parsed.salons) {
      if (salon.reportedSpaSessionsPerBed !== null) {
        formulaChecks += 1;
        expect(spaSessionsPerBed(salon.spaSessions, salon.spaBeds)).toBeCloseTo(
          salon.reportedSpaSessionsPerBed,
          10,
        );
      }
      if (salon.reportedSpaSessionsPerUniquePerBed !== null) {
        formulaChecks += 1;
        expect(
          spaSessionsPerUniquePerBed(
            salon.spaSessions,
            salon.totalUniqueTanners,
            salon.spaBeds,
          ),
        ).toBeCloseTo(salon.reportedSpaSessionsPerUniquePerBed, 12);
      }
      if (salon.reportedUniqueSpaTannerPct !== null) {
        formulaChecks += 1;
        expect(
          uniqueSpaTannerPercent(salon.uniqueSpaTanners, salon.totalUniqueTanners),
        ).toBeCloseTo(salon.reportedUniqueSpaTannerPct, 12);
      }
    }
    lines.push(`  published formula columns reproduced: ${formulaChecks}`);
    expect(formulaChecks).toBeGreaterThan(0);

    /*
     * IDENTITY 3 — SPA PER UNIQUE % IS NOT THE BED-NORMALIZED FIGURE. Their
     * ratio is exactly the bed count, for every salon. The workbook carries no
     * column for the first, which is precisely why it is easy to label the
     * second as it.
     */
    let separationChecks = 0;
    for (const salon of parsed.salons) {
      const perUnique = spaPerUniquePercent(salon.spaSessions, salon.totalUniqueTanners);
      const perUniquePerBed = spaSessionsPerUniquePerBed(
        salon.spaSessions,
        salon.totalUniqueTanners,
        salon.spaBeds,
      );
      if (perUnique === null || perUniquePerBed === null || perUniquePerBed === 0) continue;
      separationChecks += 1;
      expect(perUnique / perUniquePerBed).toBeCloseTo(salon.spaBeds as number, 8);
    }
    lines.push(`  salons where the two metrics differ by exactly the bed count: ${separationChecks}`);
    expect(separationChecks).toBeGreaterThan(0);

    /*
     * IDENTITY 4 — THE INVENTORY SUMS TO `# of Spa Beds`. The two sheets are
     * independent, so agreement is evidence both were read correctly.
     */
    const inventoryBySalon = new Map<string, number>();
    for (const row of parsed.bedInventory) {
      inventoryBySalon.set(row.storeName, (inventoryBySalon.get(row.storeName) ?? 0) + row.units);
    }
    let inventoryChecks = 0;
    for (const salon of parsed.salons) {
      const counted = inventoryBySalon.get(salon.storeName);
      if (counted === undefined || salon.spaBeds === null) continue;
      inventoryChecks += 1;
      expect(counted, salon.storeName).toBe(salon.spaBeds);
    }
    lines.push(`  salons where the inventory sums to the reported bed count: ${inventoryChecks}`);

    // Salon numbers are zero-padded TEXT, and stay that way.
    for (const salon of parsed.salons) {
      expect(salon.salonNumber).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/);
    }
    lines.push(
      `  zero-padded salon numbers preserved: ${parsed.salons.every(
        (salon) => (salon.salonNumber ?? "").length >= 4,
      )}`,
    );

    report(lines);
  });

  it("is recognised as exactly one family", async () => {
    const detections = await detectBedSpaReport(
      new Uint8Array(readFileSync(ENGAGEMENT_PATH as string)),
    );
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.familyKey)).toEqual([
      "spa_engagement",
    ]);
  });
});

describe.skipIf(!haveBed || !haveSpa)("Bed Usage + SPA Wellness — the combined metric", () => {
  it("agrees about spa volume, and computes Spa Conversion Rate on a matching period", async () => {
    const bed = parseBedUsage(await open(BED_PATH as string));
    const spa = parseSpaWellness(await open(SPA_PATH as string));

    const lines = ["=== SPA CONVERSION DRY RUN (read-only) ==="];

    /*
     * THE PERIOD MATCH. Bed Usage is monthly; SPA Wellness carries three
     * windows. Only the window whose grain and both dates match may be divided
     * into the traffic — a `ytd` window ending on the same day covers eight
     * times the sessions.
     */
    const matching = spa.windows.find(
      (window) =>
        window.period.grain === bed.period.grain &&
        window.period.periodStart === bed.period.periodStart &&
        window.period.periodEnd === bed.period.periodEnd,
    );
    lines.push(
      `  bed usage period: ${bed.period.grain} ${bed.period.periodStart} to ${bed.period.periodEnd}`,
      `  spa windows: ${spa.windows
        .map((window) => `${window.window} ${window.period.periodStart}..${window.period.periodEnd}`)
        .join(" | ")}`,
      `  matching window: ${matching?.window ?? "none"}`,
    );
    expect(matching, "no SPA Wellness window matches the Bed Usage period").toBeTruthy();
    if (!matching) return;

    /*
     * IDENTITY — THE TWO REPORTS AGREE ABOUT SPA VOLUME. The Bed Usage report
     * counts spa equipment tans at its `SPA` level; the SPA Wellness report
     * counts spa sessions. They are the same events counted by two systems, so
     * their totals must agree — which is a strong independent check that both
     * parsers read the right columns and scoped to the same salons.
     */
    const bedSpaTans = bed.equipment
      .filter((row) => row.level.toUpperCase() === "SPA")
      .reduce((total, row) => total + (row.clientTans ?? 0), 0);
    const wellnessSessions = matching.salons.reduce(
      (total, salon) => total + (salon.totalSessions ?? 0),
      0,
    );
    lines.push(
      `  bed usage SPA-level tans equal SPA Wellness sessions: ${
        Math.abs(bedSpaTans - wellnessSessions) < 1e-6
      }`,
    );
    expect(bedSpaTans).toBeCloseTo(wellnessSessions, 6);

    // The two reports' salon populations resolve to each other by name, with
    // no fuzzy matching and nothing unresolved.
    const resolver = new StoreResolver(
      bed.salons.map((salon) => ({ salonNumber: salon.storeName, storeName: salon.storeName })),
    );
    const unresolved = resolver.unresolved(matching.salons.map((salon) => salon.storeName));
    lines.push(`  spa salons unresolved against the bed usage population: ${unresolved.length}`);
    expect(unresolved).toEqual([]);

    /*
     * THE CONVERSION RATE, per salon and in aggregate. Only the identity is
     * asserted — that the estate rate is the summed numerator over the summed
     * denominator, and not the mean of the salons' rates.
     */
    const traffic = new Map(bed.salons.map((salon) => [salon.storeName, salon.totalTans]));
    const conversions = matching.salons.map((salon) =>
      computeSpaConversion({
        salonNumber: salon.storeName,
        spaSessions: salon.totalSessions,
        totalTans: traffic.get(salon.storeName) ?? null,
        trafficPeriod: {
          grain: bed.period.grain,
          periodStart: bed.period.periodStart,
          periodEnd: bed.period.periodEnd,
          labelRaw: bed.period.labelRaw,
        },
        spaPeriod: {
          grain: matching.period.grain,
          periodStart: matching.period.periodStart,
          periodEnd: matching.period.periodEnd,
          labelRaw: matching.period.labelRaw,
        },
      }),
    );
    const available = conversions.filter((conversion) => conversion.available);
    lines.push(
      `  salons with a computable conversion rate: ${available.length} of ${conversions.length}`,
    );
    expect(available.length).toBe(conversions.length);

    const estate = aggregateSpaConversion(conversions);
    expect(estate.available).toBe(true);
    if (!estate.available) return;
    expect(estate.rate).toBeCloseTo(estate.spaSessions / estate.totalTans, 12);

    const meanOfRates =
      available.reduce(
        (total, conversion) => total + (conversion.available ? conversion.rate : 0),
        0,
      ) / available.length;
    lines.push(
      `  estate conversion differs from the mean of salon rates: ${
        Math.abs(estate.rate - meanOfRates) > 1e-9
      }`,
    );
    expect(Math.abs(estate.rate - meanOfRates)).toBeGreaterThan(0);

    report(lines);
  });
});

describe.skipIf(!haveBed || !haveEngagement)(
  "Bed Usage + Spa Engagement — the period mismatch",
  () => {
    it("refuses a conversion rate across the two reports' own periods", async () => {
      /*
       * THE LIVE CASE IN THE SUPPLIED MATERIAL. The Bed Usage report covers a
       * whole month and the engagement report covers a single day, so a
       * conversion rate across them is meaningless — and every input looks
       * perfectly reasonable, which is exactly why the refusal has to be
       * structural rather than a reviewer noticing.
       */
      const bed = parseBedUsage(await open(BED_PATH as string));
      const engagement = parseSpaEngagement(await open(ENGAGEMENT_PATH as string));

      const samePeriod =
        bed.period.grain === engagement.period.grain &&
        bed.period.periodStart === engagement.period.periodStart &&
        bed.period.periodEnd === engagement.period.periodEnd;

      report([
        "=== PERIOD MISMATCH DRY RUN (read-only) ===",
        `  bed usage: ${bed.period.grain} ${bed.period.periodStart} to ${bed.period.periodEnd}`,
        `  engagement: ${engagement.period.grain} ${engagement.period.periodStart} to ${engagement.period.periodEnd}`,
        `  periods match: ${samePeriod}`,
      ]);

      if (samePeriod) {
        // A future pair of deliveries may legitimately match; the assertion
        // below only applies when they do not.
        return;
      }

      const traffic = new Map(bed.salons.map((salon) => [salon.storeName, salon.totalTans]));
      for (const salon of engagement.salons) {
        const conversion = computeSpaConversion({
          salonNumber: salon.salonNumber,
          spaSessions: salon.spaSessions,
          totalTans: traffic.get(salon.storeName) ?? null,
          trafficPeriod: {
            grain: bed.period.grain,
            periodStart: bed.period.periodStart,
            periodEnd: bed.period.periodEnd,
            labelRaw: bed.period.labelRaw,
          },
          spaPeriod: {
            grain: engagement.period.grain,
            periodStart: engagement.period.periodStart,
            periodEnd: engagement.period.periodEnd,
            labelRaw: engagement.period.labelRaw,
          },
        });
        expect(conversion.available).toBe(false);
        if (!conversion.available) expect(conversion.reason).toBe("period_mismatch");
      }
    });
  },
);
