import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollTable } from "@/components/ui/layout";
import { formatMetricValue } from "@/lib/reporting/read/aggregation";
import type { SalonRankingRow } from "@/lib/reporting/read/dashboard";
import type { ReportMetricUnit } from "@/lib/reporting/types";

/**
 * THE RANKING TABLE — the accessible view of every chart above it.
 *
 * The charts are the quick read; this is the one that can be checked, sorted,
 * copied into a note and read by a screen reader. Any figure visible in a bar
 * is legible here as text, which is what keeps the visual layer from being the
 * only way to get at the data.
 *
 * Rank and quintile are shown EXACTLY as the source reported them, against the
 * whole chain. They are not recomputed from the salons in view: a 15-salon
 * recomputation would disagree with the workbook and with every other report
 * built from it.
 *
 * Each row links to the salon's drill-down route. The route is prepared here
 * and built in 6C; the link carries the active filters so arriving there keeps
 * the view a manager was looking at.
 */

export function RankingTable({
  rows,
  unit,
  metricLabel,
  currentYear,
  baselineYear,
  drilldownHref,
}: {
  rows: SalonRankingRow[];
  unit: ReportMetricUnit;
  metricLabel: string;
  currentYear: number;
  baselineYear: number;
  /** Builds the per-salon link, preserving filter state. */
  drilldownHref: (salonNumber: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No salons match the current filters.
      </p>
    );
  }

  return (
    <ScrollTable>
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">
          {metricLabel} by salon for the salons in this report, with the {baselineYear} baseline
          and the reported change. Rank and quintile are as reported by the source against the
          whole chain.
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">Salon</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{currentYear}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{baselineYear}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Change</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Rank
              <span className="sr-only"> as reported by the source</span>
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">Quintile</th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Open salon detail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.salonNumber} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="font-medium tabular-nums text-foreground">
                  {row.salonNumber}
                </span>
                <span className="ml-2 text-muted-foreground">{row.storeName}</span>
                {row.districtLabel ? (
                  <span className="block text-xs text-subtle-foreground">
                    {row.districtLabel}
                  </span>
                ) : null}
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">
                {row.current === null ? (
                  <span className="text-muted-foreground">Unavailable</span>
                ) : (
                  formatMetricValue(row.current, unit)
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {/* Absent baseline is stated, never rendered as zero. */}
                {row.baseline === null ? (
                  <span className="text-muted-foreground">Unavailable</span>
                ) : (
                  formatMetricValue(row.baseline, unit)
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
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
              <td className="py-2 pr-3 text-right tabular-nums">
                {row.revenueRank === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  `#${row.revenueRank}`
                )}
              </td>
              <td className="py-2 pr-3">
                {row.quintileGroup ? (
                  <Badge tone="neutral">{row.quintileGroup}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-2 text-right">
                <Link
                  href={drilldownHref(row.salonNumber)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Detail
                  <ChevronRight aria-hidden className="size-3" />
                  <span className="sr-only">for salon {row.salonNumber}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
