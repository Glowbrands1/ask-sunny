import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Skeleton } from "@/components/ui/feedback";
import { Provenance } from "@/components/ui/marquee";
import { cn } from "@/lib/utils/cn";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
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
 * THE CHANGE UNDER A FIGURE — green when it is good, red when it is behind.
 *
 * The same control the Salon Performance KPI row carries, on the same rule and
 * through the same `sentimentFor`, so the Overview and the report a click away
 * cannot colour the same measure differently.
 *
 * NEUTRAL WHERE NO DIRECTION HAS BEEN STATED. `higher_is_better` is null for
 * some measures, and a green arrow on one of those would be the app asserting a
 * judgement the business has not made — a rise in a cost measure painted as good
 * news. The screen reader is told the direction is undefined rather than being
 * left with a bare percentage.
 *
 * AND NEVER COLOUR ALONE: the arrow glyph and the word both stand on their own,
 * which is what keeps this readable for the red-green colour blindness that a
 * green/red pair is worst for.
 */
function ChangeLine({ change }: { change: NonNullable<OverviewKpi["change"]> }) {
  const sentiment = sentimentFor(change.percent, change.higherIsBetter);
  const rising = change.percent > 0;
  const Icon = change.percent === 0 ? Minus : rising ? ArrowUpRight : ArrowDownRight;

  return (
    <p
      className={cn(
        "mt-1.5 flex items-center gap-1 text-[11.5px] font-bold tabular-nums",
        sentiment === "good"
          ? "text-delta-up"
          : sentiment === "bad"
            ? "text-measure-flagged-foreground"
            : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="size-3" />
      {formatMetricValue(change.percent, "percent")}
      <span className="font-normal text-muted-foreground">
        {change.comparisonLabel}
      </span>
      <span className="sr-only">
        {change.percent === 0 ? "unchanged" : rising ? "increase" : "decrease"}
        {sentiment === "neutral" ? ", direction not defined for this measure" : ""}
      </span>
    </p>
  );
}

/**
 * One headline figure.
 *
 * The period sits UNDER the value rather than in the card heading, because the
 * families report on different schedules and a single heading would have to be
 * wrong about at least one of them.
 *
 * THE CHANGE IS ABSENT ON A TILE THAT HAS NONE, rather than being drawn flat or
 * dashed. Sales Totals publishes a month-to-date position with no baseline, so
 * two of these four tiles carry a figure and no arrow — and that reads correctly
 * as "nothing to compare against" instead of as "no change", which is a claim
 * about something nobody measured.
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
      {/* No arrow beside an absent figure — there is nothing for it to be about. */}
      {kpi.change && kpi.value !== null ? <ChangeLine change={kpi.change} /> : null}
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

/* ========================================================================== */
/*  THE SAME SNAPSHOT, AS THE COLLAPSED STRIP                                 */
/* ========================================================================== */

/**
 * WHAT THE OVERVIEW SAYS, THE STRIP SAYS TOO.
 *
 * When an inline answer opens, the Overview collapses to one strip so the page
 * is not pushed off screen. That strip previously carried the follow-up counts,
 * because this screen is a client component and the reporting read layer is
 * `server-only` — the numbers in the Performance panel were literally not
 * reachable from the code rendering the strip.
 *
 * So the strip is a SERVER component too, passed down as a node exactly like the
 * panel, and both call `loadReportingOverview`. That call is `cache`d per
 * request, which is what makes this one read rather than two: the strip and the
 * panel are two presentations of one snapshot and cannot state different
 * revenue on the same screen. The live mechanism is unchanged — `force-dynamic`
 * on the page, so every navigation re-reads.
 *
 * ONLY THE FIGURES CROSS OVER. The strip does not repeat each figure's period
 * label: at strip size that is four extra fragments of small print, and the
 * expanded panel one button away carries all of them. It keeps the period on
 * the TOOLTIP instead, so nothing is lost, and a measure the report did not
 * carry still shows an em dash rather than a zero.
 */
function StripFigure({ kpi }: { kpi: OverviewKpi }) {
  return (
    <span
      className="flex shrink-0 items-baseline gap-1.5 text-[12px] text-muted-foreground"
      title={kpi.unavailableReason ?? kpi.periodLabel}
    >
      <b className="display-figure text-[19px] font-normal text-foreground">
        {/* An em dash, never a zero — the same rule the panel follows. */}
        {kpi.value ?? "—"}
      </b>
      {kpi.label}
    </span>
  );
}

/** The strip's figures, given their data. Pure, so all three states are testable. */
export function PerformanceStripFigures({
  overview,
}: {
  overview: ReportingOverview;
}) {
  if (overview.status !== "ready") {
    /*
     * A sentence rather than nothing. An empty strip reads as "the dashboard
     * has no numbers today", which is a different and alarming claim from "the
     * reports are not reachable from here".
     */
    return (
      <span className="text-[12px] text-muted-foreground">
        {overview.status === "error"
          ? "Reporting figures are unavailable right now."
          : "No reporting figures yet."}
      </span>
    );
  }

  return (
    <>
      {overview.kpis.map((kpi) => (
        <StripFigure key={kpi.key} kpi={kpi} />
      ))}
    </>
  );
}

/** Holds the strip's height while the same read the panel uses resolves. */
export function PerformanceStripSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-[19px] w-28 shrink-0" />
      ))}
    </>
  );
}

/** Reads the reports, then renders the strip figures. Streamed behind a `<Suspense>`. */
export async function PerformanceStrip() {
  return <PerformanceStripFigures overview={await loadReportingOverview()} />;
}
