import Link from "next/link";

import { ScrollTable } from "@/components/ui/layout";
import { isCounting } from "@/lib/reviews/goal";
import {
  reviewsHref,
  WEEK_LAST_SIX_MONTHS,
  WEEK_LAST_THREE_MONTHS,
  WEEK_YEAR_TO_DATE,
  type ReviewFilters,
} from "@/lib/reviews/filters";
import {
  formatProgressMonth,
  type MonthlyProgress,
  type MonthlyProgressRow,
} from "@/lib/reviews/monthly-progress";
import type { LocationRollup } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

/**
 * ============================================================================
 * MONTH BY MONTH — QUALIFYING REVIEWS PER SALON, WITH L3, L6 AND YTD
 * ============================================================================
 *
 * A manager asked for "the last three full months so we can get a broader
 * overall understanding and see progress", then for it per month: L3, L6 and
 * YTD. One column per month, then the three totals. Every total links to the
 * reviews behind it, through the same Week filter (`3months`, `6months`,
 * `ytd`) the records view offers, so the number and the list agree.
 *
 * A month at or over the monthly target is set heavier; the current month is
 * marked "to date" because it is not finished. A salon that is not counting
 * shows dashes, as the goal table does: its zero would be the configuration's,
 * not the salon's.
 */
export function ReviewsMonthlyTable({
  monthly,
  locations,
  filters,
  target,
}: {
  monthly: MonthlyProgress | null;
  locations: readonly LocationRollup[];
  filters: ReviewFilters;
  /** Qualifying reviews a salon is asked for each month. */
  target: number;
}) {
  if (!monthly) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-[12px] text-muted-foreground shadow-raised">
        The month-by-month figures could not be loaded just now. The rest of the page is
        unaffected; reload to try again.
      </p>
    );
  }

  const byCode = new Map(locations.map((location) => [location.storeCode, location]));
  const rows = monthly.rows.filter((row) => byCode.has(row.storeCode));
  const firstYear = monthly.months[0].slice(0, 4);
  const totals: { key: "l3" | "l6" | "ytd"; label: string; detail: string; week: string; months: number }[] = [
    {
      key: "l3",
      label: "L3",
      detail: span(monthly.l3Months),
      week: WEEK_LAST_THREE_MONTHS,
      months: monthly.l3Months.length,
    },
    {
      key: "l6",
      label: "L6",
      detail: span(monthly.l6Months),
      week: WEEK_LAST_SIX_MONTHS,
      months: monthly.l6Months.length,
    },
    {
      key: "ytd",
      label: "YTD",
      detail: `${span(monthly.ytdMonths)}, to date`,
      week: WEEK_YEAR_TO_DATE,
      months: monthly.ytdMonths.length,
    },
  ];

  const cells = (row: MonthlyProgressRow, storeCode: string | null, counting: boolean) => (
    <>
      {row.months.map((count, position) => (
        <td key={monthly.months[position]} data-align="right" className="tabular-nums">
          {counting ? (
            <span
              className={cn(
                count >= target ? "font-black text-foreground" : "text-foreground",
                count === 0 && "text-muted-foreground",
              )}
            >
              {formatNumber(count)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      ))}
      {totals.map((total) => (
        <td key={total.key} data-align="right" className="tabular-nums">
          {counting ? (
            <Link
              href={reviewsHref({
                ...filters,
                tab: "reviews",
                storeCode: storeCode ?? filters.storeCode,
                week: total.week,
                qualifying: "yes",
              })}
              className="inline-flex min-h-6 min-w-6 items-center justify-end text-[13px] font-black text-foreground hover:underline"
            >
              {formatNumber(row[total.key])}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      ))}
    </>
  );

  return (
    <section
      aria-labelledby="monthly-progress-heading"
      className="min-w-0 rounded-[var(--radius-lg)] border border-border bg-surface shadow-raised"
    >
      <div className="px-[18px] pt-4 pb-2">
        <h3 id="monthly-progress-heading" className="eyebrow">
          Month by month · L3, L6 and YTD
        </h3>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          Qualifying reviews (3–5★) each month, counted the same way as month to date.
          L3 and L6 are the last 3 and 6 full months; the current month is not in them.
          Target {target} a month: {target * 3} for L3, {target * 6} for L6. Months at or
          over target are bold. Select a total to see its reviews.
        </p>
      </div>
      <ScrollTable>
        <table aria-label="Qualifying reviews by month" className="data-table min-w-[60rem]">
          <thead>
            <tr>
              <th scope="col" className="min-w-[13rem]">
                Salon
              </th>
              {monthly.months.map((month) => (
                <th key={month} scope="col" data-align="right">
                  {formatProgressMonth(month, month.slice(0, 4) !== firstYear || month === monthly.months[0])}
                  {month === monthly.currentMonth ? (
                    <span className="block text-[10px] font-normal text-muted-foreground">to date</span>
                  ) : null}
                </th>
              ))}
              {totals.map((total) => (
                <th
                  key={total.key}
                  scope="col"
                  data-align="right"
                  className="shadow-[inset_0_3px_0_var(--selected)]"
                >
                  {total.label}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {total.detail}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const location = byCode.get(row.storeCode)!;
              return (
                <tr key={row.storeCode}>
                  <th scope="row" className="text-left text-[12px] font-bold">
                    {location.locationName}
                    <span className="block text-[10.5px] font-normal text-muted-foreground">
                      {row.storeCode}
                      {isCounting(location) ? "" : " · not counting"}
                    </span>
                  </th>
                  {cells(row, row.storeCode, isCounting(location))}
                </tr>
              );
            })}
          </tbody>
          {rows.length > 1 ? (
            <tfoot>
              <tr>
                <th scope="row" className="text-left text-[12px] font-black">
                  All salons shown
                </th>
                {/* Counting salons only: a dash above is not a zero to add. */}
                {cells(
                  sumRows(
                    rows.filter((row) => isCounting(byCode.get(row.storeCode)!)),
                    monthly.months.length,
                  ),
                  null,
                  true,
                )}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </ScrollTable>
    </section>
  );
}

/** "Aug – Oct" for a run of `yyyy-mm`, with years when it crosses one. */
function span(months: readonly string[]): string {
  if (months.length === 0) return "none yet";
  const first = months[0];
  const last = months[months.length - 1];
  const crosses = first.slice(0, 4) !== last.slice(0, 4);
  if (first === last) return formatProgressMonth(first, true);
  return `${formatProgressMonth(first, crosses)} – ${formatProgressMonth(last, true)}`;
}

/** The rows on screen added up: the footer follows the table, not the estate. */
function sumRows(rows: readonly MonthlyProgressRow[], length: number): MonthlyProgressRow {
  const add = (pick: (row: MonthlyProgressRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    storeCode: "all",
    months: Array.from({ length }, (_, position) => add((row) => row.months[position])),
    l3: add((row) => row.l3),
    l6: add((row) => row.l6),
    ytd: add((row) => row.ytd),
  };
}
