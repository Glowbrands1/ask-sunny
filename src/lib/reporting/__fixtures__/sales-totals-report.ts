import { SALES_TOTALS_MEASURES } from "../sales-totals/metric-map";

/**
 * ============================================================================
 * A SALES TOTALS REPORT, STRUCTURALLY FAITHFUL AND ENTIRELY INVENTED
 * ============================================================================
 *
 * The real reports carry salon-level financials for a live business and are
 * never committed. This reproduces their STRUCTURE exactly — which is the part
 * the parser depends on — with figures that are made up.
 *
 * Faithful to the real file in every respect that matters to parsing, including
 * the awkward parts, because those are what a fixture exists to exercise:
 *
 *   * HTML with an `.xls` filename, opening `<html><title>Sales Totals</title>`
 *   * a `<script src>` tag, and a `<form action>` with a hidden input — the
 *     live markup the reader must discard rather than follow
 *   * the report date only in an `<h3>`, never in a table and never in the
 *     filename
 *   * the Sunless footnote between the heading and the first table
 *   * measure names SPLIT across a pair of header cells ("Grand"+"Total",
 *     "New"+"Customers") with each measure owning two columns, report day then
 *     `MTD`
 *   * two blocks with different populations: `Averages | Salon Counts` over all
 *     salons, then `Company | Salon` over the recipient's few
 *   * currency with `$` and thousands separators, counts bare
 *
 * `options` exist so a test can break exactly one of those things and prove the
 * parser fails closed rather than shifting figures sideways.
 */

export interface SalesTotalsFixtureRow {
  /** Summary scope label, or the store name for a salon row. */
  readonly label: string;
  /** Salon rows only. */
  readonly company?: string;
  /** Summary rows only. */
  readonly salonCount?: number;
  /** Six pairs, in measure order: [day, mtd]. */
  readonly values: readonly (readonly [number, number])[];
}

export interface SalesTotalsFixtureOptions {
  /** `MM-DD-YYYY`, as the report writes it. */
  readonly reportDate?: string;
  readonly summaryRows?: readonly SalesTotalsFixtureRow[];
  readonly salonRows?: readonly SalesTotalsFixtureRow[];
  /** Drop the `<h3>` that carries the date. */
  readonly omitDateHeading?: boolean;
  /** Drop the `<title>`. */
  readonly omitTitle?: boolean;
  /** Rename one measure's header, e.g. `{ Tans: "Sessions" }`. */
  readonly renameMeasure?: Readonly<Record<string, string>>;
  /** Remove a measure's column pair entirely, shifting the rest left. */
  readonly dropMeasure?: string;
  /** Replace the `MTD` label in the window row. */
  readonly mtdLabel?: string;
  /** Extra `<script>` body, to prove it is never read as data. */
  readonly scriptBody?: string;
  /** Emit only the summary block. */
  readonly omitSalonBlock?: boolean;
  /** Emit the blocks' headers but no data rows. */
  readonly omitSummaryData?: boolean;
}

/** Currency the way the report writes it. */
function money(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatValue(measureIndex: number, value: number): string {
  const measure = SALES_TOTALS_MEASURES[measureIndex];
  return measure.unit === "currency" ? money(value) : String(value);
}

const DEFAULT_SUMMARY: readonly SalesTotalsFixtureRow[] = [
  {
    label: "All Salons",
    salonCount: 249,
    values: [
      [811.11, 1622.22],
      [2.11, 2.12],
      [121, 242],
      [1, 2],
      [3, 6],
      [11, 22],
    ],
  },
  {
    label: "STC Consolidated",
    salonCount: 98,
    values: [
      [711.11, 1422.22],
      [1.81, 1.82],
      [131, 262],
      [1, 2],
      [3, 6],
      [13, 26],
    ],
  },
  {
    label: "STC Franchisees",
    salonCount: 151,
    values: [
      [871.11, 1742.22],
      [2.51, 2.52],
      [111, 222],
      [1, 2],
      [3, 6],
      [10, 20],
    ],
  },
];

/**
 * Two salons whose names match real canonical store names, because the join to
 * `salons.store_name` is exact and a fixture with invented names could not
 * exercise it. The FIGURES are invented.
 */
const DEFAULT_SALONS: readonly SalesTotalsFixtureRow[] = [
  {
    label: "KS Lawrence",
    company: "STC Franchisees",
    values: [
      [700.11, 1500.22],
      [3.11, 3.22],
      [91, 171],
      [3, 5],
      [2, 4],
      [11, 18],
    ],
  },
  {
    label: "MO Kansas City Liberty",
    company: "STC Franchisees",
    values: [
      [1011.11, 3222.33],
      [1.11, 2.22],
      [251, 491],
      [1, 4],
      [1, 3],
      [31, 55],
    ],
  },
  {
    label: "NE Omaha 144th and Center",
    company: "STC Franchisees",
    values: [
      [451.11, 499.22],
      [6.71, 3.91],
      [46, 95],
      [1, 1],
      [1, 2],
      [3, 7],
    ],
  },
];

/** The measures this fixture emits, after any `dropMeasure`. */
function measuresFor(options: SalesTotalsFixtureOptions) {
  return SALES_TOTALS_MEASURES.filter((measure) => measure.header !== options.dropMeasure);
}

/** The two header rows a block carries: split measure names, then windows. */
function blockHeader(
  options: SalesTotalsFixtureOptions,
  reportDate: string,
  leftLabels: readonly [string, string],
): string {
  const measures = measuresFor(options);
  const mtd = options.mtdLabel ?? "MTD";

  const nameCells = measures
    .map((measure) => {
      const header = options.renameMeasure?.[measure.header] ?? measure.header;
      // Two cells per measure, splitting a two-word name across them exactly as
      // the source does. A one-word name leaves the second cell empty.
      const parts = header.split(" ");
      const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : header;
      const second = parts.length > 1 ? parts[parts.length - 1] : "";
      return `<th class="header">${first}</th><th class="header">${second}</th>`;
    })
    .join("");

  const windowCells = measures
    .map(() => `<th>${reportDate}</th><th>${mtd}</th>`)
    .join("");

  return [
    `<tr><th></th><th></th>${nameCells}</tr>`,
    `<tr><th>${leftLabels[0]}</th><th>${leftLabels[1]}</th>${windowCells}</tr>`,
  ].join("\n");
}

function dataRow(
  options: SalesTotalsFixtureOptions,
  row: SalesTotalsFixtureRow,
  second: string,
): string {
  const measures = measuresFor(options);
  const cells = measures
    .map((measure) => {
      const index = SALES_TOTALS_MEASURES.findIndex((m) => m.code === measure.code);
      const pair = row.values[index] ?? [0, 0];
      return `<td>${formatValue(index, pair[0])}</td><td>${formatValue(index, pair[1])}</td>`;
    })
    .join("");
  return `<tr><td>${row.label}</td><td>${second}</td>${cells}</tr>`;
}

/** The report as an HTML string. */
export function salesTotalsFixtureHtml(options: SalesTotalsFixtureOptions = {}): string {
  const reportDate = options.reportDate ?? "09-02-2026";
  const summaryRows = options.summaryRows ?? DEFAULT_SUMMARY;
  const salonRows = options.salonRows ?? DEFAULT_SALONS;

  const title = options.omitTitle ? "" : "<title>Sales Totals</title>";
  const heading = options.omitDateHeading
    ? ""
    : `<h3>Sales Totals for ${reportDate}</h3>`;

  /*
   * The live markup, reproduced. A `src` that must never be fetched, a body that
   * must never be read as data (it emits a table row on purpose), and a form
   * whose action must never be followed.
   */
  const scriptBody = options.scriptBody ?? "";
  const script =
    `<script type="text/javascript" src='/inc/js/number_formats.js'>${scriptBody}</script>`;

  const summaryBlock = [
    blockHeader(options, reportDate, ["Averages", "Salon Counts"]),
    ...(options.omitSummaryData
      ? []
      : summaryRows.map((row) => dataRow(options, row, String(row.salonCount ?? "")))),
  ].join("\n");

  const salonBlock = options.omitSalonBlock
    ? ""
    : [
        blockHeader(options, reportDate, ["Company", "Salon"]),
        ...salonRows.map((row) =>
          // Company is first, salon second — the reverse of the summary block.
          `<tr><td>${row.company ?? ""}</td><td>${row.label}</td>${SALES_TOTALS_MEASURES.filter(
            (measure) => measure.header !== options.dropMeasure,
          )
            .map((measure) => {
              const index = SALES_TOTALS_MEASURES.findIndex((m) => m.code === measure.code);
              const pair = row.values[index] ?? [0, 0];
              return `<td>${formatValue(index, pair[0])}</td><td>${formatValue(index, pair[1])}</td>`;
            })
            .join("")}</tr>`,
        ),
      ].join("\n");

  return `<html>${title}
        <div align='center'>
        ${script}
        <style type="text/css">
          table { border-collapse: collapse; }
          .header{ background-color: #F3A947; color: black; }
        </style>
        <form action="/dailysales/SalesTotals.php" method='POST'>
        <input type='hidden' name='process' value=2>
        ${heading}
        <table cellspacing=1 cellpadding=2>
        <tr><td colspan=14>Note: For Sunless sessions, the Equipment Description needs to have "Versa", "Myst", "Norvell", "SunStyle", "Airbrush", "Pura" and "Xpression" in the name to be counted as a Sunless Tan.</td></tr>
        ${summaryBlock}
        ${salonBlock}
        </table>
        </form>
        </div>
        </html>`;
}

/** The report as bytes, which is what a parser receives. */
export function salesTotalsFixtureBytes(
  options: SalesTotalsFixtureOptions = {},
): Uint8Array {
  return new TextEncoder().encode(salesTotalsFixtureHtml(options));
}

export { DEFAULT_SUMMARY as SALES_TOTALS_FIXTURE_SUMMARY, DEFAULT_SALONS as SALES_TOTALS_FIXTURE_SALONS };
