import "server-only";

import { AUTHORIZED_COMPANY } from "../store-identity";
import {
  listBedUsagePeriods,
  listSpaEngagementPeriods,
  listSpaWellnessPeriods,
} from "./bed-spa/read";
import type { BedSpaPeriodOption } from "./bed-spa/period-token";
import type { ResolvablePeriod } from "./period-language";
import { ReportingReadRepository } from "./reporting-read-repository";
import { listSalesTotalsDates } from "./sales-totals-read";
import {
  REPORT_FAMILIES,
  REPORT_FAMILY_REASONING_ORDER,
  type ReportFamily,
  type ReportFamilyId,
  type ReportPeriodTypeId,
} from "./report-families";

/**
 * ============================================================================
 * WHAT THIS DEPLOYMENT ACTUALLY HOLDS, PER REPORT FAMILY
 * ============================================================================
 *
 * `report-families.ts` says what each family CAN do — its windows, its
 * measures, its dimensions, what decides its numbers. All of that is static and
 * client-safe. This module answers the other half, which only a database can:
 * what has actually arrived, when, and how much of it.
 *
 * ONE CATALOG, NOT A SECOND REGISTRY. The families come from the existing
 * registry and the periods come from each family's OWN listing function — the
 * same ones the dashboards call. Nothing here re-implements a period query, and
 * nothing here holds a list of families that could drift from the registry's.
 *
 * WHAT IT IS FOR, concretely:
 *
 *   RESOLVING "LAST MONTH". `resolvePeriod` needs every period a family holds,
 *   not just the newest, and before this there was no one place that could hand
 *   it that for an arbitrary family.
 *
 *   FRESHNESS. A briefing has to be able to say "the newest Sales Totals is
 *   through the 3rd" when a manager asks about today. That needs the as-of date
 *   AND the ingestion timestamp, per family, in one read.
 *
 *   THE EXTENSION SEAM. A sixth family becomes a registry entry plus a
 *   `PeriodSource` here. Nothing in the routing, the briefing composer or the
 *   chat orchestration is edited — `report-catalog.extension.test.ts` proves
 *   that by registering one.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 * IT NEVER THROWS. A family whose listing fails reports zero periods, exactly
 * as a family with nothing ingested does, and the caller says "no current
 * delivery" either way. A reporting outage must not take down an answer.
 *
 * IT TAKES NO COMPANY FROM A REQUEST. `AUTHORIZED_COMPANY` by construction, the
 * same posture as every read below it.
 *
 * IT READS PERIOD METADATA ONLY — ids, dates, labels, timestamps, counts. Not
 * one figure. The figures are loaded by the family's own analytics loader when
 * a briefing actually needs them, which is what keeps the catalog cheap enough
 * to build on any turn that mentions a period.
 */

/** One period a family holds, plus when it was loaded. */
export interface CatalogPeriod extends ResolvablePeriod {
  /** ISO instant the delivery was ingested. Null when not recorded. */
  readonly ingestedAt: string | null;
  /** Salons the period covers, counted from live facts. Null when not counted. */
  readonly salonCount: number | null;
}

/** A family, its capability, and what has arrived for it. */
export interface ReportFamilyStatus {
  readonly family: ReportFamily;
  /** Newest first. Empty when nothing is ingested or the read failed. */
  readonly periods: readonly CatalogPeriod[];
  /** The newest period, or null. What "latest" means for this family. */
  readonly latest: CatalogPeriod | null;
  /** Window types actually PRESENT, which can be narrower than `periodTypes`. */
  readonly deliveredTypes: readonly ReportPeriodTypeId[];
  /** The newest ingestion timestamp across every period. */
  readonly lastIngestedAt: string | null;
  /** The company every figure in this family is scoped to. */
  readonly company: string;
}

export interface ReportCatalog {
  readonly company: string;
  readonly families: readonly ReportFamilyStatus[];
  /** By id, for a caller that knows which family it wants. */
  readonly byFamily: Readonly<Record<ReportFamilyId, ReportFamilyStatus>>;
}

/**
 * How one family's periods are read.
 *
 * THE EXTENSION SEAM, and it is one function per family rather than a
 * conditional in a loop for that reason: adding a family means adding an entry
 * here beside its registry entry, and TypeScript's `Record` over
 * `ReportFamilyId` makes a missing one a compile error rather than a family
 * that silently reports nothing.
 */
export type PeriodSource = (company: string) => Promise<CatalogPeriod[]>;

/** Bed and spa periods already carry everything the catalog needs. */
function fromBedSpa(options: readonly BedSpaPeriodOption[]): CatalogPeriod[] {
  return options.map((option) => ({
    id: option.periodId,
    // The three grains these reports deliver are exactly the catalog's types.
    type: option.grain as ReportPeriodTypeId,
    start: option.periodStart,
    end: option.periodEnd,
    label: option.label,
    ingestedAt: option.ingestedAt,
    salonCount: option.salonCount,
  }));
}

export const PERIOD_SOURCES: Readonly<Record<ReportFamilyId, PeriodSource>> = {
  /**
   * ONE DELIVERY BECOMES TWO PERIODS, and that is not padding.
   *
   * Each Sales Totals email carries the previous day AND month to date through
   * that day. They are different windows over different spans, so a resolver
   * that saw one row per delivery could not answer "month to date" at all — and
   * `resolvePeriod` decides `previous` differently for a daily window than for
   * a monthly one, which it can only do if the window is on the row.
   */
  "sales-totals": async () => {
    const dates = await listSalesTotalsDates();
    return dates.flatMap((date) => [
      {
        id: `${date.reportDate}:daily`,
        type: "daily" as const,
        start: date.reportDate,
        end: date.reportDate,
        label: date.label,
        ingestedAt: date.ingestedAt,
        salonCount: null,
      },
      {
        id: `${date.reportDate}:mtd`,
        type: "mtd" as const,
        start: date.monthStart,
        end: date.reportDate,
        label: `${date.label} month to date`,
        ingestedAt: date.ingestedAt,
        salonCount: null,
      },
    ]);
  },

  "salon-performance": async () => {
    const repository = new ReportingReadRepository();
    const periods = await repository.listPeriods();
    return periods.map((period) => ({
      id: period.periodId,
      type: period.grain as ReportPeriodTypeId,
      /*
       * `listPeriods` does not select `period_start`, and the catalog does not
       * need it: every selector reads `end`. Derived rather than left blank so
       * the shape is honest about being a range — the first of the month for a
       * month-to-date period, the first of the year for a year-to-date one.
       */
      start: startOfWindow(period.grain, period.periodEnd),
      end: period.periodEnd,
      label: period.periodLabel,
      ingestedAt: null,
      salonCount: period.salonCount,
    }));
  },

  "bed-usage": async (company) => fromBedSpa(await listBedUsagePeriods(company)),
  "spa-wellness": async (company) => fromBedSpa(await listSpaWellnessPeriods(company)),
  "spa-engagement": async (company) => fromBedSpa(await listSpaEngagementPeriods(company)),
};

/** The first day of the window a period end belongs to. */
function startOfWindow(grain: string, end: string): string {
  const [year, month] = end.split("-");
  if (grain === "ytd") return `${year}-01-01`;
  if (grain === "ltm") {
    return `${Number(year) - 1}-${month}-${end.slice(8)}`;
  }
  return `${year}-${month}-01`;
}

/** The newest non-null ingestion timestamp, or null. */
function newestIngestedAt(periods: readonly CatalogPeriod[]): string | null {
  let newest: string | null = null;
  for (const period of periods) {
    if (!period.ingestedAt) continue;
    if (newest === null || period.ingestedAt > newest) newest = period.ingestedAt;
  }
  return newest;
}

/**
 * What every family holds, read in parallel.
 *
 * `families` narrows the read to the ones a turn actually needs, because five
 * families is five independent round trips and a question about Spa should not
 * pay for the Comp Report's period list. Omitted means all five, which is what
 * an operator health check wants.
 */
export async function loadReportCatalog(
  options: {
    readonly families?: readonly ReportFamilyId[];
    readonly company?: string;
  } = {},
): Promise<ReportCatalog> {
  const company = options.company ?? AUTHORIZED_COMPANY;
  const wanted = new Set(options.families ?? REPORT_FAMILY_REASONING_ORDER);

  const statuses = await Promise.all(
    REPORT_FAMILIES.map(async (family): Promise<ReportFamilyStatus> => {
      if (!wanted.has(family.id)) return empty(family, company);
      try {
        const periods = await PERIOD_SOURCES[family.id](company);
        const ordered = [...periods].sort(
          (left, right) =>
            right.end.localeCompare(left.end) ||
            family.periodTypes.indexOf(left.type) - family.periodTypes.indexOf(right.type),
        );
        return {
          family,
          periods: ordered,
          latest: ordered[0] ?? null,
          deliveredTypes: family.periodTypes.filter((type) =>
            ordered.some((period) => period.type === type),
          ),
          lastIngestedAt: newestIngestedAt(ordered),
          company,
        };
      } catch {
        /*
         * Deliberately silent and deliberately not rethrown. A family whose
         * listing failed is indistinguishable to the caller from one with
         * nothing ingested, and both produce the same honest sentence: there is
         * no current delivery. The read layer logs its own failures.
         */
        return empty(family, company);
      }
    }),
  );

  return {
    company,
    families: statuses,
    byFamily: Object.fromEntries(
      statuses.map((status) => [status.family.id, status]),
    ) as Record<ReportFamilyId, ReportFamilyStatus>,
  };
}

function empty(family: ReportFamily, company: string): ReportFamilyStatus {
  return {
    family,
    periods: [],
    latest: null,
    deliveredTypes: [],
    lastIngestedAt: null,
    company,
  };
}
