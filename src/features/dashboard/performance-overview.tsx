import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { REPORTS_SECTION_PATH } from "@/features/reports/reports-routes";
import {
  loadReportingOverview,
  type OverviewKpi,
  type ReportingOverview,
} from "@/lib/reporting/read/overview";

/**
 * ============================================================================
 * PERFORMANCE OVERVIEW — the homepage's executive snapshot
 * ============================================================================
 *
 * This card replaced a seeded "Daily Stats" tile that showed four invented
 * figures under the heading "Yesterday across all salons". Three things about
 * it are deliberate, and each one is a correction of that card.
 *
 *   IT IS A SUMMARY, NOT A SECOND DASHBOARD. Four figures, one link, no charts,
 *   no filters, no tables. Reports & Analytics is a click away and is where
 *   every question this card raises gets answered.
 *
 *   EVERY FIGURE NAMES ITS OWN PERIOD. The report families do not share one:
 *   Salon Performance is year-to-date, Sales Totals is the previous day. So the
 *   card heading says "Latest reporting snapshot" and each tile carries its own
 *   window. Nothing here is ever labelled "Yesterday" unless it is.
 *
 *   A MISSING FIGURE IS NOT A ZERO. A measure the report did not carry renders
 *   as an em dash with the reason on its tooltip, and a failed query renders a
 *   sentence rather than a row of zeros — which would read as a catastrophe
 *   that did not happen.
 *
 * A SERVER COMPONENT, on purpose. It is passed into the client `OverviewScreen`
 * as a prop and wrapped in `<Suspense>` by the page, so the rest of the
 * homepage paints immediately and this streams in behind a skeleton. That keeps
 * the reporting read layer server-side — where `server-only` requires it to be —
 * without adding an unauthenticated JSON endpoint that would publish real
 * revenue more widely than the report pages already do.
 */

function OverviewFrame({
  children,
  caption,
}: {
  children: React.ReactNode;
  caption: string;
}) {
  return (
    <Card>
      {/*
        STACKED ON A PHONE, SIDE BY SIDE FROM `sm`.
        Sharing one row with the link squeezed the heading to about half the
        width, wrapping "Performance Overview" onto two lines and the caption
        onto three. The link is the least important thing in the card, so it
        drops below rather than making the heading illegible.
      */}
      <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <CardTitle>Performance Overview</CardTitle>
          <p className="mt-1 text-[13px] text-muted-foreground">{caption}</p>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-3 shrink-0 sm:ml-0"
        >
          <Link href={REPORTS_SECTION_PATH}>
            Open Reports &amp; Analytics
            <ArrowUpRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

/**
 * One headline figure.
 *
 * The period sits UNDER the value rather than in the card heading, because the
 * families report on different schedules and a single heading would have to be
 * wrong about at least one of them.
 */
function KpiTile({ kpi }: { kpi: OverviewKpi }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{kpi.label}</p>
      <p
        className="mt-1.5 truncate text-[22px] leading-none font-semibold text-foreground tabular-nums"
        title={kpi.unavailableReason ?? undefined}
      >
        {kpi.value ?? "—"}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {kpi.value === null ? "Not reported" : kpi.periodLabel}
      </p>
    </div>
  );
}

/**
 * The tile grid.
 *
 * Two columns on a phone and four from `sm` up, so four KPIs wrap to two clean
 * rows rather than being squeezed to four narrow columns. `auto-fit` is
 * deliberately not used: a fifth and sixth KPI arriving with the spa reports
 * should wrap onto a second row of the same width, not silently reflow the
 * first row into something narrower.
 */
function KpiGrid({ kpis }: { kpis: readonly OverviewKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiTile key={kpi.key} kpi={kpi} />
      ))}
    </div>
  );
}

/** Placeholder that holds the card's exact dimensions while the data loads. */
export function PerformanceOverviewSkeleton() {
  return (
    <OverviewFrame caption="Loading the latest reporting snapshot…">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index}>
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-2 h-[22px] w-16" />
            <Skeleton className="mt-2 h-2.5 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-2.5 w-52" />
    </OverviewFrame>
  );
}

/**
 * THE CARD, GIVEN ITS DATA — pure, synchronous, and separately exported.
 *
 * Split from the async component below so all three outcomes can be rendered in
 * a test. The states that matter most here are the ones nobody sees in
 * development: "nothing ingested" and "the query failed" both have to be
 * distinguishable from a real zero, and a screenshot is not evidence about
 * that.
 */
export function PerformanceOverviewCard({
  overview,
}: {
  overview: ReportingOverview;
}) {
  if (overview.status === "no_data") {
    return (
      <OverviewFrame caption="All salons">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Reporting data is not available yet. {overview.reason}
        </p>
      </OverviewFrame>
    );
  }

  if (overview.status === "error") {
    /*
     * A sentence, not zeros. The distinction matters: a row of $0 under
     * "Total sales" is indistinguishable from a catastrophic trading day, and a
     * reader has no way to tell that the query simply failed.
     */
    return (
      <OverviewFrame caption="All salons">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {overview.message} No figures are shown rather than figures that might
          be wrong. Reports &amp; Analytics has the detail once it is reachable.
        </p>
      </OverviewFrame>
    );
  }

  /*
   * The secondary line: which reports answered, and how current they are. One
   * line, muted, and no raw UTC timestamp — the homepage question is "is this
   * roughly current", not "when exactly did the loader run".
   */
  const sourceLine = overview.sources
    .map((source) => `${source.label} · ${source.periodLabel}`)
    .join("  ·  ");

  return (
    <OverviewFrame caption="Latest reporting snapshot · All salons">
      <KpiGrid kpis={overview.kpis} />
      <p className="mt-4 text-xs text-subtle-foreground">
        {sourceLine}
        {overview.updatedLabel ? ` · Updated ${overview.updatedLabel}` : ""}
      </p>
    </OverviewFrame>
  );
}

/** Reads the reports, then renders the card. Streamed behind a `<Suspense>`. */
export async function PerformanceOverview() {
  return <PerformanceOverviewCard overview={await loadReportingOverview()} />;
}
