import ExcelJS from "exceljs";

/**
 * SYNTHETIC COMP SALES WORKBOOKS.
 *
 * The real workbook is NEVER committed: it carries salon-level financials and
 * manager names. These fixtures reproduce the STRUCTURE the audit found — a
 * 20-column descriptor band, measure blocks of
 * `[current year] [baseline year] [% change]`, a period marker as formatted text
 * in the header band, separator columns, an abandoned duplicate block — with
 * entirely invented figures and invented place names.
 *
 * Nothing here is a real salon, a real number, or any person's name.
 */

/** Exactly 20 headers, so the band is columns A-T as audited. */
export const FIXTURE_DIMENSION_HEADERS = [
  "Salon Number",
  "Store Name",
  "Ref: Owner",
  "Ref: UID",
  "District",
  "Region",
  "Company",
  "Ownership Group",
  "DMA",
  "Pricing Plan",
  "Comp Salon",
  "SPA Pieces",
  "SPA Install Date",
  "Quintile Group",
  "Revenue Rank",
  "Salon Age",
  "Avg Client Age",
  "Market Consolidation",
  "Nearest Competitor Distance",
  "Open Date",
] as const;

/** Base measures in the order the fixture lays their blocks out. */
export const FIXTURE_METRIC_LABELS = [
  "OTC Revenue",
  "EFT Revenue",
  "Total Revenue",
  "UV Tans",
  "Sunless Tans",
  "Spa Sessions",
  "Unique Tanners",
  "Total Tans",
] as const;

export type FixtureMetricLabel = (typeof FIXTURE_METRIC_LABELS)[number];

export const FIXTURE_CURRENT_YEAR = 2026;
export const FIXTURE_BASIS_YEAR = 2024;

export interface FixtureMetricValues {
  current?: number | null;
  basis?: number | null;
  pct?: number | null;
}

export interface FixtureSalonSpec {
  salonNumber: string;
  storeName: string;
  ownerRef?: string | null;
  ownerUid?: string | null;
  district?: string | null;
  region?: string | null;
  company?: string | null;
  ownershipGroup?: string | null;
  dma?: string | null;
  pricingPlan?: string | null;
  compSalon?: boolean | string | null;
  spaPieces?: number | null;
  spaInstallDate?: Date | string | null;
  quintile?: string | null;
  revenueRank?: number | null;
  salonAge?: number | null;
  avgClientAge?: number | null;
  marketConsolidation?: string | null;
  competitorDistance?: number | null;
  openDate?: Date | string | null;
  /** Per-measure overrides, keyed by the base measure's label. */
  values?: Partial<Record<FixtureMetricLabel, FixtureMetricValues>>;
  /** Write this measure's current-year cell as a cached formula. */
  cachedFormulaFor?: FixtureMetricLabel;
}

export interface FixtureOptions {
  sheetName?: string;
  /** Formatted-text period marker. `null` omits it entirely. */
  periodMarker?: string | Date | null;
  /** Row the headers sit on. Rows above are the header band. */
  headerRow?: number;
  salons?: FixtureSalonSpec[];
  /** Append a labelled totals line that must be skipped. */
  withTotalsRow?: boolean;
  /** Insert a fully blank row between the first and second salon. */
  withInteriorBlankRow?: boolean;
  /** Number of empty rows appended after the data. */
  trailingPaddingRows?: number;
  /** Append a second row reusing this salon number. */
  duplicateSalonNumber?: string | null;
  /** Append a row whose salon number cannot be a salon key. */
  withMalformedSalonNumberRow?: boolean;
  /**
   * Append a repeat of the OTC Revenue block with different figures — the
   * abandoned duplicate block. The parser must ignore it.
   */
  withStaleDuplicateBlock?: boolean;
  /** Append columns whose headers mean nothing to the parser. */
  withUnknownColumns?: boolean;
  /**
   * Insert an unnamed spacer column before this measure block index, shifting
   * every later measure column one to the right.
   */
  shiftBeforeMetricIndex?: number | null;
  /** Rewrite one measure's current-year header. */
  renameMetricHeader?: { label: FixtureMetricLabel; header: string } | null;
  /** Rewrite one descriptor header, e.g. to remove a required marker. */
  renameDimensionHeader?: { header: string; to: string } | null;
  /** Drop one measure's block entirely. */
  omitMetricLabel?: FixtureMetricLabel | null;
  /** Extra sheets to add alongside, to exercise sheet selection. */
  decoySheets?: { name: string; grid: (string | number | null)[][] }[];
}

/** Deterministic invented figures, so assertions can be exact. */
export function fixtureValue(
  salonIndex: number,
  metricIndex: number,
  which: "current" | "basis",
): number {
  const base = 10_000 + salonIndex * 1_000 + metricIndex * 10;
  return which === "current" ? base + 0.5 : base - 500 + 0.25;
}

/** A spread of fractions including a negative and an exact zero. */
export function fixturePct(salonIndex: number, metricIndex: number): number {
  const table = [-0.0299, 0, 0.0412, -0.15, 0.0025, 0, 0.3333, -0.0001];
  const value = table[(salonIndex + metricIndex) % table.length];
  return value;
}

export const DEFAULT_FIXTURE_SALONS: FixtureSalonSpec[] = [
  {
    // The zero-padded case. Must survive as text.
    salonNumber: "0468",
    storeName: "Invented Store Alpha",
    ownerRef: "OWN-A",
    ownerUid: "UID-0001",
    district: "Fictional District One",
    region: "Fictional Region North",
    company: "Invented Holdings",
    ownershipGroup: "Group Alpha",
    dma: "Invented DMA 101",
    pricingPlan: "Plan A",
    compSalon: "Y",
    spaPieces: 3,
    spaInstallDate: new Date(Date.UTC(2021, 4, 17)),
    quintile: "Q1",
    revenueRank: 12,
    salonAge: 7.5,
    avgClientAge: 31.25,
    marketConsolidation: "Low",
    competitorDistance: 2.75,
    openDate: new Date(Date.UTC(2018, 10, 2)),
  },
  {
    salonNumber: "1207",
    storeName: "Invented Store Beta",
    ownerRef: "OWN-B",
    ownerUid: "UID-0002",
    district: "Fictional District Two",
    region: "Fictional Region South",
    company: "Invented Holdings",
    ownershipGroup: "Group Beta",
    dma: "Invented DMA 202",
    pricingPlan: "Plan B",
    compSalon: "N",
    spaPieces: 0,
    quintile: "Q3",
    revenueRank: 44,
    salonAge: 2.125,
    avgClientAge: 28.5,
    marketConsolidation: "High",
    competitorDistance: 0.5,
    openDate: "03/14/2023",
  },
  {
    salonNumber: "0031",
    storeName: "Invented Store Gamma",
    district: "Fictional District One",
    region: "Fictional Region North",
    compSalon: true,
    quintile: "Q5",
    revenueRank: 91,
    // Deliberately sparse: optional descriptors absent must stay null.
    values: {
      // An absent measure must produce no fact, distinct from a zero.
      "Sunless Tans": { current: null, basis: null, pct: null },
      // A genuine zero must produce a fact whose value is 0.
      "Spa Sessions": { current: 0, basis: 0, pct: 0 },
    },
  },
];

interface ColumnPlan {
  header: string;
  /** How to fill this column for a salon row. */
  fill: (salon: FixtureSalonSpec, salonIndex: number) => ExcelJS.CellValue;
  /** Marks the abandoned duplicate block, for test assertions. */
  stale?: boolean;
}

function dimensionColumnPlans(): ColumnPlan[] {
  const value =
    (pick: (salon: FixtureSalonSpec) => unknown) =>
    (salon: FixtureSalonSpec): ExcelJS.CellValue => {
      const raw = pick(salon);
      if (raw === undefined || raw === null) return null;
      if (raw instanceof Date) return raw;
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "number") return raw;
      return String(raw);
    };

  return [
    // Written as a STRING so the zero padding survives the round trip.
    { header: "Salon Number", fill: value((s) => s.salonNumber) },
    { header: "Store Name", fill: value((s) => s.storeName) },
    { header: "Ref: Owner", fill: value((s) => s.ownerRef) },
    { header: "Ref: UID", fill: value((s) => s.ownerUid) },
    { header: "District", fill: value((s) => s.district) },
    { header: "Region", fill: value((s) => s.region) },
    { header: "Company", fill: value((s) => s.company) },
    { header: "Ownership Group", fill: value((s) => s.ownershipGroup) },
    { header: "DMA", fill: value((s) => s.dma) },
    { header: "Pricing Plan", fill: value((s) => s.pricingPlan) },
    { header: "Comp Salon", fill: value((s) => s.compSalon) },
    { header: "SPA Pieces", fill: value((s) => s.spaPieces) },
    { header: "SPA Install Date", fill: value((s) => s.spaInstallDate) },
    { header: "Quintile Group", fill: value((s) => s.quintile) },
    { header: "Revenue Rank", fill: value((s) => s.revenueRank) },
    { header: "Salon Age", fill: value((s) => s.salonAge) },
    { header: "Avg Client Age", fill: value((s) => s.avgClientAge) },
    { header: "Market Consolidation", fill: value((s) => s.marketConsolidation) },
    { header: "Nearest Competitor Distance", fill: value((s) => s.competitorDistance) },
    { header: "Open Date", fill: value((s) => s.openDate) },
  ];
}

function metricColumnPlans(options: FixtureOptions): ColumnPlan[] {
  const plans: ColumnPlan[] = [];
  const labels = FIXTURE_METRIC_LABELS.filter((label) => label !== options.omitMetricLabel);

  labels.forEach((label, blockIndex) => {
    const metricIndex = FIXTURE_METRIC_LABELS.indexOf(label);

    if (options.shiftBeforeMetricIndex === blockIndex) {
      // A blank-headered spacer: the separator columns the audit found, and the
      // thing that shifts every later measure one column right.
      plans.push({ header: "", fill: () => null });
    }

    const currentHeader =
      options.renameMetricHeader?.label === label
        ? options.renameMetricHeader.header
        : `${FIXTURE_CURRENT_YEAR} ${label}`;

    plans.push({
      header: currentHeader,
      fill: (salon, salonIndex) => {
        const override = salon.values?.[label]?.current;
        if (override === null) return null;
        const value = override ?? fixtureValue(salonIndex, metricIndex, "current");
        if (salon.cachedFormulaFor === label) {
          // A cached formula result, as other sheets in the workbook carry.
          return { formula: "ROUND(1,2)", result: value } as ExcelJS.CellValue;
        }
        return value;
      },
    });

    plans.push({
      header: `${FIXTURE_BASIS_YEAR} ${label}`,
      fill: (salon, salonIndex) => {
        const override = salon.values?.[label]?.basis;
        if (override === null) return null;
        return override ?? fixtureValue(salonIndex, metricIndex, "basis");
      },
    });

    plans.push({
      // The bare comparison header: it names no measure, so it can only be
      // resolved by association with the block it follows.
      header: `TY vs. ${FIXTURE_BASIS_YEAR} % Change`,
      fill: (salon, salonIndex) => {
        const override = salon.values?.[label]?.pct;
        if (override === null) return null;
        return override ?? fixturePct(salonIndex, metricIndex);
      },
    });
  });

  if (options.withStaleDuplicateBlock) {
    // The abandoned duplicate block: the same measure and the same years,
    // further right, holding different figures. Must be ignored entirely.
    plans.push({ header: "", fill: () => null });
    plans.push({
      header: `${FIXTURE_CURRENT_YEAR} OTC Revenue`,
      stale: true,
      fill: () => 999_999.99,
    });
    plans.push({
      header: `${FIXTURE_BASIS_YEAR} OTC Revenue`,
      stale: true,
      fill: () => 888_888.88,
    });
    plans.push({
      header: `TY vs. ${FIXTURE_BASIS_YEAR} % Change`,
      stale: true,
      fill: () => 0.7777,
    });
  }

  if (options.withUnknownColumns) {
    plans.push({ header: "Abandoned Template Column", fill: () => null });
    plans.push({ header: "Beds Per Salon Index", fill: () => 1.234 });
    plans.push({ header: "Operator Notes", fill: () => "invented note" });
  }

  return plans;
}

/** Builds a real `.xlsx` in memory. */
export async function buildCompSalesWorkbook(options: FixtureOptions = {}): Promise<Uint8Array> {
  const sheetName = options.sheetName ?? "CompReport(MTD) vs 2024";
  const headerRow = options.headerRow ?? 3;
  const salons = options.salons ?? DEFAULT_FIXTURE_SALONS;
  const periodMarker =
    options.periodMarker === undefined ? "MTD 08/30/2026" : options.periodMarker;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  // Header band: a title plus the period marker where the audit found it (F1).
  sheet.getCell("A1").value = "Invented Comparable Store Sales Extract";
  if (periodMarker !== null) {
    sheet.getCell("F1").value = periodMarker instanceof Date ? periodMarker : String(periodMarker);
  }

  const dimensionPlans = dimensionColumnPlans().map((plan) =>
    options.renameDimensionHeader && plan.header === options.renameDimensionHeader.header
      ? { ...plan, header: options.renameDimensionHeader.to }
      : plan,
  );
  const columns = [...dimensionPlans, ...metricColumnPlans(options)];

  columns.forEach((plan, index) => {
    if (plan.header.length > 0) {
      sheet.getRow(headerRow).getCell(index + 1).value = plan.header;
    }
  });

  let row = headerRow + 1;
  const writeSalon = (salon: FixtureSalonSpec, salonIndex: number) => {
    columns.forEach((plan, index) => {
      const value = plan.fill(salon, salonIndex);
      if (value !== null && value !== undefined) {
        sheet.getRow(row).getCell(index + 1).value = value;
      }
    });
    row += 1;
  };

  salons.forEach((salon, salonIndex) => {
    writeSalon(salon, salonIndex);
    if (salonIndex === 0 && options.withInteriorBlankRow) row += 1;
  });

  if (options.duplicateSalonNumber) {
    const original = salons.find((s) => s.salonNumber === options.duplicateSalonNumber);
    writeSalon(
      {
        ...(original ?? { salonNumber: options.duplicateSalonNumber, storeName: "Invented Store Repeat" }),
        storeName: "Invented Store Repeat",
      },
      salons.length,
    );
  }

  if (options.withMalformedSalonNumberRow) {
    // A salon key with characters the schema's text key refuses.
    writeSalon({ salonNumber: "!! not a salon !!", storeName: "Invented Store Bad Key" }, salons.length + 1);
  }

  if (options.withTotalsRow) {
    sheet.getRow(row).getCell(1).value = "Total";
    sheet.getRow(row).getCell(2).value = "All Invented Stores";
    columns.forEach((plan, index) => {
      if (index >= FIXTURE_DIMENSION_HEADERS.length && plan.header.length > 0) {
        sheet.getRow(row).getCell(index + 1).value = 123_456;
      }
    });
    row += 1;
  }

  for (let padding = 0; padding < (options.trailingPaddingRows ?? 0); padding += 1) {
    // Touch a cell then clear it, so the row exists but holds nothing — exactly
    // how trailing padding appears in an exported sheet.
    sheet.getRow(row).getCell(1).value = null;
    row += 1;
  }

  for (const decoy of options.decoySheets ?? []) {
    const extra = workbook.addWorksheet(decoy.name);
    decoy.grid.forEach((gridRow, rowIndex) => {
      gridRow.forEach((cell, columnIndex) => {
        if (cell !== null) extra.getRow(rowIndex + 1).getCell(columnIndex + 1).value = cell;
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Column letters the fixture's measure columns land on, for lineage assertions. */
export function fixtureMetricColumnLetters(options: FixtureOptions = {}): string[] {
  const plans = metricColumnPlans(options);
  const offset = FIXTURE_DIMENSION_HEADERS.length;
  return plans.map((_, index) => {
    let remaining = offset + index + 1;
    let letters = "";
    while (remaining > 0) {
      const rest = (remaining - 1) % 26;
      letters = String.fromCharCode(65 + rest) + letters;
      remaining = Math.floor((remaining - 1) / 26);
    }
    return letters;
  });
}

/**
 * A workbook whose ONLY sheet carries the approved name but unrelated contents.
 *
 * This is the fixture that proves detection is structural: if the parser
 * accepted this, it would be trusting a sheet name.
 */
export async function buildDecoyOnlyWorkbook(
  sheetName = "CompReport(MTD) vs 2024",
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell("A1").value = "Quarterly Widget Inventory";
  sheet.getCell("A3").value = "Widget";
  sheet.getCell("B3").value = "Bin";
  sheet.getCell("C3").value = "On Hand";
  sheet.getCell("A4").value = "Sprocket";
  sheet.getCell("B4").value = "B-12";
  sheet.getCell("C4").value = 42;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
