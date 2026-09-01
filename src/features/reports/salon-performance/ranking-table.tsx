import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollTable } from "@/components/ui/layout";
import { formatMetricValue } from "@/lib/reporting/read/aggregation";
import type { SalonRankingRow, RankingSortField } from "@/lib/reporting/read/dashboard";
import type { ReportMetricUnit } from "@/lib/reporting/types";

/**
 * THE DETAIL TABLE — the accessible view of every chart above it.
 *
 * The charts are the quick read; this is the one that can be checked, sorted,
 * copied into a note and read by a screen reader. Any figure visible in a bar is
 * legible here as text, which is what keeps the visual layer from being the only
 * way to get at the data.
 *
 * Rank and quintile are shown EXACTLY as the source reported them, against the
 * whole chain. They are not recomputed from the salons in view: a 15-salon
 * recomputation would disagree with the workbook and with every other report
 * built from it.
 *
 * Sorting is links, not client state, so the sorted view is part of the URL a
 * manager shares — and `scroll={false}` keeps the page where it was, because
 * sorting a table you are reading should not throw you back to the header.
 */

interface SortLinkProps {
  field: RankingSortField;
  label: string;
  activeField: RankingSortField;
  direction: "asc" | "desc";
  href: (field: RankingSortField) => string;
  align?: "left" | "right";
}

function SortLink({ field, label, activeField, direction, href, align }: SortLinkProps) {
  const active = activeField === field;
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <Link
      href={href(field)}
      scroll={false}
      className={
        "inline-flex items-center gap-1 underline-offset-4 hover:underline " +
        (active ? "text-foreground" : "hover:text-foreground") +
        (align === "right" ? " flex-row-reverse" : "")
      }
      aria-label={
        active
          ? `${label}, sorted ${direction === "asc" ? "ascending" : "descending"}. Reverse the order.`
          : `Sort by ${label}`
      }
    >
      {label}
      {active ? <Icon aria-hidden className="size-3" /> : null}
    </Link>
  );
}

export function RankingTable({
  rows,
  unit,
  metricLabel,
  currentLabel,
  baselineLabel,
  sort,
  direction,
  sortHref,
}: {
  rows: SalonRankingRow[];
  unit: ReportMetricUnit;
  metricLabel: string;
  currentLabel: string;
  /** Null when the selected window has no comparison; those columns disappear. */
  baselineLabel: string | null;
  sort: RankingSortField;
  direction: "asc" | "desc";
  /** Builds a sort link, preserving every other filter. */
  sortHref: (field: RankingSortField) => string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No salons match the current filters.
      </p>
    );
  }

  const comparing = baselineLabel !== null;

  return (
    <ScrollTable>
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">
          {metricLabel} by salon for the salons in this report
          {comparing ? `, with the ${baselineLabel} comparison and the reported change` : ""}.
          Rank and quintile are as reported by the source against the whole chain.
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              <SortLink
                field="salon"
                label="Salon"
                activeField={sort}
                direction={direction}
                href={sortHref}
              />
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              <SortLink
                field="value"
                label={currentLabel}
                activeField={sort}
                direction={direction}
                href={sortHref}
                align="right"
              />
            </th>
            {comparing ? (
              <>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {baselineLabel}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  <SortLink
                    field="change"
                    label="Change"
                    activeField={sort}
                    direction={direction}
                    href={sortHref}
                    align="right"
                  />
                </th>
              </>
            ) : null}
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Rank
              <span className="sr-only"> as reported by the source</span>
            </th>
            <th scope="col" className="py-2 font-medium">Quintile</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.salonNumber} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                {/* tabular-nums and text throughout: '0468' keeps its zero. */}
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
              {comparing ? (
                <>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {/* Absent comparison is stated, never rendered as zero. */}
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
                </>
              ) : null}
              <td className="py-2 pr-3 text-right tabular-nums">
                {row.revenueRank === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  `#${row.revenueRank}`
                )}
              </td>
              <td className="py-2">
                {row.quintileGroup ? (
                  <Badge tone="neutral">{row.quintileGroup}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
