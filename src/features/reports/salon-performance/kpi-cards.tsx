import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
import type { DashboardKpi } from "@/lib/reporting/read/dashboard";

/**
 * THE KPI ROW.
 *
 * Each card carries three things and refuses to imply a fourth: the current
 * figure, the baseline it is being compared against, and how many salons are
 * behind both. The salon count is not a footnote — it is what stops "$X Total
 * Revenue" being read as a chain number.
 *
 * DIRECTION IS NEVER COLOUR ALONE. Where `higher_is_better` is known the change
 * gets an arrow AND a word ("up"/"down"); where it is null the card shows the
 * magnitude with a neutral dash and no judgement, because colouring it would
 * assert something the business has not stated.
 *
 * An unavailable baseline renders as "Unavailable", never as 0 — a zero would
 * read as a total collapse rather than an absent measurement.
 */

function ChangeIndicator({
  value,
  higherIsBetter,
}: {
  value: number | null;
  higherIsBetter: boolean | null;
}) {
  if (value === null) {
    return <span className="text-xs text-muted-foreground">No comparison available</span>;
  }

  const sentiment = sentimentFor(value, higherIsBetter);
  const rising = value > 0;
  const Icon = value === 0 ? Minus : rising ? ArrowUpRight : ArrowDownRight;

  // Text tokens, not series colours. A muted tone for anything we cannot judge.
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
      {/* The word, so the meaning never rests on the colour or the glyph. */}
      <span className="sr-only">
        {value === 0 ? "unchanged" : rising ? "increase" : "decrease"}
        {sentiment === "neutral" ? ", direction not defined for this measure" : ""}
      </span>
    </span>
  );
}

export function KpiCards({
  kpis,
  baselineYear,
  currentYear,
  className,
}: {
  kpis: DashboardKpi[];
  baselineYear: number;
  currentYear: number;
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

            <div className="flex items-center gap-2">
              <ChangeIndicator value={kpi.change.value} higherIsBetter={kpi.higherIsBetter} />
              <span className="text-xs text-muted-foreground">vs {baselineYear}</span>
            </div>

            <dl className="space-y-0.5 text-xs text-muted-foreground">
              <div className="flex items-baseline justify-between gap-2">
                <dt>{currentYear}</dt>
                <dd className="tabular-nums">
                  {kpi.current.value === null
                    ? "Unavailable"
                    : formatMetricValue(kpi.current.value, kpi.unit, { compact: true })}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt>{baselineYear}</dt>
                <dd className="tabular-nums">
                  {/* Absent, not zero. */}
                  {kpi.baseline?.value === null || kpi.baseline === null
                    ? "Unavailable"
                    : formatMetricValue(kpi.baseline.value, kpi.unit, { compact: true })}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt>Salons reporting</dt>
                <dd className="tabular-nums">{kpi.salonCount}</dd>
              </div>
            </dl>

            {kpi.current.unavailableReason ? (
              <p className="text-xs text-subtle-foreground">{kpi.current.unavailableReason}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
