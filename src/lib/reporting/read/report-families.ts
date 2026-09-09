/**
 * ============================================================================
 * THE FIVE REPORT FAMILIES, NAMED ONCE
 * ============================================================================
 *
 * Five reports are ingested, five dashboards render them, and Chat now has to
 * reason across all five. Before this module there was no shared name for any
 * of them: the routes called one `sales-totals`, the parser called it
 * `sales_totals`, the analysis layer called it `"Sales Totals"`, and the
 * bed/spa briefing did not name families at all — it just happened to build
 * three sections. A sixth spelling was about to be invented for the chat
 * context, and the failure mode of that is silent: a tab hands Chat a family
 * nothing recognises, the briefing loads nothing, and Sunny answers the
 * question from the knowledge base while telling nobody a report was missed.
 *
 * So the report-route keys win, because they are the ones already in URLs a
 * manager can bookmark, and everything else is derived from this list.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ============================================================================
 *
 * NO SIXTH FAMILY. The mapping from source workbook to dashboard is fixed by
 * the operator and is exactly five entries. Bonus Viewer has a knowledge-base
 * framework but NO ingested data source, so it is not a report family — giving
 * it one here would create a family whose loader could only ever return
 * nothing, and a "no current delivery" message for a report that was never
 * meant to have one.
 *
 * NO FIGURES, NO THRESHOLDS, NO INTERPRETATION. This is a registry. What each
 * family's numbers mean is in its analytics module; how to reason about them is
 * in the Knowledge Base.
 *
 * CLIENT-SAFE. No `server-only`, no database, no `process.env`. The report tabs
 * are client components and they need the labels and the ids to build the "Ask
 * Sunny about this report" link.
 */

import { BED_USAGE_MEASURES } from "../bed-usage/metric-map";
import { COMP_SALES_METRICS } from "../comp-sales/metric-catalogue";
import { DIMENSION_FIELDS } from "../comp-sales/dimensions";
import { SALES_TOTALS_METRIC_CODES } from "../sales-totals/metric-map";

/** Every report family this build knows about, as the route keys spell them. */
export type ReportFamilyId =
  | "sales-totals"
  | "salon-performance"
  | "bed-usage"
  | "spa-wellness"
  | "spa-engagement";

/**
 * The period shapes a family's SOURCE can deliver.
 *
 * Not a wish list — each of these is a window some ingested report actually
 * carries. Sales Totals delivers a single day and a month to date; the Comp
 * Report delivers month-to-date and year-to-date sheets; Spa Wellness delivers
 * MTD, YTD and LTM in one workbook. Recorded per family so a manager asking
 * "what about year to date?" can be told which reports can answer that and
 * which cannot, instead of being handed the newest window under a heading it
 * does not match.
 */
export type ReportPeriodTypeId = "daily" | "mtd" | "ytd" | "ltm";

export const REPORT_PERIOD_TYPE_LABEL: Readonly<Record<ReportPeriodTypeId, string>> = {
  daily: "a single day",
  mtd: "month to date",
  ytd: "year to date",
  ltm: "last twelve months",
};

export interface ReportFamily {
  readonly id: ReportFamilyId;
  /** What a manager calls it. Matches the dashboard tab exactly. */
  readonly label: string;
  /** The dashboard that renders it. */
  readonly path: string;
  /**
   * The source workbook, as the operator receives it.
   *
   * Recorded so a "no current delivery" message can name the thing somebody
   * has to send, rather than a family id nobody outside the code has seen.
   */
  readonly sourceReport: string;
  /**
   * What this family can answer, in one line, for the prompt.
   *
   * Written as CAPABILITY rather than as content, because the prompt uses it to
   * decide whether to say "that figure is not in this data, the X report would
   * carry it" — which is only useful if it names the right X.
   */
  readonly carries: string;
  /**
   * The period windows this family's source delivers.
   *
   * FIRST ENTRY IS THE DEFAULT — the window a question that names none should
   * be answered from. For Sales Totals that is the day, because it is the daily
   * signal; for everything else it is month to date.
   */
  readonly periodTypes: readonly ReportPeriodTypeId[];
  /**
   * The measures this family carries, by their stored metric codes.
   *
   * DERIVED FROM THE MAPS THAT ALREADY DEFINE THEM rather than retyped here.
   * A second list of metric names is a second thing to forget to update, and
   * the failure is silent: the catalog would advertise a measure the loader
   * cannot read, or omit one it can.
   *
   * Spa Wellness and Spa Engagement have no metric MAP — their measures are
   * computed by named analytics functions rather than read from named columns —
   * so those two name their measures directly, and a test pins each name to
   * the analytics module that produces it.
   */
  readonly metrics: readonly string[];
  /**
   * The dimensions a question can narrow by within this family.
   *
   * What the report actually carries, not what would be nice: Sales Totals has
   * no district column at all, which is why a district filter on that tab would
   * be a control that cannot work.
   */
  readonly dimensions: readonly string[];
  /**
   * ==========================================================================
   * TWO AUTHORITIES, AND THEY ARE NOT IN COMPETITION
   * ==========================================================================
   *
   * The first revision of these two fields got the model wrong, in a way worth
   * recording because it is the mistake anyone would make. It declared that no
   * reasoning framework applied to the three bed and spa families, meaning to
   * protect their formulas — and what that actually said was "the manager
   * reasoning model does not apply to Bed Usage", which is untrue of the code
   * and not what anybody wanted. A manager asking why Spa is weak needs that
   * model just as much as one asking about revenue.
   *
   * The two authorities answer DIFFERENT QUESTIONS and both apply to every
   * family:
   *
   *   `metricAuthority`   WHAT THE NUMBER IS, and what band it falls in. Always
   *                       code — a reviewed column mapping, or the approved
   *                       classification module. Never a knowledge base
   *                       document, for any family.
   *
   *   `actionFramework`   WHAT THE MANAGER SHOULD DO ABOUT IT. The Daily Stats
   *                       Interpretation Framework, for all five: signal to
   *                       business meaning to likely behaviour to what to
   *                       coach, inspect, role-play, follow up and recognise.
   *
   * SO THE SEPARATION IS BY QUESTION, NOT BY FAMILY. Bed Usage says FASTEST is
   * outperforming and FAST is capacity-advisory; those facts are the
   * classification module's and are quoted exactly as they stand. What the
   * framework adds is the manager implication — and it adds it without being
   * told a single threshold, which is why `DAILY_STATS_REASONING` in
   * `ai/prompts.ts` restates no band, no formula and no metric name.
   */
  readonly actionFramework: "daily_stats_interpretation_framework";
  /**
   * What decides this family's numbers and bands, in one line for the prompt.
   *
   * ALWAYS CODE, never a document. Stated per family because the two kinds of
   * authority are genuinely different, and conflating them is how an approved
   * business rule gets quietly overwritten by a generic coaching framework.
   */
  readonly metricAuthority: string;
}

/**
 * THE FAMILIES, IN THE ORDER THE TABS SHOW THEM.
 *
 * Sales Totals leads the reasoning order even though Salon Performance leads
 * the tab strip, and that is not an inconsistency: the tabs open on the report
 * built from the audited Comp Report workbook, while a question like "what
 * should I focus on today" starts from the daily signal. `REASONING_ORDER`
 * below states that separately rather than reordering this list, so the tabs
 * and the URLs stay where managers left them.
 */
export const REPORT_FAMILIES: readonly ReportFamily[] = [
  {
    id: "salon-performance",
    label: "Salon Performance",
    path: "/reports/salon-performance",
    sourceReport: "Comp Report",
    carries:
      "month-to-date, year-to-date and prior-year comparisons of revenue, OTC, EFT, tans, unique tanners, spa sessions and membership measures, per salon and per district.",
    /*
     * The workbook delivers a month-to-date sheet and a year-to-date sheet, and
     * the month-to-date sheet also carries the source's own trailing 3, 6, 9
     * and 12-month columns — which is where "last twelve months" comes from for
     * this family. It is not a separate delivery, so it is not a period TYPE
     * here; `read/windows.ts` offers it as a comparison window instead.
     */
    periodTypes: ["mtd", "ytd"],
    // Derived from the seeded catalogue, so the list cannot advertise a measure
    // the loader has no mapping for.
    metrics: COMP_SALES_METRICS.map((metric) => metric.code),
    dimensions: DIMENSION_FIELDS.map((field) => field.property),
    actionFramework: "daily_stats_interpretation_framework",
    metricAuthority:
      "the reviewed column mapping in comp-sales/metric-catalogue.ts, and the source's own published % change columns wherever it publishes one.",
  },
  {
    id: "sales-totals",
    label: "Sales Totals",
    path: "/reports/sales-totals",
    sourceReport: "daily Sales Totals email",
    carries:
      "the previous day and month to date for Grand Total, PPTA, Tans, EFTs, New Customers and Sunless Sessions, per salon.",
    /*
     * DAILY FIRST, and that ordering is the whole reason this field exists. One
     * delivery carries both windows, and a question that names neither is
     * almost always about yesterday — "what happened", "how did we do". A
     * month-to-date default would answer a different question with a bigger
     * number.
     */
    periodTypes: ["daily", "mtd"],
    metrics: SALES_TOTALS_METRIC_CODES,
    /*
     * EMPTY, AND THAT IS A FACT ABOUT THE REPORT. It carries a company column
     * and a salon name and nothing else — no district, no region, no ownership
     * group. A district filter on this family would be a control that cannot
     * work, and the catalog says so rather than letting one be built.
     */
    dimensions: [],
    actionFramework: "daily_stats_interpretation_framework",
    metricAuthority:
      "sales-totals/metric-map.ts, which records that the estate block holds per-salon averages and that PPTA is an average at every scope.",
  },
  {
    id: "bed-usage",
    label: "Bed Usage",
    path: "/reports/bed-usage",
    sourceReport: "monthly Bed Usage Report",
    carries:
      "tanning traffic and equipment utilisation — total tans, bed quantity, per-bed usage and performance against the chain, by salon and equipment level.",
    periodTypes: ["mtd"],
    metrics: BED_USAGE_MEASURES.map((measure) => measure.code),
    dimensions: ["company", "district", "region", "salon", "level", "bedType"],
    /*
     * The framework shapes the manager ACTION here exactly as it does for the
     * revenue families. What it never touches is the line below.
     */
    actionFramework: "daily_stats_interpretation_framework",
    metricAuthority:
      "performance/classification.ts for the v-Chain ladder, and the FAST rule: FAST removals are intentional, so a FAST shortfall is a capacity and volume-migration signal and never a failure.",
  },
  {
    id: "spa-wellness",
    label: "Spa Wellness",
    path: "/reports/spa-wellness",
    sourceReport: "STC SPA Wellness Tracking workbook",
    carries:
      "spa sessions by equipment type against the peers who have the same equipment installed, month-to-date, year-to-date and last-twelve-months, with first and last use dates.",
    /* One workbook, three windows, all ending on the same day. */
    periodTypes: ["mtd", "ytd", "ltm"],
    /*
     * NAMED DIRECTLY, because these measures are computed by analytics
     * functions rather than read from named columns — there is no metric map to
     * derive them from. A test pins each name to the function that produces it.
     */
    metrics: [
      "spa_sessions",
      "jb_average",
      "peer_average",
      "versus_peers_percent",
      "equipment_installed",
      "first_use_date",
      "last_use_date",
    ],
    dimensions: ["company", "district", "region", "salon", "equipment"],
    actionFramework: "daily_stats_interpretation_framework",
    metricAuthority:
      "spa-wellness-analytics.ts and performance/classification.ts, under the equipment-presence rule: zero usage means the equipment is NOT INSTALLED, and a comparison is only made where both JB and the peer have non-zero usage of the same equipment.",
  },
  {
    id: "spa-engagement",
    label: "Spa Engagement",
    path: "/reports/spa-engagement",
    sourceReport: "Spa Sessions per Unique Tanner per Spa Bed workbook",
    carries:
      "how much of the tanning customer base uses spa — spa sessions, unique tanners, unique spa tanners, spa beds, sessions per bed, sessions per unique tanner per spa bed and the published ranks.",
    periodTypes: ["mtd"],
    metrics: [
      "spa_sessions",
      "total_unique_tanners",
      "unique_spa_tanners",
      "spa_bed_count",
      "spa_sessions_per_bed",
      "spa_sessions_per_unique_per_bed",
      "unique_spa_tanner_percent",
      "spa_per_unique_percent",
      "published_rank",
    ],
    dimensions: ["company", "districtManager", "salon"],
    actionFramework: "daily_stats_interpretation_framework",
    metricAuthority:
      "spa-engagement-analytics.ts and spa-conversion.ts. Spa Conversion Rate is monthly spa sessions divided by monthly total tans, and at any aggregated level it is SUM(sessions) / SUM(tans) — never the mean of per-salon rates. Spa Per Unique % and Spa Sessions per Unique Tanner per Spa Bed are different measures with different denominators.",
  },
];

export const REPORT_FAMILIES_BY_ID: Readonly<Record<ReportFamilyId, ReportFamily>> =
  Object.fromEntries(REPORT_FAMILIES.map((family) => [family.id, family])) as Record<
    ReportFamilyId,
    ReportFamily
  >;

export const REPORT_FAMILY_IDS: readonly ReportFamilyId[] = REPORT_FAMILIES.map(
  (family) => family.id,
);

/**
 * The order families are REASONED in, which is not the order they are shown in.
 *
 * A briefing reads top to bottom and the model weights the top. Sales Totals is
 * the immediate daily signal and Salon Performance is the trend it sits inside,
 * so those two lead; the bed and spa families follow in the order their metrics
 * depend on each other — traffic, then equipment, then engagement.
 */
export const REPORT_FAMILY_REASONING_ORDER: readonly ReportFamilyId[] = [
  "sales-totals",
  "salon-performance",
  "bed-usage",
  "spa-wellness",
  "spa-engagement",
];

/** A family id from an untrusted string, or null. Never throws, never guesses. */
export function parseReportFamily(value: unknown): ReportFamilyId | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return (REPORT_FAMILY_IDS as readonly string[]).includes(trimmed)
    ? (trimmed as ReportFamilyId)
    : null;
}

/**
 * Families in reasoning order, de-duplicated.
 *
 * Callers collect families from a keyword gate, from a report tab's context and
 * from a follow-up's remembered family, in whatever order those arrive. The
 * briefing needs one canonical sequence, and it must be the same sequence every
 * time so a cached prompt prefix stays cached.
 */
export function orderReportFamilies(
  families: readonly ReportFamilyId[],
): ReportFamilyId[] {
  const wanted = new Set(families);
  return REPORT_FAMILY_REASONING_ORDER.filter((id) => wanted.has(id));
}
