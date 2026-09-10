import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";

import { ScrollTable } from "@/components/ui/layout";
import { QuintileChip, quintileTone } from "@/components/ui/marquee";
import { cn } from "@/lib/utils/cn";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
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
  higherIsBetter = null,
  sort,
  direction,
  sortHref,
  salonHref,
}: {
  rows: SalonRankingRow[];
  unit: ReportMetricUnit;
  metricLabel: string;
  currentLabel: string;
  /** Null when the selected window has no comparison; those columns disappear. */
  baselineLabel: string | null;
  /**
   * Whether a rise in this measure is a good thing.
   *
   * Defaults to "we do not know", which leaves the change column uncoloured.
   */
  higherIsBetter?: boolean | null;
  sort: RankingSortField;
  direction: "asc" | "desc";
  /** Builds a sort link, preserving every other filter. */
  sortHref: (field: RankingSortField) => string;
  /**
   * Builds the drill-down link for a salon, preserving the dashboard's context.
   *
   * Optional so the table stays usable in a context with no detail page, and
   * so the salon cell degrades to plain text rather than to a dead link.
   */
  salonHref?: (salonNumber: string) => string;
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
      {/* The shared `.data-table` treatment, so this table and the others in
          the hub are the same table rather than four that resemble each other. */}
      <table className="data-table min-w-[720px]">
        <caption className="sr-only">
          {metricLabel} by salon for the salons in this report
          {comparing ? `, with the ${baselineLabel} comparison and the reported change` : ""}.
          Rank and quintile are as reported by the source against the whole chain.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3">
              <SortLink
                field="salon"
                label="Salon"
                activeField={sort}
                direction={direction}
                href={sortHref}
              />
            </th>
            <th scope="col" data-align="right" className="pr-3">
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
                <th scope="col" data-align="right" className="pr-3">
                  {baselineLabel}
                </th>
                <th scope="col" data-align="right" className="pr-3">
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
            <th scope="col" data-align="right" className="pr-3">
              Rank
              <span className="sr-only"> as reported by the source</span>
            </th>
            <th scope="col" className="">Quintile</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.salonNumber}>
              <th scope="row" className="pr-3 text-left font-normal">
                {/*
                  The drill-down. tabular-nums and text throughout: '0468' keeps
                  its zero, in the cell and in the href it builds.
                */}
                {salonHref ? (
                  <Link
                    href={salonHref(row.salonNumber)}
                    className="rounded-[var(--radius-xs)] underline decoration-border-strong decoration-1 underline-offset-2 outline-none transition-colors hover:decoration-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="font-medium tabular-nums text-foreground">
                      {row.salonNumber}
                    </span>
                    <span className="ml-2 text-muted-foreground">{row.storeName}</span>
                  </Link>
                ) : (
                  <>
                    <span className="font-medium tabular-nums text-foreground">
                      {row.salonNumber}
                    </span>
                    <span className="ml-2 text-muted-foreground">{row.storeName}</span>
                  </>
                )}
                {row.districtLabel ? (
                  <span className="block text-xs text-subtle-foreground">
                    {row.districtLabel}
                  </span>
                ) : null}
              </th>
              <td data-align="right" className="pr-3">
                {row.current === null ? (
                  <span className="text-muted-foreground">Unavailable</span>
                ) : (
                  formatMetricValue(row.current, unit)
                )}
              </td>
              {comparing ? (
                <>
                  <td data-align="right" className="pr-3">
                    {/* Absent comparison is stated, never rendered as zero. */}
                    {row.baseline === null ? (
                      <span className="text-muted-foreground">Unavailable</span>
                    ) : (
                      formatMetricValue(row.baseline, unit)
                    )}
                  </td>
                  <td data-align="right" className="pr-3">
                    {row.change === null ? (
                      <span className="text-muted-foreground">Unavailable</span>
                    ) : (
                      <>
                        {/*
                          THE CHANGE COLUMN IS THE ONE COLOURED COLUMN, and it
                          follows the same rule the KPI row follows: only a
                          measure that is actually BEHIND takes colour. A rise
                          stays neutral, and so does a fall on a measure whose
                          direction the business has not defined — colouring
                          either would assert something nobody has stated.

                          Coral is the direction's only measure colour, so this
                          reintroduces no hue. The signed number still carries
                          the reading, which is what keeps the column legible in
                          greyscale and in print.
                        */}
                        <span
                          className={cn(
                            "font-bold",
                            sentimentFor(row.change, higherIsBetter) === "good"
                              ? "text-delta-up"
                              : sentimentFor(row.change, higherIsBetter) === "bad"
                                ? "text-measure-flagged-foreground"
                                : "text-foreground",
                          )}
                        >
                          {formatMetricValue(row.change, "percent")}
                        </span>
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
              <td data-align="right" className="pr-3">
                {row.revenueRank === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  `#${row.revenueRank}`
                )}
              </td>
              <td>
                {row.quintileGroup ? (
                  <QuintileChip tone={quintileTone(row.quintileGroup)}>
                    {row.quintileGroup}
                  </QuintileChip>
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
