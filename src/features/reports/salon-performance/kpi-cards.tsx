import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
import type { DashboardKpi } from "@/lib/reporting/read/dashboard";

/**
 * THE KPI ROW.
 *
 * Each card carries three things and refuses to imply a fourth: the current
 * figure, what it is being compared against, and how many salons are behind
 * both. The salon count is not a footnote — it is what stops "$X Total Revenue"
 * being read as a chain number.
 *
 * DIRECTION IS NEVER COLOUR ALONE. Where `higher_is_better` is known the change
 * gets an arrow AND a word ("increase"/"decrease"); where it is null the card
 * shows the magnitude with a neutral dash and no judgement, because colouring it
 * would assert something the business has not stated.
 *
 * An unavailable figure renders as "Unavailable", never as 0 — a zero would read
 * as a total collapse rather than an absent measurement. And a measure the
 * source does not report for the selected window says exactly that, rather than
 * quietly showing the same measure under a different comparison.
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

  /*
   * GREEN FOR A RISE, CORAL FOR A SHORTFALL, NEUTRAL WHERE DIRECTION IS
   * UNDEFINED.
   *
   * The artifact sets a rising change figure to #2f6b4f and a falling one to
   * #c2405c, so green is back for increases — superseding the earlier decision
   * to colour only what was behind.
   *
   * `sentimentFor` is what keeps this honest: it reads the measure's own
   * `higher_is_better`, so "good" means a rise on a measure where rising is
   * good, not merely a bigger number. Where the business has not defined a
   * direction the figure stays neutral, because the artifact only ever draws
   * revenue and has nothing to say about a measure nobody has scored.
   *
   * The word still travels with the colour in the screen-reader text below, so
   * the meaning never rests on hue alone.
   */
  const toneClass =
    sentiment === "good"
      ? "text-delta-up"
      : sentiment === "bad"
        ? "text-measure-flagged-foreground"
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
  windowShortLabel,
  className,
}: {
  kpis: DashboardKpi[];
  /** The selected comparison, named on every card so the change is unambiguous. */
  windowShortLabel: string;
  className?: string;
}) {
  if (kpis.length === 0) return null;

  return (
    /*
      ONE PANEL ON HAIRLINES, not four cards — the direction's stat treatment,
      reaching the reporting hub.

      WHAT DID NOT CHANGE: the breakdown under each figure. The salon count, the
      named comparison and the "Unavailable" reasons are the whole reason these
      figures can be quoted in a meeting, so the treatment moved and the
      information stayed. Flattening them into a bare label-and-number would
      have matched the mockup and lost the thing that makes them safe.
    */
    <div
      className={cn(
        "grid grid-cols-1 rounded-2xl border border-border bg-surface py-4 shadow-raised sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {kpis.map((kpi) => (
        <div key={kpi.metricCode} className="stat-cell">
          <div className="space-y-2 py-1">
            <p className="eyebrow">{kpi.label}</p>

            {/*
              THE HEADLINE IS ROUNDED; THE EXACT FIGURE SITS UNDER IT IN MONO.

              The artifact sets `$7.49M` at display size with
              `$7,487,004.01` beneath it in monospace. Full precision as the
              headline — which is what this was — is unreadable at a glance and
              implies a precision nobody needs in order to act.

              NOTHING IS HIDDEN. Both numbers are on screen, and the mono line
              is how the design signals "this is the figure exactly as the
              source reported it" rather than a presentation of it. The mono
              line is omitted where rounding changes nothing, because printing
              the same string twice in two faces reads as two measurements.
            */}
            <p className="display-figure text-[30px] text-foreground">
              {kpi.current.value === null
                ? "Unavailable"
                : formatMetricValue(kpi.current.value, kpi.unit, { compact: true })}
            </p>
            {(() => {
              if (kpi.current.value === null) return null;
              const rounded = formatMetricValue(kpi.current.value, kpi.unit, {
                compact: true,
              });
              const exact = formatMetricValue(kpi.current.value, kpi.unit);
              if (rounded === exact) return null;
              return (
                <p className="font-mono text-[10px] text-subtle-foreground tabular-nums">
                  {exact}
                </p>
              );
            })()}

            <div className="flex flex-wrap items-center gap-2">
              <ChangeIndicator
                value={kpi.change.value}
                higherIsBetter={kpi.higherIsBetter}
                fallback={kpi.supported ? "No comparison available" : "Not reported"}
              />
              {kpi.change.value !== null ? (
                <span className="text-xs text-muted-foreground">{windowShortLabel}</span>
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
              <div className="flex items-baseline justify-between gap-2">
                <dt>Salons reporting</dt>
                <dd className="tabular-nums">{kpi.salonCount}</dd>
              </div>
            </dl>

            {!kpi.supported ? (
              <p className="text-xs text-subtle-foreground">{kpi.change.note}</p>
            ) : kpi.current.unavailableReason ? (
              <p className="text-xs text-subtle-foreground">{kpi.current.unavailableReason}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
