import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
import type { SalonKpi } from "@/lib/reporting/read/salon-detail";
import { MetricLineage } from "./metric-lineage";

/**
 * THE HEADLINE MEASURES FOR ONE SALON.
 *
 * The dashboard's KPI row carries a salon count, because a total across fifteen
 * salons invites being read as the chain's. These cards do not: the figure is
 * this salon's own reported number, so the denominator that matters is stated
 * in the header instead — one salon, one period, one comparison.
 *
 * UNAVAILABLE IS A RESULT, NOT AN ERROR. A measure this salon has no row for
 * says "Unavailable" and says why underneath. It never shows 0, which would
 * read as a collapse rather than an absence, and it never falls back to another
 * comparison or another measure.
 *
 * DIRECTION IS NEVER COLOUR ALONE. Where `higher_is_better` is known the change
 * gets an arrow and a word; where it is null the card shows magnitude with a
 * neutral tone and no judgement, because colouring it would assert something
 * the business has not stated.
 */

function ChangeIndicator({
  value,
  higherIsBetter,
  fallback,
}: {
  value: number | null;
  higherIsBetter: boolean | null;
  fallback: string;
}) {
  if (value === null) {
    return <span className="text-xs text-muted-foreground">{fallback}</span>;
  }

  const sentiment = sentimentFor(value, higherIsBetter);
  const rising = value > 0;
  const Icon = value === 0 ? Minus : rising ? ArrowUpRight : ArrowDownRight;
  const toneClass =
    sentiment === "good"
      ? "text-[var(--stc-sage)]"
      : sentiment === "bad"
        ? "text-[var(--stc-brick)]"
        : "text-muted-foreground";

  return (
    <span className={cn("flex items-center gap-1 text-sm font-medium", toneClass)}>
      <Icon aria-hidden className="size-3.5" />
      {formatMetricValue(value, "percent")}
      <span className="sr-only">
        {value === 0 ? "unchanged" : rising ? "increase" : "decrease"}
        {sentiment === "neutral" ? ", direction not defined for this measure" : ""}
      </span>
    </span>
  );
}

export function SalonKpiCards({
  kpis,
  windowShortLabel,
  sourceReport,
  className,
}: {
  kpis: SalonKpi[];
  /** The selected comparison, named on every card so the change is unambiguous. */
  windowShortLabel: string;
  /** The filename behind these figures, for the per-measure lineage. */
  sourceReport: string | null;
  className?: string;
}) {
  if (kpis.length === 0) return null;

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {kpis.map((kpi) => (
        <Card key={kpi.metricCode}>
          <CardContent className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {kpi.label}
            </p>

            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {kpi.current.value === null
                ? "Unavailable"
                : formatMetricValue(kpi.current.value, kpi.unit)}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <ChangeIndicator
                value={kpi.change.value}
                higherIsBetter={kpi.higherIsBetter}
                fallback={kpi.supported ? "No comparison available" : "Not reported"}
              />
              {kpi.change.value !== null ? (
                <span className="text-xs text-muted-foreground">
                  {windowShortLabel}
                  {/*
                    Marked where WE computed it. A change the source stated may
                    be against a population this copy does not contain, so the
                    two are never presented as the same kind of claim.
                  */}
                  {kpi.change.source === "derived" ? (
                    <span title={kpi.change.note}> ·&nbsp;computed here</span>
                  ) : null}
                </span>
              ) : null}
            </div>

            <dl className="space-y-0.5 text-xs text-muted-foreground">
              <div className="flex items-baseline justify-between gap-2">
                <dt>{kpi.currentLabel}</dt>
                <dd className="tabular-nums">
                  {kpi.current.value === null
                    ? "Unavailable"
                    : formatMetricValue(kpi.current.value, kpi.unit, { compact: true })}
                </dd>
              </div>
              {kpi.baselineLabel ? (
                <div className="flex items-baseline justify-between gap-2">
                  <dt>{kpi.baselineLabel}</dt>
                  <dd className="tabular-nums">
                    {/* Absent, not zero. */}
                    {kpi.baseline === null || kpi.baseline.value === null
                      ? "Unavailable"
                      : formatMetricValue(kpi.baseline.value, kpi.unit, { compact: true })}
                  </dd>
                </div>
              ) : null}
            </dl>

            {!kpi.supported ? (
              <p className="text-xs text-subtle-foreground">{kpi.change.note}</p>
            ) : kpi.unavailableReason ? (
              <p className="text-xs text-subtle-foreground">{kpi.unavailableReason}</p>
            ) : null}

            {/* Secondary by design: a disclosure, closed, below the figure. */}
            {kpi.current.value !== null ? (
              <MetricLineage
                label={kpi.label}
                windowLabel={kpi.currentLabel}
                figures={[
                  { heading: kpi.currentLabel, figure: kpi.current },
                  ...(kpi.baseline && kpi.baselineLabel
                    ? [{ heading: kpi.baselineLabel, figure: kpi.baseline }]
                    : []),
                ]}
                sourceReport={sourceReport}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
