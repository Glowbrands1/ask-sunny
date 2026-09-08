import ExcelJS from "exceljs";

/**
 * SYNTHETIC SPA WELLNESS TRACKING WORKBOOKS.
 *
 * The real workbook is NEVER committed: it carries 248 salons of session
 * volumes, retail revenue and manager names. This fixture reproduces the
 * structure — a title, a summary block whose date column carries the window's
 * bounds, a salon header row, dynamic equipment columns closed by
 * `Total SPA Sessions (Active Beds)`, then retail columns beyond it, plus the
 * two per-equipment date sheets — with invented everything.
 *
 * BUILT TO FAIL THE PLAUSIBLE WRONG IMPLEMENTATIONS:
 *
 *   * RETAIL COLUMNS SIT AFTER THE TOTAL, one of them named `SPA Products Net
 *     Sales` — so a parser that identifies equipment by a `SPA ` prefix rather
 *     than by the block boundary picks up a dollar figure as a machine, and the
 *     row-level reconciliation against the total catches it.
 *   * A DESCRIPTOR COLUMN IS ALSO NAMED `SPA ...` (`SPA Equipment First Use`),
 *     immediately before the equipment block, for the same reason.
 *   * ONE EQUIPMENT TYPE IS DELIBERATELY NOVEL and appears nowhere in any
 *     application list, so "a new type needs no deployment" is a test rather
 *     than a claim.
 *   * ABSENT EQUIPMENT IS EXPRESSED BOTH WAYS — blank in most cells and an
 *     EXPLICIT ZERO in one — because the business rule covers both and the real
 *     August file happens to contain only blanks.
 *   * PEERS WITH AND WITHOUT EACH TYPE, so a peer average computed over the
 *     whole population instead of over installed peers is visibly wrong.
 */

export const SPA_FIXTURE_AUTHORIZED_COMPANY = "Meridian Leisure Group";
export const SPA_FIXTURE_OTHER_COMPANY = "Northlake Tanning Co";

/** The descriptor headers, in the order the real sheet writes them. */
export const SPA_FIXTURE_DESCRIPTORS: readonly string[] = [
  "Salon",
  "District",
  "Region",
  "SPA Equipment First Use",
  "Newest Use Date",
  "Count of SPA Equipment",
  "Comp",
  "Company",
];

/**
 * The equipment columns. `Calmwave Lounge` is the novel one — no application
 * list contains it, and the parser must still discover, code and rank it.
 */
export const SPA_FIXTURE_EQUIPMENT: readonly string[] = [
  "SPA Hydromassage",
  "SPA Massage Chair",
  "SPA Poly RLT",
  "SPA Calmwave Lounge",
  "Other",
];

/** Columns beyond the total. Retail money, not sessions. */
export const SPA_FIXTURE_TRAILING: readonly string[] = [
  "BOT Restored Prep Spray",
  "SPA Products Net Sales",
  "SPA % of Total Visits",
];

export interface SpaFixtureSalon {
  readonly salon: string;
  readonly company: string;
  readonly district: string;
  readonly region: string;
  /** Equipment header -> sessions. Absent keys are blank cells. */
  readonly use: Readonly<Record<string, number>>;
  /** Equipment headers written as an EXPLICIT ZERO rather than left blank. */
  readonly explicitZeros?: readonly string[];
  /** Installed UNITS, which can exceed the number of types used. */
  readonly pieces: number;
  readonly firstUse?: string;
  readonly newestUse?: string;
  readonly comp?: boolean;
}

/**
 * THE DEFAULT POPULATION.
 *
 * Three authorized salons and three others. Hydromassage is installed
 * everywhere; Massage Chair at four of six; Poly RLT at three; the novel
 * Calmwave Lounge at two, one of them ours.
 *
 * Hydromassage is the arithmetic that matters:
 *   ours   100, 200, 300   -> average 200
 *   peers  400, 500, 600   -> average 500  -> ours is 60% below its peers
 *   chain  all six         -> average 350
 * A peer average taken over every salon in the file rather than over installed
 * peers would be 350 and the delta would be -42.9%, so the two are
 * distinguishable.
 */
export const SPA_FIXTURE_SALONS: readonly SpaFixtureSalon[] = [
  {
    salon: "Aurora Springs",
    company: SPA_FIXTURE_AUTHORIZED_COMPANY,
    district: "Hale, Rowan",
    region: "Vance, Imogen",
    use: { "SPA Hydromassage": 100, "SPA Massage Chair": 40, "SPA Poly RLT": 60 },
    pieces: 4,
    firstUse: "2024-02-20",
    newestUse: "2026-08-27",
    comp: true,
  },
  {
    salon: "Brookmere Park",
    company: SPA_FIXTURE_AUTHORIZED_COMPANY,
    district: "Hale, Rowan",
    region: "Vance, Imogen",
    use: { "SPA Hydromassage": 200, "SPA Poly RLT": 90, "SPA Calmwave Lounge": 30 },
    // An installed Massage Chair that took no sessions is NOT expressible in
    // this source — a zero means not installed — so the zero here is exactly
    // the case the rule governs.
    explicitZeros: ["SPA Massage Chair"],
    pieces: 3,
    firstUse: "2026-07-14",
    newestUse: "2026-08-02",
    comp: false,
  },
  {
    salon: "Calder Vale",
    company: SPA_FIXTURE_AUTHORIZED_COMPANY,
    district: "Ogden, Priya",
    region: "Vance, Imogen",
    use: { "SPA Hydromassage": 300, "SPA Massage Chair": 120 },
    pieces: 2,
    firstUse: "2023-05-02",
    newestUse: "2023-05-02",
    comp: true,
  },
  {
    salon: "Dunmore Cross",
    company: SPA_FIXTURE_OTHER_COMPANY,
    district: "Sable, Marek",
    region: "Quill, Teodor",
    use: { "SPA Hydromassage": 400, "SPA Massage Chair": 500, "SPA Poly RLT": 150 },
    pieces: 5,
    comp: true,
  },
  {
    salon: "Eastmoor Row",
    company: SPA_FIXTURE_OTHER_COMPANY,
    district: "Sable, Marek",
    region: "Quill, Teodor",
    use: { "SPA Hydromassage": 500, "SPA Massage Chair": 700 },
    pieces: 3,
    comp: true,
  },
  {
    salon: "Fenwick Gate",
    company: SPA_FIXTURE_OTHER_COMPANY,
    district: "Sable, Marek",
    region: "Quill, Teodor",
    use: { "SPA Hydromassage": 600, "SPA Calmwave Lounge": 90 },
    pieces: 2,
    comp: false,
  },
];

/** Per-equipment first and last use, for the date sheets. */
export const SPA_FIXTURE_EQUIPMENT_DATES: readonly {
  readonly salon: string;
  readonly equipment: string;
  readonly firstUse: string;
  readonly lastUse: string;
}[] = [
  {
    salon: "Aurora Springs",
    equipment: "SPA Hydromassage",
    firstUse: "2024-02-20",
    lastUse: "2026-08-31",
  },
  {
    salon: "Aurora Springs",
    equipment: "SPA Massage Chair",
    firstUse: "2026-08-27",
    lastUse: "2026-08-30",
  },
  {
    salon: "Brookmere Park",
    equipment: "SPA Calmwave Lounge",
    firstUse: "2026-08-02",
    lastUse: "2026-08-29",
  },
];

export interface SpaWellnessFixtureOptions {
  /** Which window sheets to write. Defaults to MTD and YTD. */
  readonly sheets?: readonly ("MTD" | "YTD" | "LTM")[];
  readonly salons?: readonly SpaFixtureSalon[];
  /** Overrides the MTD window's bounds. */
  readonly mtd?: { start: string; end: string };
  /** Rename the closing total column, to exercise drift detection. */
  readonly totalHeader?: string;
  /** Omit the two per-equipment date sheets. */
  readonly omitDateSheets?: boolean;
  /** Break the total on one salon's row, to exercise reconciliation. */
  readonly corruptTotalFor?: string;
  /** Insert an unheadered column inside the equipment block. */
  readonly blankEquipmentHeader?: boolean;
  /** Append an equipment column the salons do not use. */
  readonly extraEquipment?: string;
}

const WINDOW_BOUNDS: Record<string, { start: string; end: string; label: string }> = {
  MTD: { start: "2026-08-01", end: "2026-08-31", label: "Month to Date" },
  YTD: { start: "2026-01-01", end: "2026-08-31", label: "Year to Date" },
  LTM: { start: "2025-08-31", end: "2026-08-31", label: "Last Twelve Months" },
};

/** YTD and LTM are the MTD figures scaled, so each window is distinguishable. */
const WINDOW_SCALE: Record<string, number> = { MTD: 1, YTD: 8, LTM: 12 };

function utc(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function buildSpaWellnessWorkbook(
  options: SpaWellnessFixtureOptions = {},
): ExcelJS.Workbook {
  const salons = options.salons ?? SPA_FIXTURE_SALONS;
  const sheets = options.sheets ?? (["MTD", "YTD"] as const);
  const equipment = [
    ...SPA_FIXTURE_EQUIPMENT,
    ...(options.extraEquipment ? [options.extraEquipment] : []),
  ];
  const workbook = new ExcelJS.Workbook();

  for (const name of sheets) {
    const bounds =
      name === "MTD" && options.mtd
        ? { ...WINDOW_BOUNDS.MTD, ...options.mtd }
        : WINDOW_BOUNDS[name];
    const scale = WINDOW_SCALE[name];
    const sheet = workbook.addWorksheet(name);

    sheet.getCell("B1").value = `STC SPA Wellness Tracking - ${bounds.label}`;

    // The summary block. Its `Date This Year` column carries the window's
    // start on the first row beneath the header and its end on the next.
    sheet.getCell("B3").value = "Date This Year";
    sheet.getCell("C3").value = "Date Last Year";
    sheet.getCell("D3").value = "Metric";
    sheet.getCell("B4").value = utc(bounds.start);
    sheet.getCell("D4").value = "Filtered Total";
    sheet.getCell("B5").value = utc(bounds.end);
    sheet.getCell("D5").value = "Filtered Average";
    sheet.getCell("D6").value = "Filtered % of Trans.";

    // The salon header row.
    const headerRow = 10;
    const columns: string[] = [...SPA_FIXTURE_DESCRIPTORS];
    if (options.blankEquipmentHeader) columns.push("");
    columns.push(...equipment);
    const totalIndex = columns.length + 1;
    columns.push(options.totalHeader ?? "Total SPA Sessions (Active Beds)");
    columns.push(...SPA_FIXTURE_TRAILING);
    columns.forEach((header, index) => {
      if (header) sheet.getRow(headerRow).getCell(index + 1).value = header;
    });

    const columnOf = (header: string) => columns.indexOf(header) + 1;

    salons.forEach((salon, index) => {
      const row = headerRow + 1 + index;
      const set = (header: string, value: string | number | Date | boolean | null) => {
        const column = columnOf(header);
        if (column > 0) sheet.getRow(row).getCell(column).value = value as ExcelJS.CellValue;
      };
      set("Salon", salon.salon);
      set("District", salon.district);
      set("Region", salon.region);
      if (salon.firstUse) set("SPA Equipment First Use", utc(salon.firstUse));
      if (salon.newestUse) set("Newest Use Date", utc(salon.newestUse));
      set("Count of SPA Equipment", salon.pieces);
      set("Comp", salon.comp ? "Yes" : "No");
      set("Company", salon.company);

      let total = 0;
      for (const header of equipment) {
        const sessions = salon.use[header];
        if (sessions !== undefined) {
          const scaled = sessions * scale;
          set(header, scaled);
          total += scaled;
          continue;
        }
        // Absent equipment: an explicit zero where the fixture asks for one,
        // otherwise a blank cell. Both mean NOT INSTALLED.
        if (salon.explicitZeros?.includes(header)) set(header, 0);
      }

      sheet.getRow(row).getCell(totalIndex).value =
        salon.salon === options.corruptTotalFor ? total + 7 : total;

      // Retail columns beyond the total. Money, and large — so a parser that
      // reads past the boundary is caught by the reconciliation immediately.
      SPA_FIXTURE_TRAILING.forEach((header, offset) => {
        set(header, 1000 + offset * 137.5);
      });
    });
  }

  if (!options.omitDateSheets) {
    for (const [name, descriptors, dateKey] of [
      [
        "First Use Dates",
        ["Salon", "District", "Region", "First Use Date", "Newest Use Date", "Comp", "Count of SPA Equipment"],
        "firstUse",
      ],
      [
        "Last Use Dates",
        ["Salon", "District", "Region", "Oldest Last Use", "Newest Last Use"],
        "lastUse",
      ],
    ] as const) {
      const sheet = workbook.addWorksheet(name);
      sheet.getCell("B1").value = `STC SPA Wellness Equipment ${name}`;
      const headerRow = 3;
      // NOTE the two sheets carry DIFFERENT descriptor columns, so the
      // equipment block starts at a different column on each — which is why
      // the parser resolves it per sheet rather than once.
      const columns = [...descriptors, ...SPA_FIXTURE_EQUIPMENT];
      columns.forEach((header, index) => {
        sheet.getRow(headerRow).getCell(index + 2).value = header;
      });
      const salonNames = [...new Set(SPA_FIXTURE_EQUIPMENT_DATES.map((entry) => entry.salon))];
      salonNames.forEach((salonName, index) => {
        const row = headerRow + 1 + index;
        sheet.getRow(row).getCell(2).value = salonName;
        for (const entry of SPA_FIXTURE_EQUIPMENT_DATES) {
          if (entry.salon !== salonName) continue;
          const column = columns.indexOf(entry.equipment) + 2;
          if (column > 1) sheet.getRow(row).getCell(column).value = utc(entry[dateKey]);
        }
      });
    }
  }

  return workbook;
}

export async function spaWellnessFixtureBytes(
  options: SpaWellnessFixtureOptions = {},
): Promise<Uint8Array> {
  const buffer = await buildSpaWellnessWorkbook(options).xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
