import { ScrollTable } from "@/components/ui/layout";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
import type { SalonWindowComparison } from "@/lib/reporting/read/salon-detail";
import type { ReportMetricUnit } from "@/lib/reporting/types";
import { cn } from "@/lib/utils/cn";
import { MetricLineage } from "./metric-lineage";

/**
 * ONE MEASURE AGAINST EVERY COMPARISON THE REPORT OFFERS.
 *
 * The numbers behind the paired bars, which the chart cannot show: the exact
 * figures, the change, and where each one came from. A manager who wants to
 * know whether the trailing-window figure is bigger because the window is
 * longer can read the two columns side by side.
 *
 * EACH ROW NAMES ITS OWN TWO HEADINGS. A year comparison reads `2026` against
 * `2024`; a trailing one reads `Current year, last 3 months` against `Prior
 * year, last 3 months`. Sharing one pair of column headers across the table
 * would be wrong on at least one row, and wrong in the direction that looks
 * right.
 *
 * A COMPARISON THE SOURCE DOES NOT REPORT IS STILL LISTED, and says so. Hiding
 * it would leave a manager wondering whether `Last 9 Months` exists; saying
 * "not reported for this measure" answers the question they actually have.
 */
export function SalonComparisonTable({
  comparisons,
  unit,
  metricLabel,
  higherIsBetter,
  sourceReport,
}: {
  comparisons: SalonWindowComparison[];
  unit: ReportMetricUnit;
  metricLabel: string;
  /** Null where the business has not defined a direction. Never coloured then. */
  higherIsBetter: boolean | null;
  sourceReport: string | null;
}) {
  if (comparisons.length === 0) return null;

  return (
    <ScrollTable>
      <table className="w-full min-w-[620px] text-sm">
        <caption className="sr-only">
          {metricLabel} for this salon under each comparison this report offers. Each row
          names the two figures it compares. Not a trend — every figure describes one
          reporting period.
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              Comparison
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Current
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Compared with
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Change
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Source</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((row) => {
            const sentiment = sentimentFor(row.change, higherIsBetter);
            return (
              <tr
                key={row.windowId}
                className="border-b border-border/60 last:border-0 align-top"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="font-medium text-foreground">{row.windowShortLabel}</span>
                  {!row.supported ? (
                    <span className="block text-xs text-subtle-foreground">
                      Not reported for {metricLabel}
                    </span>
                  ) : (
                    <span className="block text-xs text-subtle-foreground">
                      {row.currentLabel}
                      {row.baselineLabel ? ` vs ${row.baselineLabel}` : ""}
                    </span>
                  )}
                </th>

                <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                  {row.current.value === null ? (
                    <span className="text-muted-foreground">Unavailable</span>
                  ) : (
                    formatMetricValue(row.current.value, unit)
                  )}
                </td>

                <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                  {/* Absent, not zero. */}
                  {row.baseline === null || row.baseline.value === null ? (
                    <span className="text-muted-foreground">Unavailable</span>
                  ) : (
                    formatMetricValue(row.baseline.value, unit)
                  )}
                </td>

                <td
                  className={cn(
                    "py-2 pr-3 text-right tabular-nums",
                    sentiment === "good"
                      ? "text-[var(--stc-sage)]"
                      : sentiment === "bad"
                        ? "text-[var(--stc-brick)]"
                        : "text-muted-foreground",
                  )}
                >
                  {row.change === null ? (
                    <span className="text-muted-foreground">Unavailable</span>
                  ) : (
                    <>
                      {formatMetricValue(row.change, "percent")}
                      {row.changeSource === "derived" ? (
                        <span
                          className="ml-1 text-subtle-foreground"
                          title="Computed from the two figures in this report, because the source did not state a change."
                        >
                          *
                        </span>
                      ) : null}
                    </>
                  )}
                </td>

                <td className="py-2">
                  <MetricLineage
                    label={metricLabel}
                    windowLabel={row.windowLabel}
                    figures={[
                      { heading: row.currentLabel, figure: row.current },
                      ...(row.baseline && row.baselineLabel
                        ? [{ heading: row.baselineLabel, figure: row.baseline }]
                        : []),
                    ]}
                    sourceReport={sourceReport}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}
