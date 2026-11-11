import { PRODUCTION_SALONS } from "@/data/salons";
import { AUTHORIZED_COMPANY } from "../store-identity";
import { KNOWN_METRICS_BY_CODE } from "../comp-sales/metric-catalogue";
import { SALES_TOTALS_MEASURES } from "../sales-totals/metric-map";
import { SPA_ENGAGEMENT_RANK_METRICS } from "../spa-engagement/metric-map";
import {
  SPA_WELLNESS_OTHER_HEADER,
  spaEquipmentCode,
  spaEquipmentShortLabel,
} from "../spa-wellness/metric-map";

/**
 * ============================================================================
 * DEMO REPORTING DATA — INVENTED FIGURES, IN THE SHAPE SUPABASE RETURNS
 * ============================================================================
 *
 * DEMO CONTENT. Every figure below is generated; none of it represents real Sun
 * Tan City performance. The SALONS are the demo's existing fifteen (the same
 * list the role picker and the demo users are scoped to), filed under the
 * demo's invented districts and regions rather than the managers reporting
 * names, so no real person appears.
 *
 * These are ROWS, not view models: each table below holds exactly the columns
 * the reporting views hand the read layer in production. The fake client in
 * `./client.ts` serves them through the same query calls, so every page runs
 * its real resolver, builders and interpretation on top — the screens are the
 * live ones.
 *
 * Deterministic: a seeded generator keyed on the salon number, so a reload
 * shows the same figures and a screenshot can be compared.
 */

export type DemoRow = Record<string, unknown>;

/* ------------------------------------------------------------- the estate */

/** District and region labels as reporting would carry them, invented. */
export const DEMO_DISTRICTS = {
  "dist-1": "District 1",
  "dist-2": "District 2",
  "dist-3": "District 3",
} as const;

export const DEMO_REGIONS = {
  "reg-a": "Region A",
  "reg-b": "Region B",
} as const;

/** Which demo district each salon is in. Matches `src/data/demo/reports.ts`. */
const DISTRICT_OF: Record<string, keyof typeof DEMO_DISTRICTS> = {
  "0313": "dist-1",
  "0314": "dist-1",
  "0410": "dist-1",
  "0495": "dist-1",
  "0307": "dist-2",
  "0309": "dist-2",
  "0310": "dist-2",
  "0311": "dist-2",
  "0312": "dist-2",
  "0306": "dist-3",
  "0394": "dist-3",
  "0462": "dist-3",
  "0463": "dist-3",
  "0468": "dist-3",
  "0476": "dist-3",
};

const REGION_OF_DISTRICT: Record<keyof typeof DEMO_DISTRICTS, keyof typeof DEMO_REGIONS> = {
  "dist-1": "reg-a",
  "dist-2": "reg-a",
  "dist-3": "reg-b",
};

const DMA_OF: Record<string, string> = {
  "0306": "Kansas City",
  "0307": "Lincoln-Hastings-Kearney",
  "0309": "Lincoln-Hastings-Kearney",
  "0310": "Lincoln-Hastings-Kearney",
  "0311": "Lincoln-Hastings-Kearney",
  "0312": "Lincoln-Hastings-Kearney",
  "0313": "Omaha",
  "0314": "Omaha",
  "0394": "Kansas City",
  "0410": "Omaha",
  "0462": "Topeka",
  "0463": "Kansas City",
  "0468": "Kansas City",
  "0476": "Kansas City",
  "0495": "St. Joseph",
};

/** How busy each salon is, relative to an average one. Invented. */
const SIZE: Record<string, number> = {
  "0314": 1.32,
  "0495": 1.24,
  "0313": 1.19,
  "0306": 1.14,
  "0463": 1.08,
  "0307": 1.02,
  "0310": 0.98,
  "0311": 0.95,
  "0394": 0.92,
  "0410": 0.88,
  "0468": 0.84,
  "0312": 0.8,
  "0462": 0.78,
  "0309": 0.74,
  "0476": 0.7,
};

/**
 * Year-over-year trend, as a fraction. Mixed on purpose: a demo where every
 * salon is up has nothing for the movers chart or the reading to say.
 */
const TREND: Record<string, number> = {
  "0314": 0.071,
  "0495": 0.043,
  "0313": -0.018,
  "0306": 0.112,
  "0463": -0.064,
  "0307": 0.026,
  "0310": 0.152,
  "0311": -0.037,
  "0394": 0.008,
  "0410": -0.109,
  "0468": 0.059,
  "0312": 0.184,
  "0462": -0.021,
  "0309": -0.072,
  "0476": 0.034,
};

export interface DemoSalon {
  readonly salonNumber: string;
  readonly storeName: string;
  readonly districtId: keyof typeof DEMO_DISTRICTS;
  readonly districtLabel: string;
  readonly regionId: keyof typeof DEMO_REGIONS;
  readonly regionLabel: string;
  readonly dma: string;
  readonly size: number;
  readonly trend: number;
}

export const DEMO_REPORT_SALONS: readonly DemoSalon[] = PRODUCTION_SALONS.map((salon) => {
  const districtId = DISTRICT_OF[salon.salonNumber] ?? "dist-1";
  const regionId = REGION_OF_DISTRICT[districtId];
  return {
    salonNumber: salon.salonNumber,
    storeName: salon.name,
    districtId,
    districtLabel: DEMO_DISTRICTS[districtId],
    regionId,
    regionLabel: DEMO_REGIONS[regionId],
    dma: DMA_OF[salon.salonNumber] ?? "Omaha",
    size: SIZE[salon.salonNumber] ?? 1,
    trend: TREND[salon.salonNumber] ?? 0,
  };
});

/** The demo salons an area id covers. Empty for an id the demo does not know. */
export function demoSalonNumbersForArea(areaId: string): string[] {
  return DEMO_REPORT_SALONS.filter(
    (salon) => salon.districtId === areaId || salon.regionId === areaId,
  ).map((salon) => salon.salonNumber);
}

export function demoAreaLabel(areaId: string | null | undefined): string | null {
  if (!areaId) return null;
  if (areaId in DEMO_DISTRICTS) return DEMO_DISTRICTS[areaId as keyof typeof DEMO_DISTRICTS];
  if (areaId in DEMO_REGIONS) return DEMO_REGIONS[areaId as keyof typeof DEMO_REGIONS];
  return null;
}

/* ------------------------------------------------------------ generators */

/** A small deterministic generator: the same seed gives the same figures. */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

/** A multiplier around 1, within ±spread. */
function jitter(random: () => number, spread: number): number {
  return 1 + (random() * 2 - 1) * spread;
}

function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const COMPANY = AUTHORIZED_COMPANY;
const CHAIN_SALON_COUNT = 249;

/* ======================================================== comp sales (MTD) */

const SHEET_VS = "CompReport(MTD) vs 2024";
const SHEET_ROLLING = "CompReport(MTD)";
const CURRENT_YEAR = 2026;
const BASIS_YEARS = [2025, 2024] as const;

interface DemoCompPeriod {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly label: string;
  readonly days: number;
  readonly ingestedAt: string;
}

/** Two month-to-date periods, so the Period control has a choice. */
const COMP_PERIODS: readonly DemoCompPeriod[] = [
  {
    id: "demo-comp-2026-11-10",
    start: "2026-11-01",
    end: "2026-11-10",
    label: "MTD 11/10/2026",
    days: 10,
    ingestedAt: "2026-11-11T12:42:00Z",
  },
  {
    id: "demo-comp-2026-10-31",
    start: "2026-10-01",
    end: "2026-10-31",
    label: "MTD 10/31/2026",
    days: 31,
    ingestedAt: "2026-11-01T12:38:00Z",
  },
];

interface SalonMonth {
  otc: number;
  eft: number;
  uv: number;
  sunless: number;
  spa: number;
  unique: number;
}

/** One salon's month-to-date figures for a period, before any comparison. */
function salonFigures(salon: DemoSalon, period: DemoCompPeriod, salt: string): SalonMonth {
  const random = seeded(`${salon.salonNumber}:${period.id}:${salt}`);
  const dailyRevenue = 3150 * salon.size * jitter(random, 0.06);
  const total = dailyRevenue * period.days;
  const eftShare = 0.6 * jitter(random, 0.08);
  const tans = (total / 9.1) * jitter(random, 0.05);
  return {
    otc: total * (1 - eftShare),
    eft: total * eftShare,
    uv: tans * 0.86,
    sunless: tans * 0.05 * jitter(random, 0.3),
    spa: tans * 0.09 * jitter(random, 0.25),
    unique: tans * 0.37 * jitter(random, 0.06),
  };
}

/** The same salon a year (or two) earlier: current figures divided out by a trend. */
function priorFigures(
  salon: DemoSalon,
  period: DemoCompPeriod,
  current: SalonMonth,
  basisYear: number,
): SalonMonth {
  const random = seeded(`${salon.salonNumber}:${period.id}:prior:${basisYear}`);
  const years = CURRENT_YEAR - basisYear;
  const growth = (measure: number) => (1 + salon.trend * measure * jitter(random, 0.35)) ** years;
  return {
    otc: current.otc / growth(0.8),
    eft: current.eft / growth(1.25),
    uv: current.uv / growth(0.7),
    sunless: current.sunless / growth(1.6),
    spa: current.spa / growth(1.4),
    unique: current.unique / growth(0.6),
  };
}

function measuresOf(month: SalonMonth): Record<string, number> {
  return {
    otc_revenue: round(month.otc, 2),
    eft_revenue: round(month.eft, 2),
    total_revenue: round(month.otc + month.eft, 2),
    uv_tans: Math.round(month.uv),
    sunless_tans: Math.round(month.sunless),
    spa_sessions: Math.round(month.spa),
    unique_tanners: Math.round(month.unique),
    total_tans: Math.round(month.uv + month.sunless),
  };
}

function columnFor(code: string, basisYear: number | null): string {
  const mapping = KNOWN_METRICS_BY_CODE.get(code);
  if (!mapping || basisYear === null) return "";
  return mapping.observedColumns[String(basisYear)] ?? "";
}

function compFacts(): DemoRow[] {
  const facts: DemoRow[] = [];
  for (const period of COMP_PERIODS) {
    for (const salon of DEMO_REPORT_SALONS) {
      const fact = (
        code: string,
        basisYear: number | null,
        value: number,
        sheet: string,
      ): DemoRow => ({
        period_id: period.id,
        salon_number: salon.salonNumber,
        store_name: salon.storeName,
        metric_code: code,
        basis_year: basisYear,
        value,
        source_sheet: sheet,
        source_column: columnFor(code, basisYear),
      });

      const current = measuresOf(salonFigures(salon, period, "current"));
      for (const [code, value] of Object.entries(current)) {
        facts.push(fact(code, CURRENT_YEAR, value, SHEET_VS));
      }
      for (const year of BASIS_YEARS) {
        const prior = measuresOf(
          priorFigures(salon, period, salonFigures(salon, period, "current"), year),
        );
        for (const [code, value] of Object.entries(prior)) {
          facts.push(fact(code, year, value, SHEET_VS));
          const change = prior[code] === 0 ? 0 : current[code] / prior[code] - 1;
          facts.push(fact(`${code}_pct_change`, year, round(change, 6), SHEET_VS));
        }
      }

      // The rolling sheet: trailing windows for Total Revenue and Total Tans.
      const random = seeded(`${salon.salonNumber}:${period.id}:rolling`);
      const monthlyRevenue = 3150 * salon.size * 30.4;
      for (const months of [3, 6, 9, 12]) {
        const seasonal = months === 3 ? 0.82 : months === 6 ? 0.9 : months === 9 ? 0.97 : 1;
        const change = salon.trend * (1 - months / 40) * jitter(random, 0.3);
        const revenue = round(monthlyRevenue * months * seasonal * jitter(random, 0.03), 2);
        const tans = Math.round((revenue / 9.1) * jitter(random, 0.03));
        const tanChange = change * 0.7;
        const key = `last_${months}m`;
        facts.push(fact(`total_revenue_${key}_current`, null, revenue, SHEET_ROLLING));
        facts.push(
          fact(`total_revenue_${key}_prior`, null, round(revenue / (1 + change), 2), SHEET_ROLLING),
        );
        facts.push(fact(`total_revenue_${key}_pct_change`, null, round(change, 6), SHEET_ROLLING));
        facts.push(fact(`total_tans_${key}_current`, null, tans, SHEET_ROLLING));
        facts.push(
          fact(`total_tans_${key}_prior`, null, Math.round(tans / (1 + tanChange)), SHEET_ROLLING),
        );
        facts.push(fact(`total_tans_${key}_pct_change`, null, round(tanChange, 6), SHEET_ROLLING));
      }
    }
  }
  return facts;
}

function definitionRow(code: string): DemoRow | null {
  const mapping = KNOWN_METRICS_BY_CODE.get(code);
  if (!mapping) return null;
  return {
    code,
    label: mapping.label,
    family: mapping.family,
    unit: mapping.unit,
    higher_is_better: mapping.higherIsBetter,
    basis_year_required: mapping.basisYearRequired,
    description:
      mapping.kind === "pct_change"
        ? `The source's own signed change in ${mapping.label.replace(/ % Change$/, "")}.`
        : mapping.label,
  };
}

function catalogueRows(facts: readonly DemoRow[]): DemoRow[] {
  const grouped = new Map<string, DemoRow[]>();
  for (const fact of facts) {
    const key = `${fact.period_id}|${fact.source_sheet}|${fact.metric_code}`;
    grouped.set(key, [...(grouped.get(key) ?? []), fact]);
  }
  const rows: DemoRow[] = [];
  for (const [key, group] of grouped) {
    const [periodId, sheet, code] = key.split("|");
    const definition = definitionRow(code);
    const mapping = KNOWN_METRICS_BY_CODE.get(code);
    if (!definition || !mapping) continue;
    const years = [
      ...new Set(
        group.map((fact) => fact.basis_year).filter((year): year is number => year !== null),
      ),
    ].sort((a, b) => a - b);
    rows.push({
      period_id: periodId,
      ...definition,
      comparison_of_code: mapping.comparisonOf,
      available_basis_years: years,
      fact_count: group.length,
      salon_count: new Set(group.map((fact) => fact.salon_number)).size,
      source_sheet: sheet,
    });
  }
  return rows;
}

function scopeRows(): DemoRow[] {
  return COMP_PERIODS.map((period) => ({
    ingestion_id: `ing-${period.id}`,
    period_id: period.id,
    grain: "mtd",
    period_start: period.start,
    period_end: period.end,
    period_label: period.label,
    fiscal_year: CURRENT_YEAR,
    parser_key: "comp_sales_mtd_vs_2024",
    parser_version: 3,
    ingested_at: period.ingestedAt,
    warnings: [],
    warning_count: 0,
    source_sheet_names: [SHEET_VS, SHEET_ROLLING],
    live_salon_count: DEMO_REPORT_SALONS.length,
    live_fact_count: 0,
    live_metric_count: 0,
    file_id: `file-${period.id}`,
    original_filename: `Comp Report ${period.end.replace(/-/g, " ")} (demo).xlsx`,
    file_sha256: "0".repeat(64),
    storage_bucket: "reporting-sources",
    storage_path: `comp_sales/demo/${period.id}.xlsx`,
    size_bytes: 412_884,
    received_at: period.ingestedAt,
    source_code: "comp_report_email",
    source_name: "Comp Report",
    source_kind: "email",
    report_family: "comp_sales",
  }));
}

/** Chain-wide revenue rank, quintile and descriptors, per period. */
function attributeRows(): DemoRow[] {
  const bySize = [...DEMO_REPORT_SALONS].sort((a, b) => b.size - a.size);
  return COMP_PERIODS.flatMap((period) =>
    DEMO_REPORT_SALONS.map((salon) => {
      const random = seeded(`${salon.salonNumber}:attributes`);
      const position = bySize.indexOf(salon);
      // Spread the fifteen through a 249-salon chain, busiest nearest the top.
      const rank = Math.max(1, Math.round(8 + position * 14.5 + random() * 8));
      const quintile = Math.min(5, Math.floor(((rank - 1) / CHAIN_SALON_COUNT) * 5) + 1);
      return {
        period_id: period.id,
        superseded_by_ingestion_id: null,
        district_label: salon.districtLabel,
        region_label: salon.regionLabel,
        company: COMPANY,
        ownership_group: COMPANY,
        dma: salon.dma,
        pricing_plan: null,
        is_comp_salon: true,
        quintile_group: `Q${quintile}`,
        revenue_rank: rank,
        salon_age_years: round(4 + random() * 14, 1),
        avg_client_age: round(27 + random() * 8, 1),
        spa_pieces: 2 + Math.floor(random() * 4),
        salons: { salon_number: salon.salonNumber, store_name: salon.storeName },
      };
    }),
  );
}

function filterOptionRows(attributes: readonly DemoRow[]): DemoRow[] {
  const facets: [string, string][] = [
    ["district", "district_label"],
    ["region", "region_label"],
    ["dma", "dma"],
    ["quintile_group", "quintile_group"],
  ];
  const rows: DemoRow[] = [];
  for (const period of COMP_PERIODS) {
    const inPeriod = attributes.filter((row) => row.period_id === period.id);
    for (const [facet, column] of facets) {
      const counts = new Map<string, number>();
      for (const row of inPeriod) {
        const value = row[column];
        if (typeof value === "string") counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      for (const [value, count] of counts) {
        rows.push({ period_id: period.id, facet, value, salon_count: count });
      }
    }
  }
  return rows;
}

function sourceViewRows(facts: readonly DemoRow[]): DemoRow[] {
  return COMP_PERIODS.flatMap((period) =>
    [SHEET_VS, SHEET_ROLLING].map((sheet) => {
      const sheetFacts = facts.filter(
        (fact) => fact.period_id === period.id && fact.source_sheet === sheet,
      );
      return {
        period_id: period.id,
        grain: "mtd",
        period_end: period.end,
        source_sheet: sheet,
        fact_count: sheetFacts.length,
        salon_count: new Set(sheetFacts.map((fact) => fact.salon_number)).size,
        metric_count: new Set(sheetFacts.map((fact) => fact.metric_code)).size,
        ingested_at: period.ingestedAt,
      };
    }),
  );
}

/* ========================================================== sales totals */

/** Report dates Nov 1..10: each delivered the following morning. */
const SALES_DATES: readonly string[] = Array.from({ length: 10 }, (_, index) =>
  `2026-11-${String(index + 1).padStart(2, "0")}`,
);

function weekdayFactor(iso: string): number {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  // Tanning traffic peaks late week and Saturday, dips Sunday.
  return [0.78, 0.96, 0.98, 1.0, 1.08, 1.14, 1.12][day];
}

interface DailySales {
  grand_total: number;
  ppta: number;
  tans: number;
  efts: number;
  new_customers: number;
  sunless_sessions: number;
}

function dailySales(seed: string, size: number, date: string): DailySales {
  const random = seeded(`${seed}:${date}`);
  const factor = size * weekdayFactor(date);
  const tans = Math.round(355 * factor * jitter(random, 0.1));
  return {
    grand_total: round(3150 * factor * jitter(random, 0.09), 2),
    ppta: round(2.85 * jitter(random, 0.22), 2),
    tans,
    efts: Math.max(1, Math.round(7 * factor * jitter(random, 0.45))),
    new_customers: Math.max(2, Math.round(13 * factor * jitter(random, 0.35))),
    sunless_sessions: Math.max(0, Math.round(15 * factor * jitter(random, 0.4))),
  };
}

function monthToDate(seed: string, size: number, date: string): DailySales {
  const days = SALES_DATES.filter((candidate) => candidate <= date);
  const sum: DailySales = {
    grand_total: 0,
    ppta: 0,
    tans: 0,
    efts: 0,
    new_customers: 0,
    sunless_sessions: 0,
  };
  let pptaWeighted = 0;
  for (const day of days) {
    const figures = dailySales(seed, size, day);
    sum.grand_total += figures.grand_total;
    sum.tans += figures.tans;
    sum.efts += figures.efts;
    sum.new_customers += figures.new_customers;
    sum.sunless_sessions += figures.sunless_sessions;
    pptaWeighted += figures.ppta * figures.tans;
  }
  sum.grand_total = round(sum.grand_total, 2);
  // PPTA is a rate: weighted by tans, never summed.
  sum.ppta = sum.tans === 0 ? 0 : round(pptaWeighted / sum.tans, 2);
  return sum;
}

const SALES_SUMMARIES = [
  { code: "all_salons", label: "All Salons", count: 249, size: 0.97 },
  { code: "stc_consolidated", label: "STC Consolidated", count: 98, size: 1.04 },
  { code: "stc_franchisees", label: "STC Franchisees", count: 151, size: 0.93 },
] as const;

function salesTotalsRows(): { snapshots: DemoRow[]; facts: DemoRow[] } {
  const snapshots: DemoRow[] = [];
  const facts: DemoRow[] = [];

  for (const date of SALES_DATES) {
    const [year, month, day] = date.split("-");
    const raw = `${month}-${day}-${year}`;
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const ingestedAt = `${next.toISOString().slice(0, 10)}T12:${String(10 + Number(day)).padStart(2, "0")}:00Z`;
    snapshots.push({
      report_date: date,
      report_date_raw: raw,
      month_start: "2026-11-01",
      created_at: ingestedAt,
      superseded_by_ingestion_id: null,
    });

    for (const window of ["daily", "mtd"] as const) {
      const base = {
        report_date: date,
        report_date_raw: raw,
        month_start: "2026-11-01",
        report_window: window,
        parser_key: "sales_totals",
        parser_version: 2,
        ingested_at: ingestedAt,
      };
      const subjects = [
        ...SALES_SUMMARIES.map((summary, index) => ({
          kind: "summary" as const,
          code: summary.code,
          label: summary.label,
          order: index + 1,
          salonNumber: null,
          storeName: null,
          salonCount: summary.count,
          seed: summary.code,
          size: summary.size,
        })),
        ...DEMO_REPORT_SALONS.map((salon) => ({
          kind: "salon" as const,
          code: salon.salonNumber,
          label: salon.storeName,
          order: null,
          salonNumber: salon.salonNumber,
          storeName: salon.storeName,
          salonCount: null,
          seed: salon.salonNumber,
          size: salon.size,
        })),
      ];
      for (const subject of subjects) {
        const figures =
          window === "daily"
            ? dailySales(subject.seed, subject.size, date)
            : monthToDate(subject.seed, subject.size, date);
        SALES_TOTALS_MEASURES.forEach((measure, index) => {
          facts.push({
            ...base,
            scope_kind: subject.kind,
            scope_code: subject.code,
            subject_label: subject.label,
            scope_order: subject.order,
            salon_number: subject.salonNumber,
            store_name: subject.storeName,
            metric_code: measure.code,
            metric_label: measure.label,
            metric_unit: measure.unit,
            metric_aggregation: measure.aggregation,
            summary_is_average: measure.summaryIsAverage,
            metric_note: measure.note,
            metric_order: index + 1,
            value: figures[measure.code as keyof DailySales],
            salon_count: subject.salonCount,
          });
        });
      }
    }
  }
  return { snapshots, facts };
}

/* ============================================================ bed usage */

interface DemoBedPeriod {
  readonly id: string;
  readonly grain: "mtd" | "ytd" | "ltm";
  readonly start: string;
  readonly end: string;
  readonly label: string;
  /** Scale against one month of traffic. */
  readonly months: number;
  readonly ingestedAt: string;
}

const BED_PERIODS: readonly DemoBedPeriod[] = [
  {
    id: "demo-bed-2026-10",
    grain: "mtd",
    start: "2026-10-01",
    end: "2026-10-31",
    label: "October 2026",
    months: 1,
    ingestedAt: "2026-11-02T14:05:00Z",
  },
  {
    id: "demo-bed-2026-09",
    grain: "mtd",
    start: "2026-09-01",
    end: "2026-09-30",
    label: "September 2026",
    months: 0.94,
    ingestedAt: "2026-10-01T13:52:00Z",
  },
];

/** Invented bed models per level, with a chain-wide tans-per-bed benchmark. */
const BED_LEVELS_DEMO = [
  { level: "FAST", bedType: "Level 1 Classic 32", qty: [4, 6], perBed: 172, bias: -0.04 },
  { level: "FASTER", bedType: "Level 2 HP Stand-Up", qty: [3, 5], perBed: 205, bias: 0.06 },
  { level: "FASTEST", bedType: "Level 3 Velocity 48", qty: [2, 4], perBed: 228, bias: 0.14 },
  { level: "INSTANT", bedType: "Level 4 Prestige HP", qty: [2, 3], perBed: 246, bias: -0.11 },
  { level: "SUNLESS", bedType: "Sunless Mist Booth", qty: [1, 2], perBed: 118, bias: -0.17 },
  { level: "SPA", bedType: "Spa Hydro Lounge", qty: [1, 3], perBed: 96, bias: 0.21 },
] as const;

function bedUsageRows(): { salons: DemoRow[]; equipment: DemoRow[]; benchmarks: DemoRow[] } {
  const salons: DemoRow[] = [];
  const equipment: DemoRow[] = [];
  const benchmarks: DemoRow[] = [];

  for (const period of BED_PERIODS) {
    for (const level of BED_LEVELS_DEMO) {
      benchmarks.push({
        period_id: period.id,
        superseded_by_ingestion_id: null,
        level: level.level,
        tans_per_bed: round(level.perBed * period.months, 1),
        total_beds: Math.round(((level.qty[0] + level.qty[1]) / 2) * CHAIN_SALON_COUNT),
      });
    }

    for (const salon of DEMO_REPORT_SALONS) {
      const random = seeded(`${salon.salonNumber}:beds`);
      const monthRandom = seeded(`${salon.salonNumber}:${period.id}:beds`);
      let totalTans = 0;
      let bedCount = 0;
      const rows: DemoRow[] = [];
      for (const level of BED_LEVELS_DEMO) {
        const [low, high] = level.qty;
        const qty = low + Math.floor(random() * (high - low + 1)) + (salon.size > 1.1 ? 1 : 0);
        const perBed =
          level.perBed *
          period.months *
          (1 + level.bias) *
          (0.75 + salon.size * 0.25) *
          jitter(monthRandom, 0.18);
        const clientTans = Math.round(perBed * qty);
        const chainPerBed = level.perBed * period.months;
        const actualPerBed = clientTans / qty;
        totalTans += clientTans;
        bedCount += qty;
        rows.push({
          period_id: period.id,
          company: COMPANY,
          salon_number: salon.salonNumber,
          store_name: salon.storeName,
          district_label: salon.districtLabel,
          region_label: salon.regionLabel,
          level: level.level,
          level_advisory_only: false,
          bed_type: level.bedType,
          qty,
          client_tans: clientTans,
          per_bed: round(actualPerBed, 1),
          v_chain_percent: round((actualPerBed / chainPerBed - 1) * 100, 1),
          v_bed_type_percent: round(
            (actualPerBed / (chainPerBed * jitter(monthRandom, 0.06)) - 1) * 100,
            1,
          ),
          chain_tans_per_bed: round(chainPerBed, 1),
        });
      }
      equipment.push(...rows);
      salons.push({
        period_id: period.id,
        company: COMPANY,
        grain: period.grain,
        period_start: period.start,
        period_end: period.end,
        period_label: period.label,
        source_period_label: `${period.start} - ${period.end}`,
        source_salon_count: CHAIN_SALON_COUNT,
        salon_number: salon.salonNumber,
        store_name: salon.storeName,
        district_label: salon.districtLabel,
        region_label: salon.regionLabel,
        total_tans: totalTans,
        bed_count: bedCount,
        ingested_at: period.ingestedAt,
        parser_key: "bed_usage",
        parser_version: 2,
        original_filename: `Bed Usage ${period.label} (demo).xlsx`,
      });
    }
  }
  return { salons, equipment, benchmarks };
}

/* ========================================================= spa wellness */

const SPA_EQUIPMENT = [
  { header: "SPA Hydromassage", base: 360, share: 1, bias: -0.03 },
  { header: "SPA Massage Chair", base: 170, share: 0.8, bias: 0.16 },
  { header: "SPA Poly RLT", base: 210, share: 0.6, bias: -0.08 },
  { header: "SPA Body Wrap Pod", base: 95, share: 0.35, bias: 0.09 },
  { header: "Other", base: 30, share: 0.3, bias: 0 },
] as const;

const SPA_PERIODS: readonly DemoBedPeriod[] = [
  { ...BED_PERIODS[0], id: "demo-spa-2026-10-mtd" },
  {
    id: "demo-spa-2026-10-ytd",
    grain: "ytd",
    start: "2026-01-01",
    end: "2026-10-31",
    label: "Year to Date",
    months: 9.6,
    ingestedAt: BED_PERIODS[0].ingestedAt,
  },
  {
    id: "demo-spa-2026-10-ltm",
    grain: "ltm",
    start: "2025-11-01",
    end: "2026-10-31",
    label: "Last Twelve Months",
    months: 11.4,
    ingestedAt: BED_PERIODS[0].ingestedAt,
  },
  { ...BED_PERIODS[1], id: "demo-spa-2026-09-mtd" },
];

function spaWellnessRows(): { salons: DemoRow[]; equipment: DemoRow[] } {
  const salons: DemoRow[] = [];
  const equipment: DemoRow[] = [];

  for (const period of SPA_PERIODS) {
    const sheet = period.grain.toUpperCase();
    // Installation is a property of the salon, not of the period.
    const installed = new Map<string, (typeof SPA_EQUIPMENT)[number][]>();
    for (const salon of DEMO_REPORT_SALONS) {
      const random = seeded(`${salon.salonNumber}:spa-installed`);
      installed.set(
        salon.salonNumber,
        SPA_EQUIPMENT.filter((item, index) => index === 0 || random() < item.share),
      );
    }

    const notInstalled = DEMO_REPORT_SALONS.reduce(
      (total, salon) => total + SPA_EQUIPMENT.length - (installed.get(salon.salonNumber)?.length ?? 0),
      0,
    );

    for (const salon of DEMO_REPORT_SALONS) {
      const random = seeded(`${salon.salonNumber}:${period.id}:spa`);
      const items = installed.get(salon.salonNumber) ?? [];
      let total = 0;
      const firstUse: string[] = [];
      SPA_EQUIPMENT.forEach((item, index) => {
        if (!items.includes(item)) return;
        const code = spaEquipmentCode(item.header);
        const sessions = Math.round(
          item.base * (1 + item.bias) * period.months * (0.7 + salon.size * 0.3) * jitter(random, 0.28),
        );
        total += sessions;
        const installedOn = `20${21 + Math.floor(random() * 5)}-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}`;
        firstUse.push(installedOn);
        equipment.push({
          period_id: period.id,
          company: COMPANY,
          salon_number: salon.salonNumber,
          store_name: salon.storeName,
          equipment_code: code,
          equipment_label: item.header,
          equipment_short_label: spaEquipmentShortLabel(item.header),
          is_comparable: item.header.toLowerCase() !== SPA_WELLNESS_OTHER_HEADER,
          display_order: index + 1,
          sessions,
          first_use_date: installedOn,
          last_use_date: period.end,
          chain_salon_count: Math.round(CHAIN_SALON_COUNT * item.share * 0.9),
          chain_average_sessions: round(item.base * period.months * 0.94, 1),
          peer_salon_count: 18,
          peer_average_sessions: round(item.base * period.months * 1.02, 1),
        });
      });
      firstUse.sort();
      salons.push({
        period_id: period.id,
        company: COMPANY,
        grain: period.grain,
        period_start: period.start,
        period_end: period.end,
        period_label: period.label,
        source_period_label: `${period.start} - ${period.end}`,
        window_code: period.grain,
        source_sheet: sheet,
        source_salon_count: CHAIN_SALON_COUNT,
        not_installed_cell_count: notInstalled,
        salon_number: salon.salonNumber,
        store_name: salon.storeName,
        district_label: salon.districtLabel,
        region_label: salon.regionLabel,
        total_sessions: total,
        equipment_pieces: items.length + (salon.size > 1.1 ? 1 : 0),
        equipment_types_used: items.length,
        first_use_date: firstUse[0] ?? null,
        newest_first_use_date: firstUse[firstUse.length - 1] ?? null,
        ingested_at: period.ingestedAt,
        parser_key: "spa_wellness",
        parser_version: 2,
        original_filename: `SPA Wellness Tracking ${BED_PERIODS[0].label} (demo).xlsx`,
      });
    }
  }
  return { salons, equipment };
}

/* ======================================================= spa engagement */

const ENGAGEMENT_PERIODS: readonly DemoBedPeriod[] = [
  { ...BED_PERIODS[0], id: "demo-eng-2026-10-31" },
  {
    id: "demo-eng-2026-10-15",
    grain: "mtd",
    start: "2026-10-01",
    end: "2026-10-15",
    label: "October 2026",
    months: 0.49,
    ingestedAt: "2026-10-16T13:20:00Z",
  },
];

const RANK_WEIGHTS: Record<string, number> = {
  rank_spa_sessions_per_bed: 0.25,
  rank_spa_sessions_per_unique_per_bed: 0.25,
  rank_unique_spa_tanner_pct: 0.5,
};

/** A chain-wide rank for a value, given the chain's typical value and spread. */
function chainRank(value: number, typical: number, spread: number, population: number): number {
  const z = (value - typical) / spread;
  const better = 1 / (1 + Math.exp(-1.7 * z));
  return Math.min(population, Math.max(1, Math.round((1 - better) * (population - 1)) + 1));
}

function spaEngagementRows(): DemoRow[] {
  const population = CHAIN_SALON_COUNT - 1;
  const rows: DemoRow[] = [];
  for (const period of ENGAGEMENT_PERIODS) {
    const scored: { row: DemoRow; score: number }[] = [];
    for (const salon of DEMO_REPORT_SALONS) {
      const random = seeded(`${salon.salonNumber}:${period.id}:engagement`);
      const fixed = seeded(`${salon.salonNumber}:spa-beds`);
      const spaBeds = 2 + Math.floor(fixed() * 3) + (salon.size > 1.1 ? 1 : 0);
      const totalUnique = Math.round(1850 * salon.size * period.months * jitter(random, 0.06));
      const reach = 0.17 * jitter(random, 0.32);
      const uniqueSpa = Math.round(totalUnique * reach);
      const spaSessions = Math.round(uniqueSpa * 1.9 * jitter(random, 0.15));

      const perBed = spaSessions / spaBeds;
      const perUniquePerBed = spaSessions / totalUnique / spaBeds;
      const ranks = {
        rank_spa_sessions_per_bed: chainRank(perBed, 150 * period.months, 45 * period.months, population),
        rank_spa_sessions_per_unique_per_bed: chainRank(perUniquePerBed, 0.085, 0.03, population),
        rank_unique_spa_tanner_pct: chainRank(reach, 0.16, 0.04, population),
      };
      const score = Object.entries(ranks).reduce(
        (total, [code, rank]) => total + (RANK_WEIGHTS[code] ?? 0) * rank,
        0,
      );
      scored.push({
        score,
        row: {
          period_id: period.id,
          company: COMPANY,
          grain: period.grain,
          period_start: period.start,
          period_end: period.end,
          period_label: period.label,
          source_period_label: `${period.start} - ${period.end}`,
          rank_population: population,
          rank_weights: RANK_WEIGHTS,
          source_salon_count: population,
          salon_number: salon.salonNumber,
          store_name: salon.storeName,
          district_label: salon.districtLabel,
          region_label: salon.regionLabel,
          ownership: COMPANY,
          spa_sessions: spaSessions,
          total_unique_tanners: totalUnique,
          unique_spa_tanners: uniqueSpa,
          spa_beds: spaBeds,
          reported_ranks: ranks,
          reported_overall_rank: null,
          ingested_at: period.ingestedAt,
          parser_key: "spa_engagement",
          parser_version: 2,
          original_filename: `Spa Engagement ${period.end} (demo).xlsx`,
        },
      });
    }
    // Overall rank: the weighted score placed in the chain, lower is better.
    for (const entry of scored) {
      entry.row.reported_overall_rank = chainRank(-entry.score, -124, 55, population);
      rows.push(entry.row);
    }
  }
  return rows;
}

/* ================================================================ tables */

let cached: Readonly<Record<string, readonly DemoRow[]>> | null = null;

/**
 * Every reporting table and view the read layer queries, by name.
 *
 * Built once per process. Rank metrics are referenced so a renamed rank code
 * fails the type check here rather than silently dropping a column.
 */
export function demoReportingTables(): Readonly<Record<string, readonly DemoRow[]>> {
  if (cached) return cached;
  void SPA_ENGAGEMENT_RANK_METRICS;

  const facts = compFacts();
  const catalogue = catalogueRows(facts);
  const scope = scopeRows().map((row) => {
    const periodFacts = facts.filter((fact) => fact.period_id === row.period_id);
    return {
      ...row,
      live_fact_count: periodFacts.length,
      live_metric_count: new Set(periodFacts.map((fact) => fact.metric_code)).size,
    };
  });
  const attributes = attributeRows();
  const definitions = [...KNOWN_METRICS_BY_CODE.keys()]
    .map(definitionRow)
    .filter((row): row is DemoRow => row !== null);
  const sales = salesTotalsRows();
  const beds = bedUsageRows();
  const spa = spaWellnessRows();

  cached = {
    comp_sales_report_scope: scope,
    comp_sales_source_views: sourceViewRows(facts),
    comp_sales_filter_options: filterOptionRows(attributes),
    comp_sales_metric_catalogue: catalogue,
    comp_sales_current_facts: facts,
    report_metrics: definitions,
    salon_period_attributes: attributes,
    sales_totals_snapshots: sales.snapshots,
    sales_totals_current_facts: sales.facts,
    bed_usage_current_salon_facts: beds.salons,
    bed_usage_current_equipment_facts: beds.equipment,
    bed_usage_chain_benchmarks: beds.benchmarks,
    spa_wellness_current_salon_facts: spa.salons,
    spa_wellness_current_equipment_facts: spa.equipment,
    spa_engagement_current_salon_facts: spaEngagementRows(),
  };
  return cached;
}
