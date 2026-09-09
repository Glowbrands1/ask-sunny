import "server-only";

import { cache } from "react";

import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import { formatMetricValue } from "./aggregation";
import { buildKpiCards } from "./dashboard";
import { loadReportContext } from "./report-context";
import { aggregateMeasure } from "./sales-totals-aggregate";
import { listSalesTotalsDates, loadSalesTotals } from "./sales-totals-read";
import { SALES_TOTALS_MEASURES_BY_CODE } from "../sales-totals/metric-map";
import type { ReportMetricUnit, ReportPeriodGrain } from "../types";
import { windowMetricCodeList } from "./windows";

/**
 * ============================================================================
 * THE HOMEPAGE'S READ-ONLY PROJECTION OF REPORTS & ANALYTICS
 * ============================================================================
 *
 * The homepage shows a handful of headline figures. This module is the ONLY
 * thing standing between it and the reports, and it is deliberately thin:
 * every figure below is produced by the same function the corresponding report
 * page calls, over the same tables, with the same arithmetic.
 *
 *   Salon Performance -> `loadReportContext` + `buildKpiCards`
 *   Sales Totals      -> `loadSalesTotals` + `aggregateMeasure`
 *
 * NOTHING HERE COMPUTES A METRIC. There is no second definition of Total
 * Revenue, no homepage-only table, no cached copy of a report fact, and no new
 * ingestion path. If a report's arithmetic changes, this changes with it,
 * because it does not have its own.
 *
 * THE PERIOD TRAVELS WITH EVERY FIGURE, and that is the rule this module exists
 * to enforce. The five report families arrive on their own schedules and cover
 * different spans: Salon Performance is year-to-date, Sales Totals is the
 * previous day. A homepage card headed "Yesterday" over a year-to-date total is
 * wrong by a factor of eight, so each KPI carries its own period label and the
 * card never states one period for the row.
 *
 * ADDING A REPORT FAMILY is one entry in `OVERVIEW_FAMILIES`. Bed Usage, Spa
 * Wellness and Spa Engagement are built and not yet on this branch; when they
 * land, each contributes a builder here and its KPI appears, with its own
 * period, without touching the card.
 */

/** One headline figure, fully resolved and formatted for display. */
export interface OverviewKpi {
  /** Stable key for React, and for a test to name a tile. */
  readonly key: string;
  readonly label: string;
  /** Formatted, or null when the report did not carry it. Never `0`. */
  readonly value: string | null;
  /**
   * The period this one figure covers, in the reader's language.
   *
   * Per KPI rather than per card, because the families do not share a period.
   */
  readonly periodLabel: string;
  /** How many salons the figure covers. Shown so no tile reads chain-wide. */
  readonly salonCount: number;
  /** Set when `value` is null, saying why rather than showing a zero. */
  readonly unavailableReason: string | null;
}

/** Where a group of KPIs came from, for the freshness line. */
export interface OverviewSource {
  readonly key: string;
  readonly label: string;
  readonly periodLabel: string;
  /** ISO instant the delivery was ingested. Null when not recorded. */
  readonly ingestedAt: string | null;
}

export type ReportingOverview =
  | {
      readonly status: "ready";
      readonly kpis: readonly OverviewKpi[];
      readonly sources: readonly OverviewSource[];
      /** e.g. `Updated Sep 8, 2026`. Null when nothing recorded an ingest. */
      readonly updatedLabel: string | null;
    }
  /** Nothing has been ingested, or this runtime cannot reach the reports. */
  | { readonly status: "no_data"; readonly reason: string }
  /** A query failed. The card says so; it never renders zeros instead. */
  | { readonly status: "error"; readonly message: string };

/**
 * What one report family contributes to the overview.
 *
 * A builder returns null when its report has not been ingested — a family with
 * no data is absent from the row, not a column of dashes.
 */
interface OverviewFamily {
  readonly key: string;
  readonly label: string;
  build(): Promise<{ kpis: OverviewKpi[]; source: OverviewSource } | null>;
}

/* ------------------------------------------------------------ period text -- */

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The Comp Report's period, in a homepage reader's language.
 *
 * Built from the period's OWN grain and end date — `ytd` + `2026-08-31` reads
 * `YTD Aug 2026` — rather than from the workbook's raw label, which is written
 * for an analyst (`YTD 08 2026`, `MTD 08/31/2026`). Nothing is inferred: both
 * inputs are stored metadata, and a date that will not parse falls back to the
 * raw label rather than to a guess.
 */
export function formatCompPeriodLabel(
  grain: ReportPeriodGrain,
  periodEnd: string,
  rawLabel: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!match) return rawLabel;
  const month = MONTH_SHORT[Number(match[2]) - 1];
  if (!month) return rawLabel;
  const prefix = grain.toUpperCase();
  return grain === "ytd"
    ? `${prefix} ${month} ${match[1]}`
    : `${prefix} ${month} ${Number(match[3])}, ${match[1]}`;
}

/**
 * A tile-sized figure.
 *
 * Currency is COMPACT because year-to-date revenue across the estate runs to
 * seven figures and `$7,487,004.01` does not fit a tile — `$7.5M` is what a
 * reader wants from a snapshot anyway. Counts are NOT compact: `43,115` fits
 * comfortably and `43K` throws away precision for nothing.
 */
function formatOverviewValue(value: number, unit: ReportMetricUnit): string {
  return formatMetricValue(value, unit, { compact: unit === "currency" });
}

/** `2026-09-08T13:04:14Z` -> `Sep 8, 2026`. No clock time on the homepage. */
export function formatUpdatedLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `2026-09-07` -> `Mon, Sep 7`. The report date, not when it was loaded. */
function formatShortReportDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** `2026-09-01` -> `MTD Sep 2026`, from the report's own month anchor. */
export function formatSalesTotalsPeriodLabel(monthStart: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(monthStart);
  if (!match) return "Month to date";
  const month = MONTH_SHORT[Number(match[2]) - 1];
  return month ? `MTD ${month} ${match[1]}` : "Month to date";
}

/* -------------------------------------------------- salon performance ------ */

/**
 * The two Comp Report measures the homepage carries.
 *
 * Both are in `HEADLINE_METRIC_CODES`, so they are figures the report itself
 * already leads with — the homepage promotes two of the report's four rather
 * than choosing measures of its own. Revenue is the money signal; unique
 * tanners is the traffic signal, and it is the honest version of the old
 * "Guests served" tile: it is a real reported count, where "guests served" was
 * seeded.
 */
const COMP_OVERVIEW_CODES = ["total_revenue", "unique_tanners"] as const;

const salonPerformance: OverviewFamily = {
  key: "salon-performance",
  label: "Salon Performance",

  async build() {
    /*
     * The report page's own resolution, with no filters — which is exactly the
     * canonical All Salons view the homepage wants. Period, comparison window,
     * source sheet and measure catalogue all resolve identically to the report,
     * so a figure here cannot disagree with the figure a click away.
     */
    const loaded = await loadReportContext({});
    if (loaded.status !== "ready") return null;

    const {
      repository,
      scope,
      filters,
      activeWindow,
      activeSheet,
      sheetCatalogue,
      measures,
      measureCodes,
      /*
       * WHICH YEAR IS "CURRENT", RESOLVED FROM THIS PERIOD'S OWN DATA.
       *
       * Read off the context rather than from a constant, for the reason
       * `report-context.ts` states: a hardcoded year starts selecting the wrong
       * basis on the first of January and renders blanks instead of failing.
       * Taking it from the same resolution the report pages use is also what
       * stops this card and the report disagreeing about which year they are
       * showing.
       */
      currentYear,
    } = loaded.context;

    // A measure the selected sheet does not carry is dropped, never faked.
    const codes = COMP_OVERVIEW_CODES.filter((code) => measureCodes.includes(code));
    if (codes.length === 0) return null;

    const salons = await repository.listSalons(scope.periodId, filters);

    const facts = await repository.getFactRows({
      periodId: scope.periodId,
      metricCodes: [
        ...new Set(
          codes.flatMap((code) =>
            windowMetricCodeList(code, activeWindow, currentYear),
          ),
        ),
      ],
      salonNumbers: salons.map((salon) => salon.salonNumber),
      sourceSheet: activeSheet,
    });

    // The report's own KPI builder. No arithmetic is repeated here.
    const cards = buildKpiCards({
      metricCodes: [...codes],
      catalogue: [...sheetCatalogue, ...measures],
      facts,
      window: activeWindow,
      currentYear,
    });

    const periodLabel = formatCompPeriodLabel(
      scope.grain,
      scope.periodEnd,
      scope.periodLabel,
    );

    return {
      source: {
        key: salonPerformance.key,
        label: salonPerformance.label,
        periodLabel,
        ingestedAt: scope.ingestedAt,
      },
      kpis: cards.map((card) => ({
        key: `comp:${card.metricCode}`,
        label: card.label,
        value:
          card.current.value === null
            ? null
            : formatOverviewValue(card.current.value, card.unit),
        periodLabel,
        salonCount: card.current.salonCount,
        unavailableReason:
          card.current.value === null
            ? (card.current.unavailableReason ??
              "The report did not carry this measure for this period.")
            : null,
      })),
    };
  },
};

/* ------------------------------------------------------- sales totals ------ */

/**
 * The two Sales Totals measures the homepage carries, and why these two.
 *
 * Both are summable across salons, which matters: this report's SUMMARY block
 * holds per-salon AVERAGES over 249 salons while its salon rows are this
 * recipient's 15, and the two populations must never share a row of tiles. The
 * homepage reads the salon rows and sums them, through the report's own
 * `aggregateMeasure`, so both tiles describe the same salons.
 *
 * PPTA IS DELIBERATELY ABSENT even though it is the real "average ticket".
 * `aggregateMeasure` refuses to combine it — money per transaction needs
 * transaction counts as weights and the report does not publish them — and the
 * only PPTA that exists is the estate figure over a different population. A
 * tile mixing those two populations is exactly the error this report's read
 * layer was written to prevent.
 *
 * MONTH TO DATE, NOT THE PREVIOUS DAY, and this one is worth explaining because
 * the previous-day window is the more obvious choice for a homepage.
 *
 * A single day is the most fragile figure this source publishes. The Sep 7 2026
 * delivery reports ZERO for every salon and every measure in its previous-day
 * column while its month-to-date column is intact — 91 zero-valued daily facts
 * against 7 to 14 on neighbouring dates. That is a condition of the source
 * delivery, not of this read: the Sales Totals report shows the same zeros for
 * that date and window, and nothing here modifies ingestion or the report.
 *
 * But it makes "Total sales $0" a plausible homepage headline on any given
 * morning, and a reader has no way to tell that from a catastrophic trading
 * day. Month to date is cumulative in the source, is populated on every
 * delivery seen so far, and matches what this card is actually for — the latest
 * reporting snapshot, not a daily operations screen. It is labelled as month to
 * date wherever it appears, so nothing here is presented as a daily figure.
 */
const SALES_TOTALS_OVERVIEW = [
  { code: "grand_total", label: "Total sales" },
  { code: "efts", label: "EFTs" },
] as const;

const salesTotals: OverviewFamily = {
  key: "sales-totals",
  label: "Sales Totals",

  async build() {
    const dates = await listSalesTotalsDates();
    if (dates.length === 0) return null;

    // Newest by the date the report COVERS. `listSalesTotalsDates` already
    // orders that way, so a backfilled older report never becomes "latest".
    const latest = dates[0];

    const snapshot = await loadSalesTotals({
      reportDate: latest.reportDate,
      window: "mtd",
    });
    if (!snapshot) return null;

    const periodLabel = formatSalesTotalsPeriodLabel(snapshot.monthStart);

    return {
      source: {
        key: salesTotals.key,
        label: salesTotals.label,
        // The tiles say which month; the secondary line says how far into it.
        periodLabel: `${periodLabel}, through ${formatShortReportDate(snapshot.reportDate)}`,
        ingestedAt: snapshot.lineage.ingestedAt ?? latest.ingestedAt,
      },
      kpis: SALES_TOTALS_OVERVIEW.map((entry) => {
        const figure = aggregateMeasure(snapshot.salons, entry.code);
        const measure = SALES_TOTALS_MEASURES_BY_CODE[entry.code];
        return {
          key: `sales-totals:${entry.code}`,
          label: entry.label,
          value:
            figure.value === null
              ? null
              : formatOverviewValue(figure.value, measure.unit),
          periodLabel,
          salonCount: figure.reportingSalons,
          unavailableReason:
            figure.value === null
              ? (figure.reason ?? "No salon in this delivery reported this measure.")
              : null,
        };
      }),
    };
  },
};

/**
 * THE FAMILIES THE OVERVIEW READS, IN THE ORDER THEIR KPIs APPEAR.
 *
 * Two today. Bed Usage, Spa Wellness and Spa Engagement each add one entry here
 * once their read layer is on this branch — the card, the states and the tests
 * below need no change to accommodate them.
 */
const OVERVIEW_FAMILIES: readonly OverviewFamily[] = [salonPerformance, salesTotals];

/**
 * The homepage's whole data dependency, in one call.
 *
 * FAILURE IS PER FAMILY. One report's query failing must not blank the others,
 * and it must never contribute a zero — the family is simply absent, and if
 * every family is absent the caller is told whether that is "nothing ingested"
 * or "the queries failed". Those are different sentences to a reader and only
 * one of them is a fault.
 */
/**
 * READ ONCE PER REQUEST, RENDERED IN TWO PLACES.
 *
 * The homepage shows these figures twice: as the Performance panel, and as the
 * collapsed strip that stays on screen while an inline answer is open. They are
 * two presentations of ONE snapshot, and two calls would be two reads that could
 * return different numbers if a delivery landed between them — the strip and the
 * panel disagreeing about revenue on the same screen.
 *
 * `cache` de-duplicates within a single server render pass, which is exactly the
 * scope wanted: nothing is held between requests, so `force-dynamic` still means
 * every navigation re-reads.
 */
export const loadReportingOverview = cache(async function loadReportingOverview(): Promise<ReportingOverview> {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return {
      status: "no_data",
      reason:
        "This runtime is not configured to read reporting data, so no figures can be shown here.",
    };
  }

  const settled = await Promise.allSettled(
    OVERVIEW_FAMILIES.map((family) => family.build()),
  );

  const kpis: OverviewKpi[] = [];
  const sources: OverviewSource[] = [];
  const failures: string[] = [];

  settled.forEach((result, index) => {
    const family = OVERVIEW_FAMILIES[index];
    if (result.status === "rejected") {
      failures.push(family.label);
      return;
    }
    if (result.value === null) return;
    kpis.push(...result.value.kpis);
    sources.push(result.value.source);
  });

  if (kpis.length === 0) {
    return failures.length > 0
      ? {
          status: "error",
          message: `Reporting data could not be read (${failures.join(", ")}).`,
        }
      : { status: "no_data", reason: "No report has been ingested yet." };
  }

  /*
   * The freshest ingest across the families that answered. A single date, not a
   * per-family list: the homepage is saying "how current is any of this", and
   * the per-KPI period labels already say what each figure covers.
   */
  const stamps = sources
    .map((source) => source.ingestedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  return {
    status: "ready",
    kpis,
    sources,
    updatedLabel:
      stamps.length > 0 ? formatUpdatedLabel(new Date(Math.max(...stamps)).toISOString()) : null,
  };
});
