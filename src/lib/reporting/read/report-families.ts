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

/** Every report family this build knows about, as the route keys spell them. */
export type ReportFamilyId =
  | "sales-totals"
  | "salon-performance"
  | "bed-usage"
  | "spa-wellness"
  | "spa-engagement";

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
  },
  {
    id: "sales-totals",
    label: "Sales Totals",
    path: "/reports/sales-totals",
    sourceReport: "daily Sales Totals email",
    carries:
      "the previous day and month to date for Grand Total, PPTA, Tans, EFTs, New Customers and Sunless Sessions, per salon.",
  },
  {
    id: "bed-usage",
    label: "Bed Usage",
    path: "/reports/bed-usage",
    sourceReport: "monthly Bed Usage Report",
    carries:
      "tanning traffic and equipment utilisation — total tans, bed quantity, per-bed usage and performance against the chain, by salon and equipment level.",
  },
  {
    id: "spa-wellness",
    label: "Spa Wellness",
    path: "/reports/spa-wellness",
    sourceReport: "STC SPA Wellness Tracking workbook",
    carries:
      "spa sessions by equipment type against the peers who have the same equipment installed, month-to-date, year-to-date and last-twelve-months, with first and last use dates.",
  },
  {
    id: "spa-engagement",
    label: "Spa Engagement",
    path: "/reports/spa-engagement",
    sourceReport: "Spa Sessions per Unique Tanner per Spa Bed workbook",
    carries:
      "how much of the tanning customer base uses spa — spa sessions, unique tanners, unique spa tanners, spa beds, sessions per bed, sessions per unique tanner per spa bed and the published ranks.",
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
