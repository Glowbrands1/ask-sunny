/**
 * The Reports & Analytics section: which reports exist, and where they live.
 *
 * Three things have to agree on where this section starts — the sidebar entry,
 * the `/reports` redirect, and the active-state prefix — and the tab strip now
 * agrees on the list. They were going to be string literals repeated across
 * files, and the failure mode is quiet: a report still works, the sidebar just
 * stops lighting up, or a tab points somewhere no page lives.
 *
 * Plain data, safe in a client component: the sidebar and the tab strip are
 * both clients.
 */

/** The section root. Redirects to the default report; never rendered itself. */
export const REPORTS_SECTION_PATH = "/reports";

/** One report in the section. */
export interface ReportRoute {
  /** Stable key, used for React keys and tests rather than the label. */
  readonly key: string;
  /** What the tab says. */
  readonly label: string;
  /** One line under the heading, for a reader deciding which report to open. */
  readonly summary: string;
  readonly path: string;
}

/**
 * THE REPORTS, IN THE ORDER THEY APPEAR.
 *
 * Salon Performance is first and is the section default: it is the report built
 * on the audited Comp Report workbook, and it is what a manager opening the
 * section is most often after.
 *
 * Adding a report means adding an entry here and a route at its path. The tab
 * strip, the sidebar's active state and the `/reports` redirect all follow from
 * this list rather than needing their own edit.
 */
export const REPORTS: readonly ReportRoute[] = [
  {
    key: "salon-performance",
    label: "Salon Performance",
    summary: "Comparable-store (same-store) sales from the ingested Comp Report.",
    path: "/reports/salon-performance",
  },
  {
    key: "sales-totals",
    label: "Sales Totals",
    summary: "Previous day and month to date, from the daily Sales Totals email.",
    path: "/reports/sales-totals",
  },
];

/**
 * The report the section opens on.
 *
 * Derived from the list rather than written twice, so reordering `REPORTS`
 * cannot leave the redirect pointing at what is no longer first.
 */
export const REPORTS_DEFAULT_PATH = REPORTS[0].path;

/** The report a pathname belongs to, or null outside the section. */
export function reportForPath(pathname: string): ReportRoute | null {
  return (
    REPORTS.find(
      (report) => pathname === report.path || pathname.startsWith(`${report.path}/`),
    ) ?? null
  );
}
