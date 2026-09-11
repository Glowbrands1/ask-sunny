import { ScrollTable } from "@/components/ui/layout";
import { formatNumber, formatPercent } from "@/lib/utils/format";
import {
  CATEGORY_FEATURE,
  categoryLabel,
  featureLabel,
  isActivityCategory,
} from "@/lib/analytics/taxonomy";
import type { BreakdownRow } from "@/lib/analytics/queries";
import { changeAgainst } from "@/lib/analytics/queries";

/**
 * WHAT ASK SUNNY IS ACTUALLY USED FOR.
 *
 * Horizontal ranked bars over a table, because the question is comparative —
 * "which of these is biggest" — and a bar answers it before the number is read.
 *
 * EVERY BAR IS THE SAME COLOUR. Rank does not change a fill here, which is the
 * frozen rule and also the honest one: in the reference screenshots each row
 * carries its own hue, and since the hues track position rather than meaning,
 * the reader learns a colour code that says nothing. One fill, and the length
 * carries the whole comparison.
 */
export function UsageTypesPanel({
  rows,
  previousRows,
  total,
}: {
  rows: BreakdownRow[];
  previousRows: BreakdownRow[];
  total: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity was recorded in this window, so there is nothing to break
        down yet.
      </p>
    );
  }

  const previousByKey = new Map(previousRows.map((row) => [row.key, row.events]));
  const largest = Math.max(...rows.map((row) => row.events), 1);

  return (
    <ScrollTable>
      <table className="data-table min-w-[720px]">
        <caption className="sr-only">
          Recorded activity by request type, with share of total and change
          against the prior period.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3">Request type</th>
            <th scope="col" className="pr-3">Area</th>
            <th scope="col" data-align="right" className="pr-3">Activity</th>
            <th scope="col" className="pr-3 w-[28%]">Share</th>
            <th scope="col" data-align="right" className="pr-3">Leaders</th>
            <th scope="col" data-align="right" className="pr-3">Locations</th>
            <th scope="col" data-align="right" className="pr-3">vs prior</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const share = total > 0 ? row.events / total : 0;
            const change = changeAgainst(
              row.events,
              previousByKey.get(row.key) ?? 0,
            );
            return (
              <tr key={row.key}>
                <th scope="row" className="pr-3 font-medium">
                  {categoryLabel(row.key)}
                </th>
                <td className="pr-3 text-muted-foreground">
                  {isActivityCategory(row.key)
                    ? featureLabel(CATEGORY_FEATURE[row.key])
                    : "—"}
                </td>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.events)}
                </td>
                <td className="pr-3">
                  <div className="flex items-center gap-2">
                    {/*
                      The bar is scaled to the LARGEST row, not to the total, so
                      the ranking stays legible when one category dominates —
                      at 3% of the total every remaining bar would otherwise be
                      a hairline. The percentage beside it is the true share.
                    */}
                    <div
                      className="h-1.5 min-w-[2px] flex-1 overflow-hidden rounded-full"
                      style={{ background: "var(--measure-data-track)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (row.events / largest) * 100)}%`,
                          background: "var(--measure-data)",
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {formatPercent(share * 100)}
                    </span>
                  </div>
                </td>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.activeUsers)}
                </td>
                <td data-align="right" className="pr-3 tabular-nums">
                  {formatNumber(row.activeSalons)}
                </td>
                <td
                  data-align="right"
                  className="pr-3 tabular-nums text-muted-foreground"
                >
                  {/*
                    A dash where the prior window held none of this category.
                    "+100%" from a base of zero is not a trend, and every
                    four-figure percentage on a dashboard is one of these.
                  */}
                  {change === null
                    ? "—"
                    : `${change > 0 ? "+" : ""}${Math.round(change)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/**
 * WHICH PARTS OF THE APP PEOPLE OPEN AT ALL.
 *
 * A coarser split than the categories — five areas rather than fourteen types —
 * and it answers a different question: not "what are they asking about" but
 * "which of the things we built is anybody using".
 */
export function FeatureUsagePanel({
  rows,
  total,
}: {
  rows: BreakdownRow[];
  total: number;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {rows.map((row) => (
        <div
          key={row.key}
          className="rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3.5 shadow-soft"
        >
          <p className="eyebrow">{featureLabel(row.key)}</p>
          <p className="display-figure mt-1.5 text-[26px] text-foreground">
            {formatNumber(row.events)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {total > 0 ? formatPercent((row.events / total) * 100) : "0%"} of
            activity · {formatNumber(row.activeUsers)}{" "}
            {row.activeUsers === 1 ? "leader" : "leaders"}
          </p>
        </div>
      ))}
    </div>
  );
}
