import ExcelJS from "exceljs";

import { FIXTURE_DIMENSION_HEADERS } from "./comp-sales-workbook";

/**
 * SYNTHETIC ROLLING COMP SALES WORKBOOKS.
 *
 * The real workbook is NEVER committed: it carries salon-level financials and
 * manager names. This reproduces the STRUCTURE the audit found in
 * `CompReport(MTD)` — a wide descriptor band, a summary block above the salon
 * data, the trailing-window measure block, and the SECOND copy of that block a
 * hundred columns further right — with entirely invented figures and invented
 * place names.
 *
 * The header TEXT is transcribed exactly, abbreviation inconsistencies and all
 * (`mos.` for 3, 6 and 9 months, `Months` for 12; the measure named in a value
 * header and omitted from its own change header). Those are the things the
 * resolver has to cope with, so a fixture that tidied them up would test a sheet
 * the source does not produce.
 */

export const ROLLING_FIXTURE_SHEET = "CompReport(MTD)";
export const ROLLING_FIXTURE_PERIOD_MARKER = "MTD 08/30/2026";

/** The rolling headers, in the order and wording the audited sheet uses. */
export const ROLLING_FIXTURE_HEADERS = [
  "Current Yr Last 3 mos. Revenue",
  "Prior Yr Last 3 mos. Revenue",
  "Last 3 Months % Change",
  "Current Yr Last 6 mos. Revenue",
  "Prior Yr Last 6 mos. Revenue",
  "Last 6 Months % Change",
  "Current Yr Last 9 mos. Revenue",
  "Prior Yr Last 9 mos. Revenue",
  "Last 9 Months % Change",
  "Current Yr Last 12 Months Revenue",
  "Prior Yr Last 12 Months Revenue",
  "Last 12 Months % Change",
  "Current Yr Last 3 mos. Total Tans",
  "Prior Yr Last 3 mos. Total Tans",
  "Last 3 mo. Total Tans % Change",
  "Current Yr Last 6 mos. Total Tans",
  "Prior Yr Last 6 mos. Total Tans",
  "Last 6 mo. Total Tans % Change",
  "Current Yr Last 9 mos. Total Tans",
  "Prior Yr Last 9 mos. Total Tans",
  "Last 9 mo. Total Tans % Change",
  "Current Yr Last 12 mos. Total Tans",
  "Prior Yr Last 12 mos. Total Tans",
  "Last 12 mo. Total Tans % Change",
] as const;

/**
 * THE YEAR-COMPARISON BLOCKS, which sit to the LEFT of the trailing windows on
 * the real sheet and carry the comparison the review asked for.
 *
 * Four complete triples, transcribed exactly — including that the source writes
 * the current side two different ways (`Est. <year> Total Revenue` for revenue,
 * `<year> <measure>` for the rest) and the change column two different ways
 * (naming the year for revenue, naming only the measure for the rest).
 *
 * Plus the trap: `2026 Revenue (if >24 mos. old)` LOOKS like a second current
 * side and is not — it is a different population — so the 2024 triple beside it
 * must not resolve.
 */
export const BASELINE_FIXTURE_HEADERS = [
  "Est. 2026 Total Revenue",
  "2025 Total Revenue",
  "TY vs. 2025 % Change",
  "2026 Revenue (if >24 mos. old)",
  "2024 Total Revenue",
  "TY vs. 2024 % Change",
  "2026 Unique Tanners",
  "2025 Unique Tanners",
  "Unique Tanners % Change",
  "2026 Total Tans",
  "2025 Total Tans",
  "Total Tans % Change",
  "2026 EFT Revenue",
  "2025 EFT Revenue",
  "EFT Revenue % Change",
] as const;

/**
 * ABANDONED TEMPLATE DEBRIS — A PERFECT STRUCTURAL COPY.
 *
 * This is why the resolver cannot key on structure alone: every shape below
 * matches a live block exactly. What separates them is the year on the current
 * side, which is the report's own year in the live block and a decade-old one
 * here. A resolver that matched structure would publish 2016, 2015 and 2011 as
 * real comparisons in the window picker.
 */
export const BASELINE_FIXTURE_DEBRIS_HEADERS = [
  "Est. 2016 Total Revenue",
  "2015 Total Revenue",
  "TY vs. LY % Change",
  "2016 Unique Tanners",
  "2015 Unique Tanners",
  "Unique Tanners % Change",
  "2016 Total Tans",
  "2015 Total Tans",
  "Total Tans % Change",
  "2016 EFT Revenue",
  "2015 EFT Revenue",
  "EFT Revenue % Change",
] as const;

export interface RollingFixtureSalon {
  salonNumber: string;
  storeName: string;
  district?: string | null;
  region?: string | null;
  company?: string | null;
  ownershipGroup?: string | null;
  dma?: string | null;
  compSalon?: boolean | null;
  quintileGroup?: string | null;
  revenueRank?: number | null;
  /** Overrides for individual rolling columns, by header. */
  overrides?: Partial<Record<string, number | string | null>>;
}

/** Three invented salons, one carrying a leading zero. */
export const DEFAULT_ROLLING_SALONS: RollingFixtureSalon[] = [
  {
    salonNumber: "0468",
    storeName: "Invented Store Alpha",
    district: "Invented District One",
    region: "Invented Region North",
    company: "Invented Holdings",
    ownershipGroup: "Invented Group A",
    dma: "Invented DMA 101",
    compSalon: true,
    quintileGroup: "Top 20%",
    revenueRank: 12,
  },
  {
    salonNumber: "1207",
    storeName: "Invented Store Beta",
    district: "Invented District One",
    region: "Invented Region North",
    company: "Invented Holdings",
    ownershipGroup: "Invented Group B",
    dma: "Invented DMA 202",
    compSalon: true,
    quintileGroup: "2nd 20%",
    revenueRank: 34,
  },
  {
    salonNumber: "0033",
    storeName: "Invented Store Gamma",
    district: "Invented District Two",
    region: "Invented Region North",
    company: "Invented Holdings",
    ownershipGroup: "Invented Group A",
    dma: "Invented DMA 303",
    compSalon: true,
    quintileGroup: "Bottom 20%",
    revenueRank: 91,
  },
];

/** Deterministic invented figure for a (salon, column) pair. */
export function rollingFixtureValue(salonIndex: number, columnIndex: number): number {
  const header = ROLLING_FIXTURE_HEADERS[columnIndex];
  if (header.includes("% Change")) {
    // A fraction, as the schema requires. Signed, so movers have both directions.
    return Number((((salonIndex + columnIndex) % 7) - 3) / 20);
  }
  const scale = header.includes("Revenue") ? 10_000 : 500;
  return scale * (columnIndex + 1) + salonIndex * 137;
}

/**
 * Deterministic invented figures for the year-comparison block.
 *
 * The change is the source's OWN value, and deliberately NOT exactly
 * `current / baseline - 1`: the real sheet rounds to four places, and a fixture
 * whose change is recomputable would let a parser that recomputed it pass.
 */
export function baselineFixtureValues(salonIndex: number): Record<string, number> {
  const revenue2026 = 40_000 + salonIndex * 1_137;
  const revenue2025 = 38_500 + salonIndex * 1_009;
  const revenue2024 = 33_250 + salonIndex * 877;
  const eft2026 = 17_000 + salonIndex * 611;
  const eft2025 = 14_250 + salonIndex * 533;
  const tans2026 = 700 + salonIndex * 37;
  const tans2025 = 690 + salonIndex * 41;
  const unique2026 = 357 + salonIndex * 19;
  const unique2025 = 329 + salonIndex * 23;

  return {
    "Est. 2026 Total Revenue": revenue2026,
    "2025 Total Revenue": revenue2025,
    // Rounded to four places, as the source rounds THIS one. A parser that
    // recomputed the change would produce the unrounded value and fail.
    "TY vs. 2025 % Change": Number((revenue2026 / revenue2025 - 1).toFixed(4)),
    "2026 Revenue (if >24 mos. old)": revenue2026,
    "2024 Total Revenue": revenue2024,
    "TY vs. 2024 % Change": Number((revenue2026 / revenue2024 - 1).toFixed(4)),
    "2026 Unique Tanners": unique2026,
    "2025 Unique Tanners": unique2025,
    // Full precision, as the source writes these three.
    "Unique Tanners % Change": unique2026 / unique2025 - 1,
    "2026 Total Tans": tans2026,
    "2025 Total Tans": tans2025,
    "Total Tans % Change": tans2026 / tans2025 - 1,
    "2026 EFT Revenue": eft2026,
    "2025 EFT Revenue": eft2025,
    "EFT Revenue % Change": eft2026 / eft2025 - 1,
  };
}

export interface RollingFixtureOptions {
  sheetName?: string;
  /** Row carrying the descriptor and rolling headers. */
  headerRow?: number;
  salons?: RollingFixtureSalon[];
  /** `null` omits the marker entirely. */
  periodMarker?: string | Date | null;
  /** Repeat the whole rolling block this far to the right of the live one. */
  repeatBlockGap?: number | null;
  /** Drop these rolling headers, to test a missing window. */
  omitHeaders?: string[];
  /** Add a second copy of one header INSIDE the live band. */
  duplicateInBand?: string | null;
  /** Rename one rolling header, to test drift. */
  renameHeader?: { header: string; to: string } | null;
  /** Empty template slots after the salon rows, as the real sheet has. */
  templatePlaceholderRows?: number;
  /** A summary block between the top of the sheet and the header row. */
  summaryRows?: boolean;
  /** Omit the year-comparison block entirely, leaving only trailing windows. */
  omitBaselineBlock?: boolean;
  /** Drop these year-comparison headers, to test an incomplete triple. */
  omitBaselineHeaders?: string[];
  /** Rename one year-comparison header, to test drift and misassociation. */
  renameBaselineHeader?: { header: string; to: string } | null;
  /** Write the abandoned 2016/2015/2011 template block. Defaults to true. */
  baselineDebris?: boolean;
}

/**
 * Builds a workbook shaped like `CompReport(MTD)`.
 *
 * The layout mirrors the audit: descriptor band first, a gap, the live rolling
 * block, a wide gap, then the repeated block. Positions are incidental — the
 * parser resolves by header text — but the GAPS are not: the clustering rule
 * that excludes the repeat depends on the distance between the two blocks.
 */
export async function buildRollingWorkbook(
  options: RollingFixtureOptions = {},
): Promise<Uint8Array> {
  const sheetName = options.sheetName ?? ROLLING_FIXTURE_SHEET;
  const headerRow = options.headerRow ?? 8;
  const salons = options.salons ?? DEFAULT_ROLLING_SALONS;
  const periodMarker =
    options.periodMarker === undefined ? ROLLING_FIXTURE_PERIOD_MARKER : options.periodMarker;
  const repeatGap = options.repeatBlockGap === undefined ? 40 : options.repeatBlockGap;
  const omit = new Set(options.omitHeaders ?? []);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.getCell("A1").value = "Invented Rolling Comparable Store Sales Extract";
  if (periodMarker !== null) {
    sheet.getCell("F1").value =
      periodMarker instanceof Date ? periodMarker : String(periodMarker);
  }

  // A summary block above the salon data, as the real sheet carries. Its rows
  // hold figures with no salon number, which is what makes them totals rows.
  if (options.summaryRows !== false && headerRow > 3) {
    sheet.getCell(`F${Math.min(3, headerRow - 1)}`).value = "Filtered Totals >>>";
    sheet.getCell(`F${Math.min(4, headerRow - 1)}`).value = "Filtered Averages >>>";
  }

  // Descriptor band, reusing the reviewed header vocabulary.
  const descriptors = [...FIXTURE_DIMENSION_HEADERS];
  descriptors.forEach((header, index) => {
    sheet.getRow(headerRow).getCell(index + 1).value = header;
  });

  /*
   * THE YEAR-COMPARISON BLOCK comes first, as it does on the real sheet: the
   * trailing windows follow it. Order matters to the resolver only in that the
   * change column must sit two right of its current side, which is the shape
   * both real blocks have.
   */
  const omitBaseline = new Set(options.omitBaselineHeaders ?? []);
  const baselineColumns = new Map<string, number>();
  let baselineCursor = descriptors.length + 3;
  if (options.omitBaselineBlock !== true) {
    for (const header of BASELINE_FIXTURE_HEADERS) {
      if (omitBaseline.has(header)) continue;
      const written =
        options.renameBaselineHeader && options.renameBaselineHeader.header === header
          ? options.renameBaselineHeader.to
          : header;
      sheet.getRow(headerRow).getCell(baselineCursor).value = written;
      baselineColumns.set(header, baselineCursor);
      baselineCursor += 1;
    }
  }

  // The live rolling block, two columns clear of the descriptor band.
  const liveStart = baselineCursor + 2;
  const liveColumns = new Map<string, number>();
  let cursor = liveStart;
  for (const header of ROLLING_FIXTURE_HEADERS) {
    if (omit.has(header)) continue;
    const written =
      options.renameHeader && options.renameHeader.header === header
        ? options.renameHeader.to
        : header;
    sheet.getRow(headerRow).getCell(cursor).value = written;
    liveColumns.set(header, cursor);
    cursor += 1;
  }

  // A duplicate INSIDE the live band, for the fail-closed path.
  if (options.duplicateInBand) {
    sheet.getRow(headerRow).getCell(cursor + 1).value = options.duplicateInBand;
    cursor += 2;
  }

  // The repeated block, far enough right that clustering treats it as separate.
  const repeatColumns = new Map<string, number>();
  if (repeatGap !== null) {
    let repeatCursor = cursor + repeatGap;
    for (const header of ROLLING_FIXTURE_HEADERS) {
      sheet.getRow(headerRow).getCell(repeatCursor).value = header;
      repeatColumns.set(header, repeatCursor);
      repeatCursor += 1;
    }
  }

  // The abandoned 2016/2015/2011 template block, far right with the repeat.
  const debrisColumns = new Map<string, number>();
  if (options.baselineDebris !== false) {
    let debrisCursor = cursor + (repeatGap ?? 0) + ROLLING_FIXTURE_HEADERS.length + 6;
    for (const header of BASELINE_FIXTURE_DEBRIS_HEADERS) {
      sheet.getRow(headerRow).getCell(debrisCursor).value = header;
      debrisColumns.set(header, debrisCursor);
      debrisCursor += 1;
    }
  }

  const descriptorFill = (salon: RollingFixtureSalon): Record<string, ExcelJS.CellValue> => ({
    "Salon Number": salon.salonNumber,
    "Store Name": salon.storeName,
    District: salon.district ?? null,
    Region: salon.region ?? null,
    Company: salon.company ?? null,
    "Ownership Group": salon.ownershipGroup ?? null,
    DMA: salon.dma ?? null,
    "Comp Salon": salon.compSalon ?? null,
    "Quintile Group": salon.quintileGroup ?? null,
    "Revenue Rank": salon.revenueRank ?? null,
  });

  salons.forEach((salon, salonIndex) => {
    const row = headerRow + 1 + salonIndex;
    const fill = descriptorFill(salon);
    descriptors.forEach((header, index) => {
      const value = fill[header];
      if (value !== undefined && value !== null) {
        sheet.getRow(row).getCell(index + 1).value = value;
      }
    });

    const baselineFill = baselineFixtureValues(salonIndex);
    for (const [header, column] of baselineColumns) {
      const value = Object.prototype.hasOwnProperty.call(salon.overrides ?? {}, header)
        ? (salon.overrides as Record<string, number | string | null>)[header]
        : baselineFill[header];
      if (value !== null && value !== undefined) sheet.getRow(row).getCell(column).value = value;
    }
    // The debris holds figures too, so a parser that read it would be detectable.
    for (const [, column] of debrisColumns) {
      sheet.getRow(row).getCell(column).value = -9_999;
    }

    ROLLING_FIXTURE_HEADERS.forEach((header, columnIndex) => {
      const value = Object.prototype.hasOwnProperty.call(salon.overrides ?? {}, header)
        ? (salon.overrides as Record<string, number | string | null>)[header]
        : rollingFixtureValue(salonIndex, columnIndex);

      const liveColumn = liveColumns.get(header);
      if (liveColumn !== undefined && value !== null) {
        sheet.getRow(row).getCell(liveColumn).value = value;
      }
      // The repeat holds DIFFERENT figures, so reading it would be detectable.
      const repeatColumn = repeatColumns.get(header);
      if (repeatColumn !== undefined) {
        sheet.getRow(row).getCell(repeatColumn).value = -1 * (columnIndex + 1);
      }
    });
  });

  // Unused template slots: no salon number, no store name, nothing at all.
  const placeholders = options.templatePlaceholderRows ?? 4;
  for (let index = 0; index < placeholders; index += 1) {
    const row = headerRow + 1 + salons.length + index;
    // Touch the row so it exists in the exported sheet, exactly as an unused
    // template slot appears.
    sheet.getRow(row).getCell(descriptors.length + 1).value = null;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
