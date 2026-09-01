import ExcelJS from "exceljs";

import { FIXTURE_DIMENSION_HEADERS } from "./comp-sales-workbook";

/**
 * SYNTHETIC YEAR-TO-DATE COMP SALES WORKBOOKS.
 *
 * The real workbook is NEVER committed: it carries salon-level financials and
 * manager names. This reproduces the STRUCTURE the audit found in
 * `CompReport(YTD)` — with entirely invented figures and invented place names.
 *
 * THE AWKWARD PARTS ARE REPRODUCED, NOT TIDIED, because they are the whole
 * reason the parser needs testing:
 *
 *   the grain word inside a measure header (`YTD 2026 Total Revenue`);
 *   change headers that name their year (`TY vs. 2025 % Change`) beside ones
 *     that do not (`UV Tans % Change`);
 *   the contradictory `AJ`/`AK` pair — a second column headed `2025 Total
 *     Revenue` holding a DIFFERENT figure, followed by a change headed
 *     `TY vs. 2024 % Change` on a sheet with no 2024 figure anywhere;
 *   `2026 Revenue (if >24 mos. old)`, which repeats the total revenue column;
 *   the trailing-window block, which this sheet carries and this parser skips;
 *   a stale repeat block far to the right, headed for 2013/2014.
 *
 * A fixture that cleaned these up would test a sheet the source does not
 * produce.
 */

export const YTD_FIXTURE_SHEET = "CompReport(YTD)";
export const YTD_FIXTURE_PERIOD_MARKER = "YTD 07 2026";

/** A value no real measure could hold, written into the stale repeat block. */
export const REPEAT_BLOCK_SENTINEL = -999_000;

/** The measure headers this parser reads, in the sheet's own wording. */
export const YTD_LIVE_HEADERS = [
  "YTD 2026 Total Revenue",
  "YTD 2025 Total Revenue",
  "TY vs. 2025 % Change",
  "2026 UV Tans",
  "2025 UV Tans",
  "UV Tans % Change",
  "2026 Sunless Sessions",
  "2025 Sunless Sessions",
  "Sunless Sessions % Change",
  "2026 Spa Sessions",
  "2025 Spa Sessions",
  "Spa Sessions % Change",
  "2026 Unique Tanners",
  "2025 Unique Tanners",
  "Unique Tanners % Change",
  "2026 Total Tans",
  "2025 Total Tans",
  "Total Tans % Change",
  "2026 OTC Revenue",
  "2025 OTC Revenue",
  "OTC Revenue % Change",
  "2026 EFT Revenue",
  "2025 EFT Revenue",
  "EFT Revenue % Change",
] as const;

/** The measure code and basis year each live header resolves to. */
export const YTD_EXPECTED_RESOLUTION: Record<string, { code: string; basisYear: number }> = {
  "YTD 2026 Total Revenue": { code: "total_revenue", basisYear: 2026 },
  "YTD 2025 Total Revenue": { code: "total_revenue", basisYear: 2025 },
  "TY vs. 2025 % Change": { code: "total_revenue_pct_change", basisYear: 2025 },
  "2026 UV Tans": { code: "uv_tans", basisYear: 2026 },
  "2025 UV Tans": { code: "uv_tans", basisYear: 2025 },
  "UV Tans % Change": { code: "uv_tans_pct_change", basisYear: 2025 },
  "2026 Sunless Sessions": { code: "sunless_tans", basisYear: 2026 },
  "2025 Sunless Sessions": { code: "sunless_tans", basisYear: 2025 },
  "Sunless Sessions % Change": { code: "sunless_tans_pct_change", basisYear: 2025 },
  "2026 Spa Sessions": { code: "spa_sessions", basisYear: 2026 },
  "2025 Spa Sessions": { code: "spa_sessions", basisYear: 2025 },
  "Spa Sessions % Change": { code: "spa_sessions_pct_change", basisYear: 2025 },
  "2026 Unique Tanners": { code: "unique_tanners", basisYear: 2026 },
  "2025 Unique Tanners": { code: "unique_tanners", basisYear: 2025 },
  "Unique Tanners % Change": { code: "unique_tanners_pct_change", basisYear: 2025 },
  "2026 Total Tans": { code: "total_tans", basisYear: 2026 },
  "2025 Total Tans": { code: "total_tans", basisYear: 2025 },
  "Total Tans % Change": { code: "total_tans_pct_change", basisYear: 2025 },
  "2026 OTC Revenue": { code: "otc_revenue", basisYear: 2026 },
  "2025 OTC Revenue": { code: "otc_revenue", basisYear: 2025 },
  "OTC Revenue % Change": { code: "otc_revenue_pct_change", basisYear: 2025 },
  "2026 EFT Revenue": { code: "eft_revenue", basisYear: 2026 },
  "2025 EFT Revenue": { code: "eft_revenue", basisYear: 2025 },
  "EFT Revenue % Change": { code: "eft_revenue_pct_change", basisYear: 2025 },
};

/**
 * Columns the sheet carries that must NOT become facts.
 *
 * Written into the live band exactly where the audit found them, between the
 * total-revenue triple and the trailing block, so the parser has to exclude
 * them in situ rather than because they were conveniently left out.
 */
export const YTD_CONTRADICTORY_HEADERS = [
  "2026 Revenue (if >24 mos. old)",
  "2025 Total Revenue",
  "TY vs. 2024 % Change",
] as const;

/** The trailing-window block, carried by this sheet and read from the other. */
export const YTD_TRAILING_HEADERS = [
  "Current Yr Last 3 mos. Revenue",
  "Prior Yr Last 3 mos. Revenue",
  "Last 3 Months % Change",
  "Current Yr Last 12 Months Revenue",
  "Prior Yr Last 12 Months Revenue",
  "Last 12 Months % Change",
  "Current Yr Last 3 mos. Total Tans",
  "Prior Yr Last 3 mos. Total Tans",
  "Last 3 mo. Total Tans % Change",
] as const;

export interface YtdFixtureSalon {
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
  /** Overrides for individual measure columns, by header. */
  overrides?: Partial<Record<string, number | string | null>>;
}

export const DEFAULT_YTD_SALONS: YtdFixtureSalon[] = [
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
    district: "Invented District Two",
    region: "Invented Region North",
    company: "Invented Holdings",
    ownershipGroup: "Invented Group B",
    dma: "Invented DMA 202",
    compSalon: true,
    quintileGroup: "Second 20%",
    revenueRank: 47,
  },
  {
    salonNumber: "0033",
    storeName: "Invented Store Gamma",
    district: "Invented District One",
    region: "Invented Region South",
    company: "Invented Holdings",
    ownershipGroup: "Invented Group A",
    dma: "Invented DMA 303",
    compSalon: true,
    quintileGroup: "Bottom 20%",
    revenueRank: 91,
  },
];

/** Deterministic invented figure for a (salon, header) pair. */
export function ytdFixtureValue(salonIndex: number, header: string): number {
  if (header.includes("% Change")) {
    return Number((((salonIndex + header.length) % 7) - 3) / 20);
  }
  const scale = /revenue/i.test(header) ? 25_000 : 900;
  const year = /2025/.test(header) ? 0.92 : 1;
  return Math.round(scale * (1 + (header.length % 5) / 4) * year) + salonIndex * 311;
}

export interface YtdFixtureOptions {
  sheetName?: string;
  headerRow?: number;
  salons?: YtdFixtureSalon[];
  /** `null` omits the marker entirely. */
  periodMarker?: string | Date | null;
  /** Drop these live headers, to test a missing measure. */
  omitHeaders?: string[];
  /** Add a second copy of one live header INSIDE the live band. */
  duplicateInBand?: string | null;
  /** Include the contradictory AJ/AK columns. Default true, as the sheet has them. */
  includeContradictoryColumns?: boolean;
  /** Include the trailing-window block. Default true, as the sheet has it. */
  includeTrailingWindows?: boolean;
  /** Repeat the whole live block this far right, as the stale 2013/2014 copy. */
  repeatBlockGap?: number | null;
  /** Add a third basis year, to test the drift guard. */
  extraBasisYearHeaders?: string[];
  templatePlaceholderRows?: number;
  summaryRows?: boolean;
}

/**
 * Builds a workbook shaped like `CompReport(YTD)`.
 *
 * Column POSITIONS are incidental — the parser resolves by header text — but the
 * ORDER and the GAPS are not. The contradictory pair sits inside the live band
 * where the audit found it, and the stale repeat sits far enough right that the
 * clustering rule treats it as a separate block.
 */
export async function buildYtdWorkbook(options: YtdFixtureOptions = {}): Promise<Uint8Array> {
  const sheetName = options.sheetName ?? YTD_FIXTURE_SHEET;
  const headerRow = options.headerRow ?? 8;
  const salons = options.salons ?? DEFAULT_YTD_SALONS;
  const periodMarker =
    options.periodMarker === undefined ? YTD_FIXTURE_PERIOD_MARKER : options.periodMarker;
  const omit = new Set(options.omitHeaders ?? []);
  const repeatGap = options.repeatBlockGap === undefined ? 40 : options.repeatBlockGap;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.getCell("A1").value = "Invented Year-to-Date Comparable Store Sales Extract";
  if (periodMarker !== null) {
    sheet.getCell("F1").value =
      periodMarker instanceof Date ? periodMarker : String(periodMarker);
  }

  if (options.summaryRows !== false && headerRow > 3) {
    sheet.getCell(`F${Math.min(3, headerRow - 1)}`).value = "Filtered Totals >>>";
    sheet.getCell(`F${Math.min(4, headerRow - 1)}`).value = "Filtered Averages >>>";
  }

  const descriptors = [...FIXTURE_DIMENSION_HEADERS];
  descriptors.forEach((header, index) => {
    sheet.getRow(headerRow).getCell(index + 1).value = header;
  });

  /**
   * The live band, in the sheet's own order.
   *
   * The contradictory pair goes immediately after the total-revenue triple,
   * which is where it sits in the source and is what makes it dangerous: the
   * change column inherits the total-revenue block, so a parser that resolved
   * it by adjacency alone would publish a 2024 comparison.
   */
  const liveHeaders: string[] = [];
  for (const header of YTD_LIVE_HEADERS) {
    if (omit.has(header)) continue;
    liveHeaders.push(header);
    if (header === "TY vs. 2025 % Change" && options.includeContradictoryColumns !== false) {
      liveHeaders.push(...YTD_CONTRADICTORY_HEADERS);
    }
    if (header === "TY vs. 2025 % Change" && options.includeTrailingWindows !== false) {
      liveHeaders.push(...YTD_TRAILING_HEADERS);
    }
  }
  liveHeaders.push(...(options.extraBasisYearHeaders ?? []));
  // A duplicate INSIDE the band means adjacent, with no blank before it: a
  // blank column is what ends the live table, so a "duplicate" written after a
  // gap is a remnant and would be excluded rather than refused.
  if (options.duplicateInBand) liveHeaders.push(options.duplicateInBand);

  const liveStart = descriptors.length + 3;
  const liveColumns = new Map<string, number>();
  let cursor = liveStart;
  for (const header of liveHeaders) {
    sheet.getRow(headerRow).getCell(cursor).value = header;
    // A repeated header keeps the FIRST column, matching the resolver's rule.
    if (!liveColumns.has(header)) liveColumns.set(header, cursor);
    cursor += 1;
  }

  // The stale repeat, headed for years long past, as the real sheet carries.
  const repeatColumns = new Map<string, number>();
  if (repeatGap !== null) {
    let repeatCursor = cursor + repeatGap;
    sheet.getRow(headerRow).getCell(repeatCursor).value = "OTC Revenue MTD";
    repeatCursor += 1;
    sheet.getRow(headerRow).getCell(repeatCursor).value = "Est. 2014 Total Revenue";
    repeatCursor += 1;
    sheet.getRow(headerRow).getCell(repeatCursor).value = "2013 Total Revenue";
    repeatColumns.set("2013 Total Revenue", repeatCursor);
    repeatCursor += 1;
    sheet.getRow(headerRow).getCell(repeatCursor).value = "TY vs. 2013 % Change";
    repeatColumns.set("TY vs. 2013 % Change", repeatCursor);
  }

  const descriptorFill = (salon: YtdFixtureSalon): Record<string, ExcelJS.CellValue> => ({
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

    for (const [header, column] of liveColumns) {
      const value = Object.prototype.hasOwnProperty.call(salon.overrides ?? {}, header)
        ? (salon.overrides as Record<string, number | string | null>)[header]
        : ytdFixtureValue(salonIndex, header);
      if (value !== null) sheet.getRow(row).getCell(column).value = value;
    }

    // The stale repeat holds an unmistakable sentinel. A small negative would
    // not do: a `% change` fact is legitimately negative, so only a value no
    // real measure could take proves nothing from here was read.
    for (const [, column] of repeatColumns) {
      sheet.getRow(row).getCell(column).value = REPEAT_BLOCK_SENTINEL - salonIndex;
    }
  });

  const placeholders = options.templatePlaceholderRows ?? 4;
  for (let index = 0; index < placeholders; index += 1) {
    const row = headerRow + 1 + salons.length + index;
    sheet.getRow(row).getCell(descriptors.length + 1).value = null;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
