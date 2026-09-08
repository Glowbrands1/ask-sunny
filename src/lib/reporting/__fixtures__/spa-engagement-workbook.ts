import ExcelJS from "exceljs";

/**
 * SYNTHETIC SPA ENGAGEMENT WORKBOOKS.
 *
 * The real workbook is NEVER committed: it carries a 252-row staff roster with
 * salon addresses, phone numbers, e-mail addresses and manager names, plus 248
 * salons of customer counts. This fixture reproduces the structure — an
 * `All Summary` sheet with a year-less title, a weights row above three Rank
 * columns, a `Roster` supplying companies and zero-padded salon numbers, an
 * `Equipment Counts` inventory and a `Unique by Day` series — with invented
 * everything.
 *
 * BUILT TO FAIL THE PLAUSIBLE WRONG IMPLEMENTATIONS:
 *
 *   * THE TITLE CARRIES NO YEAR, exactly as the real one does not (`9/1 - 9/1`).
 *     The year has to come from `Unique by Day`, and removing that sheet must
 *     make the period unreadable rather than "this year".
 *   * TWO SALONS TIE on Spa Sessions per Bed, so `RANK.EQ` (which shares a rank
 *     and skips the next) is distinguishable from a sort position (which does
 *     not). On the real file the two agree on only 107 of 248 rows.
 *   * A SALON NUMBER IS ZERO-PADDED AND WOULD LOSE ITS ZERO if read as a
 *     number.
 *   * ROSTER `Corp` IS THE COMPANY AND `Corp/Fran` IS THE FRANCHISE FLAG, two
 *     similarly named columns, and the summary's own `Ownership` column holds
 *     the franchise flag rather than the company — so a parser that scopes on
 *     the summary alone cannot scope at all.
 *   * ONE SUMMARY SALON IS ABSENT FROM THE ROSTER, so unrostered salons have to
 *     be surfaced rather than silently dropped.
 */

export const ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY = "Meridian Leisure Group";
export const ENGAGEMENT_FIXTURE_OTHER_COMPANY = "Northlake Tanning Co";

/** The weights the fixture writes above the Rank columns. */
export const ENGAGEMENT_FIXTURE_WEIGHTS = {
  perBed: 0.25,
  perUniquePerBed: 0.25,
  uniquePct: 0.5,
} as const;

export interface EngagementFixtureSalon {
  readonly salon: string;
  readonly company: string;
  readonly salonNumber: string;
  readonly dm: string;
  readonly rm: string;
  readonly ownership: "Corp" | "Fran";
  readonly spaSessions: number;
  readonly totalUniqueTanners: number;
  readonly uniqueSpaTanners: number;
  readonly spaBeds: number;
  /** Omit from the roster, to exercise unresolved-salon reporting. */
  readonly omitFromRoster?: boolean;
}

/**
 * THE DEFAULT POPULATION.
 *
 * Aurora Springs and Brookmere Park both run 8 sessions per bed, which is the
 * tie `RANK.EQ` has to share.
 *
 *   Aurora Springs    32 sessions / 80 unique / 20 spa unique / 4 beds
 *                     per bed 8.0    per unique per bed 0.1      unique% 0.25
 *   Brookmere Park    16 sessions / 40 unique /  6 spa unique / 2 beds
 *                     per bed 8.0    per unique per bed 0.2      unique% 0.15
 *   Calder Vale        9 sessions / 60 unique /  6 spa unique / 3 beds
 *                     per bed 3.0    per unique per bed 0.05     unique% 0.10
 *   Dunmore Cross     24 sessions / 48 unique / 12 spa unique / 2 beds
 *                     per bed 12.0   per unique per bed 0.25     unique% 0.25
 *   Eastmoor Row       5 sessions / 50 unique /  2 spa unique / 5 beds
 *                     per bed 1.0    per unique per bed 0.02     unique% 0.04
 */
export const ENGAGEMENT_FIXTURE_SALONS: readonly EngagementFixtureSalon[] = [
  {
    salon: "Aurora Springs",
    company: ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY,
    // Zero-padded on purpose: read as a number this becomes 307.
    salonNumber: "0307",
    dm: "Hale, Rowan",
    rm: "Vance, Imogen",
    ownership: "Fran",
    spaSessions: 32,
    totalUniqueTanners: 80,
    uniqueSpaTanners: 20,
    spaBeds: 4,
  },
  {
    salon: "Brookmere Park",
    company: ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY,
    salonNumber: "0312",
    dm: "Hale, Rowan",
    rm: "Vance, Imogen",
    ownership: "Fran",
    spaSessions: 16,
    totalUniqueTanners: 40,
    uniqueSpaTanners: 6,
    spaBeds: 2,
  },
  {
    salon: "Calder Vale",
    company: ENGAGEMENT_FIXTURE_AUTHORIZED_COMPANY,
    salonNumber: "0468",
    dm: "Ogden, Priya",
    rm: "Vance, Imogen",
    ownership: "Fran",
    spaSessions: 9,
    totalUniqueTanners: 60,
    uniqueSpaTanners: 6,
    spaBeds: 3,
  },
  {
    salon: "Dunmore Cross",
    company: ENGAGEMENT_FIXTURE_OTHER_COMPANY,
    salonNumber: "0101",
    dm: "Sable, Marek",
    rm: "Quill, Teodor",
    ownership: "Corp",
    spaSessions: 24,
    totalUniqueTanners: 48,
    uniqueSpaTanners: 12,
    spaBeds: 2,
  },
  {
    salon: "Eastmoor Row",
    company: ENGAGEMENT_FIXTURE_OTHER_COMPANY,
    salonNumber: "0102",
    dm: "Sable, Marek",
    rm: "Quill, Teodor",
    ownership: "Corp",
    spaSessions: 5,
    totalUniqueTanners: 50,
    uniqueSpaTanners: 2,
    spaBeds: 5,
  },
];

export interface SpaEngagementFixtureOptions {
  readonly salons?: readonly EngagementFixtureSalon[];
  /** The title's month/day range. Defaults to `9/1 - 9/1`. */
  readonly titleRange?: string;
  /** The daily sheet's last date, which fixes the year. */
  readonly dailyEnd?: string;
  readonly dailyDays?: number;
  /** Omit `Unique by Day`, so no year can be resolved. */
  readonly omitDailySheet?: boolean;
  readonly omitRosterSheet?: boolean;
  readonly omitDmSheet?: boolean;
  readonly omitEquipmentSheet?: boolean;
  /** Blank the weights row, to exercise the refusal. */
  readonly omitWeights?: boolean;
  /** Write the salon number as a NUMBER, to exercise zero preservation. */
  readonly numericSalonNumbers?: boolean;
  /** Rename a measure header, to exercise drift detection. */
  readonly renameHeader?: { from: string; to: string };
}

const RANK_METRICS = ["perBed", "perUniquePerBed", "uniquePct"] as const;

/** The three ranked values for one salon. */
function metricValues(salon: EngagementFixtureSalon) {
  return {
    perBed: salon.spaSessions / salon.spaBeds,
    perUniquePerBed: salon.spaSessions / salon.totalUniqueTanners / salon.spaBeds,
    uniquePct: salon.uniqueSpaTanners / salon.totalUniqueTanners,
  };
}

/** `RANK.EQ` descending: one plus the count of strictly greater values. */
function rankEq(values: readonly number[], value: number): number {
  return values.filter((other) => other > value).length + 1;
}

/**
 * The ranks and Overall Rank the fixture PUBLISHES, computed the workbook's
 * way so the parser has something real to reproduce.
 */
export function expectedEngagementRanks(salons: readonly EngagementFixtureSalon[]) {
  const all = salons.map((salon) => ({ salon, values: metricValues(salon) }));
  const byMetric = Object.fromEntries(
    RANK_METRICS.map((metric) => [metric, all.map((entry) => entry.values[metric])]),
  ) as Record<(typeof RANK_METRICS)[number], number[]>;

  const scored = all.map((entry) => {
    const ranks = Object.fromEntries(
      RANK_METRICS.map((metric) => [metric, rankEq(byMetric[metric], entry.values[metric])]),
    ) as Record<(typeof RANK_METRICS)[number], number>;
    const score = RANK_METRICS.reduce(
      (total, metric) => total + ENGAGEMENT_FIXTURE_WEIGHTS[metric] * ranks[metric],
      0,
    );
    return { salon: entry.salon, values: entry.values, ranks, score };
  });

  const scores = scored.map((entry) => entry.score);
  return scored.map((entry) => ({
    ...entry,
    // Overall Rank is RANK.EQ ASCENDING on the score, since rank 1 is best.
    overall: scores.filter((other) => other < entry.score).length + 1,
  }));
}

function utc(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDays(iso: string, days: number): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildSpaEngagementWorkbook(
  options: SpaEngagementFixtureOptions = {},
): ExcelJS.Workbook {
  const salons = options.salons ?? ENGAGEMENT_FIXTURE_SALONS;
  const titleRange = options.titleRange ?? "9/1 - 9/1";
  const dailyEnd = options.dailyEnd ?? "2026-09-01";
  const dailyDays = options.dailyDays ?? 3;
  const ranked = expectedEngagementRanks(salons);
  const workbook = new ExcelJS.Workbook();

  // ------------------------------------------------------------ All Summary ---
  const summary = workbook.addWorksheet("All Summary");
  summary.getCell("B1").value = `Spa Sessions per Unique Tanner per Spa Bed: ${titleRange}`;

  // The scope block, above the weights row. Chain-wide, and never a source for
  // a salon figure.
  const scopeRows: [string, number, number, number, number][] = [
    ["Corp", 29, 98, 14, 7],
    ["Fran", 57, 180, 32, 9],
    ["All", 86, 278, 46, 16],
  ];
  scopeRows.forEach(([label, sessions, unique, spaUnique, beds], index) => {
    const row = 2 + index;
    summary.getRow(row).getCell(5).value = label;
    summary.getRow(row).getCell(6).value = sessions;
    summary.getRow(row).getCell(7).value = unique;
    summary.getRow(row).getCell(8).value = spaUnique;
    summary.getRow(row).getCell(9).value = beds;
  });

  const headerRow = 10;
  const weightsRow = headerRow - 1;
  const headers = [
    "",
    "Salon",
    "Ownership",
    "DM",
    "RM",
    "Spa Sessions",
    "Total Unique Tanners",
    "Unique Spa Tanners",
    "# of Spa Beds",
    "Spa Sessions per Bed",
    "Rank",
    "Spa Sessions per Unique Tanner per Spa Bed",
    "Rank",
    "Unique Spa Tanner % of Total Unique",
    "Rank",
    "Overall Rank",
  ].map((header) =>
    options.renameHeader && header === options.renameHeader.from
      ? options.renameHeader.to
      : header,
  );
  headers.forEach((header, index) => {
    if (header) summary.getRow(headerRow).getCell(index + 1).value = header;
  });

  // The weights, directly above their Rank columns (11, 13, 15).
  if (!options.omitWeights) {
    summary.getRow(weightsRow).getCell(11).value = ENGAGEMENT_FIXTURE_WEIGHTS.perBed;
    summary.getRow(weightsRow).getCell(13).value = ENGAGEMENT_FIXTURE_WEIGHTS.perUniquePerBed;
    summary.getRow(weightsRow).getCell(15).value = ENGAGEMENT_FIXTURE_WEIGHTS.uniquePct;
  }

  ranked.forEach((entry, index) => {
    const row = headerRow + 1 + index;
    const cells = summary.getRow(row);
    cells.getCell(2).value = entry.salon.salon;
    cells.getCell(3).value = entry.salon.ownership;
    cells.getCell(4).value = entry.salon.dm;
    cells.getCell(5).value = entry.salon.rm;
    cells.getCell(6).value = entry.salon.spaSessions;
    cells.getCell(7).value = entry.salon.totalUniqueTanners;
    cells.getCell(8).value = entry.salon.uniqueSpaTanners;
    cells.getCell(9).value = entry.salon.spaBeds;
    cells.getCell(10).value = entry.values.perBed;
    cells.getCell(11).value = entry.ranks.perBed;
    cells.getCell(12).value = entry.values.perUniquePerBed;
    cells.getCell(13).value = entry.ranks.perUniquePerBed;
    cells.getCell(14).value = entry.values.uniquePct;
    cells.getCell(15).value = entry.ranks.uniquePct;
    cells.getCell(16).value = entry.overall;
  });

  // --------------------------------------------------------- All DM Ranking ---
  if (!options.omitDmSheet) {
    const dm = workbook.addWorksheet("All DM Ranking");
    dm.getCell("B1").value = "All DM Ranking MTD";
    const dmHeaderRow = 3;
    const dmHeaders = [
      "",
      "RM",
      "DM",
      "Spa Sessions",
      "Total Unique Tanners",
      "Unique Spa Tanners",
      "# of Spa Beds",
      "Spa Sessions per Bed",
      "Rank",
      "Spa Sessions per Unique Tanner per Spa Bed",
      "Rank",
      "Unique Spa Tanner % of Total Unique",
      "Rank",
      "Overall Rank",
    ];
    dmHeaders.forEach((header, index) => {
      if (header) dm.getRow(dmHeaderRow).getCell(index + 1).value = header;
    });
    dm.getRow(dmHeaderRow - 1).getCell(9).value = ENGAGEMENT_FIXTURE_WEIGHTS.perBed;
    dm.getRow(dmHeaderRow - 1).getCell(11).value = ENGAGEMENT_FIXTURE_WEIGHTS.perUniquePerBed;
    dm.getRow(dmHeaderRow - 1).getCell(13).value = ENGAGEMENT_FIXTURE_WEIGHTS.uniquePct;

    // Roll the salons up by DM, then rank the DMs the same way.
    const byDm = new Map<string, EngagementFixtureSalon[]>();
    for (const salon of salons) {
      byDm.set(salon.dm, [...(byDm.get(salon.dm) ?? []), salon]);
    }
    const managers = [...byDm.entries()].map(([name, group]) => ({
      dm: name,
      rm: group[0].rm,
      spaSessions: group.reduce((total, salon) => total + salon.spaSessions, 0),
      totalUniqueTanners: group.reduce((total, salon) => total + salon.totalUniqueTanners, 0),
      uniqueSpaTanners: group.reduce((total, salon) => total + salon.uniqueSpaTanners, 0),
      spaBeds: group.reduce((total, salon) => total + salon.spaBeds, 0),
      salon: name,
      company: group[0].company,
      salonNumber: "",
      ownership: group[0].ownership,
    }));
    const rankedManagers = expectedEngagementRanks(
      managers as unknown as readonly EngagementFixtureSalon[],
    );
    rankedManagers.forEach((entry, index) => {
      const row = dmHeaderRow + 1 + index;
      const manager = managers[index];
      const cells = dm.getRow(row);
      cells.getCell(2).value = manager.rm;
      cells.getCell(3).value = manager.dm;
      cells.getCell(4).value = manager.spaSessions;
      cells.getCell(5).value = manager.totalUniqueTanners;
      cells.getCell(6).value = manager.uniqueSpaTanners;
      cells.getCell(7).value = manager.spaBeds;
      cells.getCell(8).value = entry.values.perBed;
      cells.getCell(9).value = entry.ranks.perBed;
      cells.getCell(10).value = entry.values.perUniquePerBed;
      cells.getCell(11).value = entry.ranks.perUniquePerBed;
      cells.getCell(12).value = entry.values.uniquePct;
      cells.getCell(13).value = entry.ranks.uniquePct;
      cells.getCell(14).value = entry.overall;
    });
  }

  // ------------------------------------------------------- Equipment Counts ---
  if (!options.omitEquipmentSheet) {
    const equipment = workbook.addWorksheet("Equipment Counts");
    ["DB", "DBStoreCode", "StoreLocation", "TypeDescription", "EquipmentCount", "Category", "Corp"].forEach(
      (header, index) => {
        equipment.getRow(1).getCell(index + 1).value = header;
      },
    );
    let row = 2;
    for (const salon of salons) {
      // One row per bed, so the counts sum to `# of Spa Beds`.
      for (let index = 0; index < salon.spaBeds; index += 1) {
        equipment.getRow(row).getCell(1).value = "DB1";
        equipment.getRow(row).getCell(2).value = `1000000${index}`;
        equipment.getRow(row).getCell(3).value = salon.salon;
        equipment.getRow(row).getCell(4).value = `SPA Unit ${index + 1}`;
        equipment.getRow(row).getCell(5).value = 1;
        equipment.getRow(row).getCell(6).value = "Spa";
        equipment.getRow(row).getCell(7).value = salon.ownership;
        row += 1;
      }
    }
  }

  // ---------------------------------------------------------- Unique by Day ---
  if (!options.omitDailySheet) {
    const daily = workbook.addWorksheet("Unique by Day");
    [
      "DB",
      "Date",
      "DBStoreCode",
      "StoreLocation",
      "UniqueTanners",
      "UniqueSpaTanners",
      "TotalVisits",
      "SpaVisits",
    ].forEach((header, index) => {
      daily.getRow(1).getCell(index + 1).value = header;
    });
    let row = 2;
    for (let offset = dailyDays - 1; offset >= 0; offset -= 1) {
      const date = shiftDays(dailyEnd, -offset);
      // `Corp` and `Fran` appear as pseudo-stores in the real sheet; included
      // so the parser has to exclude them via the roster.
      for (const pseudo of ["Corp", "Fran"]) {
        daily.getRow(row).getCell(1).value = "DB1";
        daily.getRow(row).getCell(2).value = utc(date);
        daily.getRow(row).getCell(3).value = pseudo;
        daily.getRow(row).getCell(4).value = pseudo;
        daily.getRow(row).getCell(5).value = 5000;
        daily.getRow(row).getCell(6).value = 600;
        daily.getRow(row).getCell(7).value = 6000;
        daily.getRow(row).getCell(8).value = 900;
        row += 1;
      }
      for (const salon of salons) {
        daily.getRow(row).getCell(1).value = "DB1";
        daily.getRow(row).getCell(2).value = utc(date);
        daily.getRow(row).getCell(3).value = salon.salonNumber;
        daily.getRow(row).getCell(4).value = salon.salon;
        daily.getRow(row).getCell(5).value = salon.totalUniqueTanners;
        daily.getRow(row).getCell(6).value = salon.uniqueSpaTanners;
        daily.getRow(row).getCell(7).value = salon.totalUniqueTanners + 12;
        daily.getRow(row).getCell(8).value = salon.spaSessions;
        row += 1;
      }
    }
  }

  // ---------------------------------------------------------------- Roster ---
  if (!options.omitRosterSheet) {
    const roster = workbook.addWorksheet("Roster");
    const rosterHeaders = [
      "StoreLocation",
      "RM",
      "DM",
      "Trainer",
      "Manager",
      "MainTech",
      "Franchise Support Manager",
      // `Corp` is the OPERATING COMPANY. `Corp/Fran` below is the franchise
      // flag. Two similarly named columns, entirely different meanings.
      "Corp",
      "OwnershipGroup",
      "DateOpened",
      "SalonNumber",
      "StoreCode",
      "Address1",
      "City",
      "State",
      "ZipCode",
      "Phone1",
      "Phone2",
      "e-mail",
      "DM E-mail",
      "Corp/Fran",
    ];
    rosterHeaders.forEach((header, index) => {
      roster.getRow(1).getCell(index + 1).value = header;
    });
    let row = 2;
    for (const salon of salons) {
      if (salon.omitFromRoster) continue;
      const cells = roster.getRow(row);
      cells.getCell(1).value = salon.salon;
      cells.getCell(2).value = salon.rm;
      cells.getCell(3).value = salon.dm;
      cells.getCell(8).value = salon.company;
      cells.getCell(9).value = salon.ownership === "Corp" ? "Consolidated" : "Franchisees";
      cells.getCell(10).value = utc("2014-03-11");
      cells.getCell(11).value = options.numericSalonNumbers
        ? Number(salon.salonNumber)
        : salon.salonNumber;
      cells.getCell(14).value = "Somewhere";
      cells.getCell(15).value = "ZZ";
      cells.getCell(21).value = salon.ownership;
      row += 1;
    }
  }

  return workbook;
}

export async function spaEngagementFixtureBytes(
  options: SpaEngagementFixtureOptions = {},
): Promise<Uint8Array> {
  const buffer = await buildSpaEngagementWorkbook(options).xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
