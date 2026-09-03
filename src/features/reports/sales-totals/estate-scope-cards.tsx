import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { SalesTotalsSubject } from "@/lib/reporting/read/sales-totals-read";
import { figureHeading } from "@/lib/reporting/read/sales-totals-aggregate";
import type { SalesTotalsMeasure } from "@/lib/reporting/sales-totals/metric-map";

import { formatSalesTotalsValue } from "./format";

/**
 * THE SOURCE ESTATE, AND WHY IT LOOKS DELIBERATELY DIFFERENT.
 *
 * These figures describe the whole chain — 249 salons, split 98 consolidated
 * and 151 franchised — and they are PER-SALON AVERAGES, not totals. Verified
 * against both real reports:
 *
 *     (98 x 734.50 + 151 x 872.94) / 249 = 818.4536
 *     All Salons reported                  818.45      <- the average
 *     98 + 151 summed                    1,607.44      <- not this
 *
 * That is the defect this section fixes. Labelled "Grand Total", $734.50 sat
 * beside one salon's $958.79 and read as a consolidated total smaller than one
 * of its members — so the dashboard looked mathematically wrong. It was the
 * label that was wrong.
 *
 * VISUALLY SEPARATED ON PURPOSE, not just re-worded. A muted panel, a heading
 * that names the population, and the salon count on every card, because the
 * previous version explained the distinction in a paragraph and a paragraph is
 * not something an executive reads before misreading a number.
 *
 * These cards are read-only context. Nothing here is summed, combined, or
 * derived from the delivered salons, and no control makes it look otherwise.
 */
export function EstateScopeCards({
  scopes,
  activeScopeKey,
  metric,
  deliverySalonCount,
}: {
  scopes: readonly SalesTotalsSubject[];
  activeScopeKey: string | null;
  metric: SalesTotalsMeasure;
  deliverySalonCount: number;
}) {
  if (scopes.length === 0) return null;

  const heading = figureHeading(metric, "summary", 0);

  return (
    <section className="space-y-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">
          Source estate averages — a different population
        </h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-snug text-muted-foreground">
          The report also states figures for the whole chain. These are{" "}
          <strong className="font-medium text-foreground">averages per salon</strong>, across
          every salon in that scope — not totals, and not comparable with the{" "}
          {deliverySalonCount} salons above. The source column is named &ldquo;
          {metric.header}&rdquo;; the value it holds is an average.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {scopes.map((scope) => {
          const figure = scope.figures.find((entry) => entry.metricCode === metric.code);
          const active = scope.key === activeScopeKey;

          return (
            <Card
              key={scope.key}
              className={cn(
                "bg-surface",
                // The scope the filter is on, so the control visibly does
                // something even though these cards are context.
                active && "ring-1 ring-selected",
              )}
            >
              <CardContent className="space-y-1 p-4">
                <p className="eyebrow">{scope.label}</p>
                <p
                  className={cn(
                    "text-[21px] leading-none font-semibold tabular-nums",
                    figure?.value == null ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {figure?.value == null
                    ? "Unavailable"
                    : formatSalesTotalsValue(figure.value, metric.unit)}
                </p>
                {/* The label that makes the number honest, on every card rather
                    than once at the top where it can be scrolled past. */}
                <p className="text-[11px] text-muted-foreground">
                  {heading}
                  {scope.salonCount ? (
                    <>
                      {" · "}
                      <span className="tabular-nums">{scope.salonCount}</span> salons
                    </>
                  ) : null}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/*
        The one thing a reader might otherwise try to do with these numbers.
        Said once, here, where the numbers are.
      */}
      <p className="text-[11px] leading-snug text-subtle-foreground">
        STC Consolidated and STC Franchisees are both contained in All Salons, so they are
        not added together. All {deliverySalonCount} salons in this delivery are
        franchised, which is why no consolidated salon appears above.
      </p>
    </section>
  );
}
