import { Skeleton } from "@/components/ui/feedback";
import { Provenance } from "@/components/ui/marquee";
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
  /*
   * NO CARD AND NO HEADER. The Overview puts a section rule above this — the
   * label, the yellow line and "Open Reports & Analytics" — so a card title and
   * a second link here would state both twice. The caption survives as the
   * provenance line under the figures, which is where it belongs anyway: on a
   * number a district manager will quote in a meeting, the period and the
   * through-date are not decoration.
   */
  return (
    <div className="flex flex-col gap-2.5">
      {children}
      <Provenance>{caption}</Provenance>
    </div>
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
    <div className="stat-cell min-w-0">
      <p className="eyebrow">{kpi.label}</p>
      <p
        className="display-figure mt-2 truncate text-[30px] text-foreground sm:text-[34px]"
        title={kpi.unavailableReason ?? undefined}
      >
        {/* An em dash, never a zero: a missing measure is not a bad one. */}
        {kpi.value ?? "—"}
      </p>
      <p className="eyebrow mt-2 text-subtle-foreground">
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
    /*
      ONE PANEL DIVIDED BY HAIRLINES, not four tiles in a gap grid. A figure
      only reads as the largest thing on the page when nothing is drawn around
      it, and the hairline rules live in one shared class rather than being
      re-derived per caller.
    */
    <div className="grid grid-cols-1 rounded-2xl border border-border bg-surface py-4 shadow-raised sm:grid-cols-2 xl:grid-cols-4">
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
      <div className="grid grid-cols-1 rounded-2xl border border-border bg-surface py-4 shadow-raised sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="stat-cell">
            <Skeleton className="h-2 w-20" />
            <Skeleton className="mt-2 h-[30px] w-24" />
            <Skeleton className="mt-2 h-2 w-24" />
          </div>
        ))}
      </div>
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
        <p className="rounded-2xl border border-border bg-surface px-5 py-4 text-[13px] leading-relaxed text-muted-foreground">
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
        <p className="rounded-2xl border border-border bg-surface px-5 py-4 text-[13px] leading-relaxed text-muted-foreground">
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
    <OverviewFrame
      caption={`All salons · ${sourceLine}${overview.updatedLabel ? ` · Updated ${overview.updatedLabel}` : ""}`}
    >
      <KpiGrid kpis={overview.kpis} />
    </OverviewFrame>
  );
}

/** Reads the reports, then renders the card. Streamed behind a `<Suspense>`. */
export async function PerformanceOverview() {
  return <PerformanceOverviewCard overview={await loadReportingOverview()} />;
}
