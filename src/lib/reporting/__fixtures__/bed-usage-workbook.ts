import ExcelJS from "exceljs";

/**
 * SYNTHETIC BED USAGE WORKBOOKS.
 *
 * The real workbook is NEVER committed: it carries 252 salons of chain-wide
 * tanning volumes and thirty companies' names. This fixture reproduces the
 * STRUCTURE the real file has — an `Overview(ALL)` sheet, a `Summary` sheet
 * carrying a `Filtered Data` block, an `All Salons` benchmark block, a title
 * band, a TWO-ROW header and then the equipment rows, plus a `Usage Detail`
 * sheet repeating the period — with invented salons, invented companies and
 * invented figures.
 *
 * THE FIXTURE IS BUILT TO FAIL THE PLAUSIBLE WRONG IMPLEMENTATIONS, which is
 * what makes it worth more than a copy of the real layout:
 *
 *   * The `Filtered Data` block holds DELIBERATELY DIFFERENT numbers from the
 *     `All Salons` block, so a parser reading the wrong one produces wrong
 *     `v Chain` context and the test catches it. In the real file the two
 *     happen to agree, because the delivered copy has no filter applied — so
 *     the real file cannot prove which block was read and this one can.
 *   * `Salon Tans` and `Bed Count` repeat on every row of a salon, with `Ref`
 *     = 1 only on the first, so summing the column gives a number three times
 *     too large.
 *   * Client tans and total tans differ on exactly one row, so a parser that
 *     conflates them is visible.
 *   * Two companies are present, so the company gate has something to exclude.
 *   * One salon's FAST level runs far below chain, so the FAST rule has a case.
 */

export const BED_FIXTURE_AUTHORIZED_COMPANY = "Meridian Leisure Group";
export const BED_FIXTURE_OTHER_COMPANY = "Northlake Tanning Co";

/** The two header rows, as `[upper, lower]` pairs in column order. */
export const BED_FIXTURE_HEADERS: readonly [string, string][] = [
  ["", "Ref"],
  ["", "Salon Name"],
  ["", "Bed Type/Level"],
  ["", "Company"],
  ["", "Level"],
  ["", "Bed Type"],
  ["", "Qty"],
  ["Client", "Tans"],
  ["Tans", "per Bed"],
  ["Usage", "v Chain"],
  ["Total", "Tans"],
  ["Usage v", "Bed Type"],
  ["Salon", "Tans"],
  ["% of", "Tans"],
  ["Bed", "Count"],
  ["% of", "Beds"],
  ["Cnt/Use", "Ratio"],
  ["Avg # of tans", "by bed model"],
  ["Avg # of tans", "by bed level"],
];

/** One invented equipment row. */
export interface BedFixtureRow {
  readonly salon: string;
  readonly company: string;
  readonly level: string;
  readonly bedType: string;
  readonly qty: number;
  readonly clientTans: number;
  /** Defaults to `clientTans` — set it to add employee tans. */
  readonly totalTans?: number;
}

/**
 * THE CHAIN BENCHMARK, per level. Invented, and deliberately NOT equal to the
 * fixture's own averages: the real file's benchmark is chain-wide over 252
 * salons while the rows are one company's, so the two are unrelated there too.
 */
export const BED_FIXTURE_CHAIN: readonly { level: string; tansPerBed: number; totalBeds: number }[] =
  [
    { level: "Fast", tansPerBed: 100, totalBeds: 300 },
    { level: "Faster", tansPerBed: 200, totalBeds: 1000 },
    { level: "Fastest", tansPerBed: 250, totalBeds: 600 },
    { level: "Instant", tansPerBed: 300, totalBeds: 800 },
    { level: "Sunless", tansPerBed: 150, totalBeds: 600 },
    { level: "Spa", tansPerBed: 120, totalBeds: 1100 },
  ];

/**
 * THE DEFAULT ROWS.
 *
 * Three authorized salons and one other company's. The arithmetic is chosen so
 * every derived figure is exact in decimal, which keeps the assertions readable:
 *
 *   Aurora Springs   FASTER 2x220=440, INSTANT 2x330=660, SPA 1x60   -> 1160 tans, 5 beds
 *   Brookmere Park   FAST   2x30=60 (far below the 100 chain average),
 *                    FASTER 1x240, INSTANT 1x300                      ->  600 tans, 4 beds
 *   Calder Vale      SPA    2x150=300, SUNLESS 1x120                  ->  420 tans, 3 beds
 *   Dunmore Cross    FASTER 1x400 (the other company's)               ->  400 tans, 1 bed
 */
export const BED_FIXTURE_ROWS: readonly BedFixtureRow[] = [
  {
    salon: "Aurora Springs",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "FASTER",
    bedType: "Solstice 400",
    qty: 2,
    clientTans: 440,
  },
  {
    salon: "Aurora Springs",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "INSTANT",
    bedType: "Zenith 900",
    qty: 2,
    clientTans: 660,
    // The one row where employee tans exist, so client and total differ.
    totalTans: 684,
  },
  {
    salon: "Aurora Springs",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "SPA",
    bedType: "Calmwave Lounge",
    qty: 1,
    clientTans: 60,
  },
  {
    salon: "Brookmere Park",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "FAST",
    bedType: "Embers 120",
    qty: 2,
    clientTans: 60,
  },
  {
    salon: "Brookmere Park",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "FASTER",
    bedType: "Solstice 400",
    qty: 1,
    clientTans: 240,
  },
  {
    salon: "Brookmere Park",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "INSTANT",
    bedType: "Zenith 900",
    qty: 1,
    clientTans: 300,
  },
  {
    salon: "Calder Vale",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "SPA",
    bedType: "Calmwave Lounge",
    qty: 2,
    clientTans: 300,
  },
  {
    salon: "Calder Vale",
    company: BED_FIXTURE_AUTHORIZED_COMPANY,
    level: "SUNLESS",
    bedType: "Mistline Booth",
    qty: 1,
    clientTans: 120,
  },
  {
    salon: "Dunmore Cross",
    company: BED_FIXTURE_OTHER_COMPANY,
    level: "FASTER",
    bedType: "Solstice 400",
    qty: 1,
    clientTans: 400,
  },
];

export interface BedFixtureOptions {
  /** Defaults to the observed `8/1/2026 to 8/31/2026`. */
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly rows?: readonly BedFixtureRow[];
  /** Omit the `Usage Detail` sheet entirely. */
  readonly omitDetailSheet?: boolean;
  /** Give `Usage Detail` a DIFFERENT period, to exercise the agreement check. */
  readonly detailPeriod?: { start: string; end: string };
  /** Drop one column by its lower-row header, to exercise drift detection. */
  readonly dropColumn?: string;
  /** Rename one column's lower-row header, to exercise drift detection. */
  readonly renameColumn?: { from: string; to: string };
  /** Add a second, disagreeing period marker to the title band. */
  readonly secondPeriodMarker?: { start: string; end: string };
  /** Omit the `All Salons` benchmark block. */
  readonly omitChainBlock?: boolean;
  /** Append an extra column after the known ones, to prove tolerance. */
  readonly extraTrailingColumn?: string;
}

/** `2026-08-01` -> `8/1/2026`, which is how this source writes dates. */
function sourceDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function title(start: string, end: string): string {
  return `Bed Usage Report: ${sourceDate(start)} to ${sourceDate(end)}`;
}

/** Salon roll-ups, computed the way the source does: once per salon. */
function salonTotals(rows: readonly BedFixtureRow[]) {
  const totals = new Map<string, { tans: number; beds: number }>();
  for (const row of rows) {
    const existing = totals.get(row.salon) ?? { tans: 0, beds: 0 };
    totals.set(row.salon, {
      tans: existing.tans + row.clientTans,
      beds: existing.beds + row.qty,
    });
  }
  return totals;
}

export function buildBedUsageWorkbook(options: BedFixtureOptions = {}): ExcelJS.Workbook {
  const periodStart = options.periodStart ?? "2026-08-01";
  const periodEnd = options.periodEnd ?? "2026-08-31";
  const rows = options.rows ?? BED_FIXTURE_ROWS;
  const totals = salonTotals(rows);

  const workbook = new ExcelJS.Workbook();

  // The overview sheet, which carries only its own heading in the real file.
  workbook.addWorksheet("Overview(ALL)").getCell("A1").value =
    "Bed Usage Report: Document Overview";

  const summary = workbook.addWorksheet("Summary");

  const headers = BED_FIXTURE_HEADERS.filter(
    ([, lower]) => lower !== options.dropColumn,
  ).map(([upper, lower]) =>
    options.renameColumn && lower === options.renameColumn.from
      ? ([upper, options.renameColumn.to] as [string, string])
      : ([upper, lower] as [string, string]),
  );
  const columnOf = (lower: string) => headers.findIndex(([, name]) => name === lower) + 1;

  /*
   * THE `Filtered Data` BLOCK, rows 2-10, with DIFFERENT figures from the
   * benchmark block below it. A parser that reads this one instead of
   * `All Salons` gets a chain average of 999 for every level, which no
   * assertion in the suite can accept.
   */
  summary.getCell("G2").value = "Filtered Data";
  summary.getCell("H3").value = "Bed";
  summary.getCell("H4").value = "Level";
  summary.getCell("I3").value = "Avg Tans";
  summary.getCell("I4").value = "per bed";
  summary.getCell("K3").value = "% of ";
  summary.getCell("K4").value = "Total Tans";
  summary.getCell("L3").value = "Total # of Beds";
  summary.getCell("L4").value = "Total # of Beds";
  BED_FIXTURE_CHAIN.forEach((entry, index) => {
    const row = 5 + index;
    summary.getCell(`H${row}`).value = entry.level;
    summary.getCell(`I${row}`).value = 999;
    summary.getCell(`K${row}`).value = 0.5;
    summary.getCell(`L${row}`).value = 1;
  });

  /*
   * THE `All Salons` BENCHMARK BLOCK, rows 12-20. Its own two-row header sits
   * directly under the label, which is where the parser looks for it.
   */
  if (!options.omitChainBlock) {
    summary.getCell("G12").value = "All Salons";
    summary.getCell("H13").value = "Bed";
    summary.getCell("H14").value = "Level";
    summary.getCell("I13").value = "Avg Tans";
    summary.getCell("I14").value = "per bed";
    summary.getCell("K13").value = "% of ";
    summary.getCell("K14").value = "Total Tans";
    summary.getCell("L13").value = "Total # of Beds";
    summary.getCell("L14").value = "Total # of Beds";
    BED_FIXTURE_CHAIN.forEach((entry, index) => {
      const row = 15 + index;
      summary.getCell(`H${row}`).value = entry.level;
      summary.getCell(`I${row}`).value = entry.tansPerBed;
      summary.getCell(`K${row}`).value = Number((1 / BED_FIXTURE_CHAIN.length).toFixed(6));
      summary.getCell(`L${row}`).value = entry.totalBeds;
    });
  }

  // The title band. The real file writes the title into a merged range, which
  // reads back as the same text in several cells; reproduced so the parser's
  // de-duplication is exercised.
  const titleRow = 21;
  for (let column = 2; column <= 7; column += 1) {
    summary.getRow(titleRow).getCell(column).value = title(periodStart, periodEnd);
  }
  if (options.secondPeriodMarker) {
    summary.getRow(titleRow).getCell(9).value = title(
      options.secondPeriodMarker.start,
      options.secondPeriodMarker.end,
    );
  }

  // The TWO-ROW header. The upper row also carries the title in its left
  // columns, exactly as the real file does.
  const upperRow = 22;
  const lowerRow = 23;
  for (let column = 2; column <= 7; column += 1) {
    summary.getRow(upperRow).getCell(column).value = title(periodStart, periodEnd);
  }
  headers.forEach(([upper, lower], index) => {
    const column = index + 1;
    if (upper) summary.getRow(upperRow).getCell(column).value = upper;
    summary.getRow(lowerRow).getCell(column).value = lower;
  });
  if (options.extraTrailingColumn) {
    summary.getRow(lowerRow).getCell(headers.length + 1).value = options.extraTrailingColumn;
  }

  // The equipment rows.
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const sheetRow = lowerRow + 1 + index;
    const total = totals.get(row.salon)!;
    const chain = BED_FIXTURE_CHAIN.find(
      (entry) => entry.level.toUpperCase() === row.level.toUpperCase(),
    );
    const perBed = row.clientTans / row.qty;
    const set = (lower: string, value: string | number | null) => {
      const column = columnOf(lower);
      if (column > 0) summary.getRow(sheetRow).getCell(column).value = value;
    };

    set("Ref", seen.has(row.salon) ? 0 : 1);
    seen.add(row.salon);
    set("Salon Name", row.salon);
    set("Bed Type/Level", `${row.level} ${row.bedType}`);
    set("Company", row.company);
    set("Level", row.level);
    set("Bed Type", row.bedType);
    set("Qty", row.qty);
    set("Tans", row.clientTans);
    set("per Bed", perBed);
    // The RATIO, as the source writes it. Not a percentage.
    set("v Chain", chain ? perBed / chain.tansPerBed : null);
    // "Total Tans" is client PLUS employee tans.
    const totalTansColumn = headers.findIndex(
      ([upper, lower]) => upper === "Total" && lower === "Tans",
    );
    if (totalTansColumn >= 0) {
      summary.getRow(sheetRow).getCell(totalTansColumn + 1).value = row.totalTans ?? row.clientTans;
    }
    set("Bed Type", row.bedType);
    // "Salon Tans" and "Bed Count", REPEATED on every row of the salon.
    const salonTansColumn = headers.findIndex(
      ([upper, lower]) => upper === "Salon" && lower === "Tans",
    );
    if (salonTansColumn >= 0) {
      summary.getRow(sheetRow).getCell(salonTansColumn + 1).value = total.tans;
    }
    set("Count", total.beds);
    set("% of Tans", row.clientTans / total.tans);
    set("% of Beds", row.qty / total.beds);
  });

  if (!options.omitDetailSheet) {
    const detail = workbook.addWorksheet("Usage Detail");
    const detailStart = options.detailPeriod?.start ?? periodStart;
    const detailEnd = options.detailPeriod?.end ?? periodEnd;
    detail.getCell("A1").value =
      `Bed Usage Detail: ${sourceDate(detailStart)} to ${sourceDate(detailEnd)}`;
    ["Salon Name", "Description", "Bed Qty", "Tans", "Emp Tans", "Total Tans", "Tan Minutes"].forEach(
      (header, index) => {
        detail.getRow(2).getCell(index + 1).value = header;
      },
    );
    rows.forEach((row, index) => {
      const sheetRow = 3 + index;
      detail.getRow(sheetRow).getCell(1).value = row.salon;
      detail.getRow(sheetRow).getCell(2).value = `${row.level} ${row.bedType}`;
      detail.getRow(sheetRow).getCell(3).value = row.qty;
      detail.getRow(sheetRow).getCell(4).value = row.clientTans;
      detail.getRow(sheetRow).getCell(5).value = (row.totalTans ?? row.clientTans) - row.clientTans;
      detail.getRow(sheetRow).getCell(6).value = row.totalTans ?? row.clientTans;
      detail.getRow(sheetRow).getCell(7).value = row.clientTans * 12;
    });
  }

  return workbook;
}

/** The fixture as `.xlsx` bytes, for a test that goes through `readWorkbook`. */
export async function bedUsageFixtureBytes(
  options: BedFixtureOptions = {},
): Promise<Uint8Array> {
  const buffer = await buildBedUsageWorkbook(options).xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
