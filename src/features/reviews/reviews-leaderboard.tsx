"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  formatGoalMonth,
  GOAL_STATUS_LABEL,
  goalStatus,
  goalSummary,
  rankLocations,
  type GoalStatus,
  type ReviewGoalContext,
} from "@/lib/reviews/goal";
import { StatusChip } from "@/components/ui/marquee";
import { reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import {
  formatLongMonth,
  isSingleMonthPeriod,
  leaderboardPeriodLabel,
  leaderboardPeriodOf,
  leaderboardPeriodView,
  leaderboardPeriodWeek,
} from "@/lib/reviews/leaderboard-period";
import { formatProgressMonth, type MonthlyProgress } from "@/lib/reviews/monthly-progress";
import type { LocationRollup } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import {
  AnchorMarker,
  districtsOf,
  GoalProgressBar,
  GoalStatusChip,
  matchesSalon,
  SalonSearch,
  TableSelect,
} from "./review-goal-parts";

/**
 * ============================================================================
 * THE SALON LEADERBOARD — WHO IS CLOSEST TO TEN THIS MONTH
 * ============================================================================
 *
 * Asked for by Gwen Harlan (October 2026): "I want the team to be able
 * to hop on the leaderboard and see how many each store has gotten to their
 * required 10 reviews/month." So the leaderboard is now a RANKING by qualifying
 * reviews month to date, each salon drawn against the monthly target.
 *
 * MONTHLY ONLY (November 2026). Pau: "for google reviews can you make it
 * monthly not weekly … i mean salon leaderboard". The "This week" column and
 * the "Rank by this week" toggle are gone; the goal is monthly, so the board
 * is too. Salons tied on the month still share a rank.
 *
 * THIS MONTH, L3, L6 OR YTD (Pau, 23 Nov 2026: "they dont want week, they want
 * per month, per 3 months per 6 months and YTD pls and then let it show in the
 * data below"). The toolbar's Period control picks the window; the ranking,
 * the figure, the bar, the status and the summary above all follow it. L3 / L6
 * / YTD are the Month by month table's totals against the target times the
 * months covered (`lib/reviews/leaderboard-period.ts`); a closed window has no
 * pace, so its status is Goal met or Below goal.
 *
 * ONE MONTH (Pau, 23 Nov 2026: "pls add the per month for both like September
 * october november and make sure it syncs in the data below"). Period also
 * lists each full month; picking October ranks by October's figure from the
 * Month by month table against the monthly target, and every row's figure,
 * bar, status and link follow it.
 *
 * WHAT IT NO LONGER SHOWS: Unanswered, "Replies waiting", All this week and
 * Last week. The response queue is the Needs Response view's job.
 *
 * THE RANK IS A COMPETITION RANK and a salon with no baseline has none — see
 * `rankLocations`. Nothing on this screen computes a salon's figures; the
 * rollups arrive from the read layer exactly as the Overview's table reads them.
 *
 * WHO SEES WHICH SALONS IS UNCHANGED. The rows are whatever the page's
 * snapshot holds for this reader, under the same `view_google_reviews` gate
 * and the same toolbar filters as before; this file narrows nothing and
 * widens nothing.
 */

const STATUS_FILTERS: { key: "all" | GoalStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "met", label: GOAL_STATUS_LABEL.met },
  { key: "on_pace", label: GOAL_STATUS_LABEL.on_pace },
  { key: "behind_pace", label: GOAL_STATUS_LABEL.behind_pace },
  { key: "not_counting", label: GOAL_STATUS_LABEL.not_counting },
];

/*
 * ONE GRID FOR THE HEADER AND EVERY ROW, so a figure sits under its heading.
 * On a phone the row restacks into a card: rank down the left, then the salon,
 * its status, the two figures side by side, and the bar across the width.
 */
const ROW_GRID =
  "grid gap-x-3 gap-y-2 px-4 grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1fr)] " +
  "[grid-template-areas:'rank_salon_salon'_'rank_status_status'_'rank_month_month'_'rank_bar_bar'] " +
  "lg:grid-cols-[3.5rem_minmax(0,1.5fr)_7rem_minmax(11rem,1.5fr)_7.5rem] " +
  "lg:[grid-template-areas:'rank_salon_month_bar_status'] lg:items-center";

type BoardStatus = GoalStatus | "below";

const BELOW_GOAL_LABEL = "Below goal";

export function ReviewsLeaderboard({
  locations: monthLocations,
  filters,
  goal: monthGoal,
  monthly = null,
  canManageAnchors,
}: {
  locations: LocationRollup[];
  filters: ReviewFilters;
  goal: ReviewGoalContext;
  /** The month-by-month figures L3, L6, YTD and single months are read from. */
  monthly?: MonthlyProgress | null;
  canManageAnchors: boolean;
}) {
  const [status, setStatus] = useState<"all" | BoardStatus>("all");
  const [district, setDistrict] = useState("all");
  const [search, setSearch] = useState("");

  const period = leaderboardPeriodOf(filters.week);
  const view = useMemo(
    () => leaderboardPeriodView(period, monthLocations, monthGoal, monthly),
    [period, monthLocations, monthGoal, monthly],
  );
  const locations = view?.locations ?? monthLocations;
  const goal = view?.goal ?? monthGoal;
  const paced = view?.paced ?? true;
  const periodWeek = leaderboardPeriodWeek(period);
  const periodLabel = leaderboardPeriodLabel(period);
  const singleMonth = isSingleMonthPeriod(period);

  const districts = useMemo(() => districtsOf(locations), [locations]);
  const ranked = useMemo(() => rankLocations(locations, "month"), [locations]);
  const summary = useMemo(() => goalSummary(locations, goal), [locations, goal]);

  /* A closed window has no pace: below the target is "Below goal", never "On pace". */
  const statusOf = (location: LocationRollup): BoardStatus => {
    const state = goalStatus(location, goal);
    return paced || state === "met" || state === "not_counting" ? state : "below";
  };

  const counts: Record<"all" | BoardStatus, number> = {
    all: locations.length,
    met: summary.atGoal,
    on_pace: paced ? summary.onPace : 0,
    behind_pace: paced ? summary.behindPace : 0,
    below: paced ? 0 : summary.onPace + summary.behindPace,
    not_counting: summary.notCounting,
  };
  const statusFilters: { key: "all" | BoardStatus; label: string }[] = paced
    ? STATUS_FILTERS
    : [
        { key: "all", label: "All" },
        { key: "met", label: GOAL_STATUS_LABEL.met },
        { key: "below", label: BELOW_GOAL_LABEL },
        { key: "not_counting", label: GOAL_STATUS_LABEL.not_counting },
      ];

  if (!view) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-[12px] text-muted-foreground shadow-raised">
        {singleMonth && monthly
          ? `No figures are held for ${periodLabel}. Choose another month, or This month to date, in Period.`
          : `The ${periodLabel} figures could not be loaded just now. Choose This month to date in Period, or reload to try again.`}
      </p>
    );
  }

  const periodSpan = singleMonth
    ? formatLongMonth(period)
    : view.monthKeys.length > 0
      ? `${formatProgressMonth(view.monthKeys[0])} – ${formatProgressMonth(
          view.monthKeys[view.monthKeys.length - 1],
          true,
        )}`
      : "";
  const columnLabel =
    period === "month"
      ? "Month to date"
      : singleMonth
        ? formatProgressMonth(period, true)
        : period.toUpperCase();

  /*
   * THE RANK IS DECIDED BEFORE ANY FILTER. Narrowing to one district shows
   * each salon's place on the whole board, so "4th" means the same thing
   * whichever rows happen to be on screen.
   */
  const shown = ranked.filter(
    ({ location }) =>
      (status === "all" || statusOf(location) === status) &&
      (district === "all" || location.district === district) &&
      matchesSalon(location, search),
  );

  const month = formatGoalMonth(goal);
  const daysLeft = goal.daysInMonth - goal.dayOfMonth;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ------------------------------------------- where the period is -- */}
      {paced ? (
      <section className="grid min-w-0 gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-raised md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
        <div className="min-w-0">
          <p className="eyebrow">
            {month} · day {goal.dayOfMonth} of {goal.daysInMonth}
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="display-figure text-[30px] text-foreground">
              {summary.atGoal} of {summary.counting}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {summary.counting === 1 ? "salon has" : "salons have"} reached {goal.target} ·{" "}
              {daysLeft === 0
                ? "last day of the month"
                : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}
            </span>
          </p>
          <span
            aria-hidden
            className="mt-2.5 block h-2 overflow-hidden rounded-[4px] bg-surface-muted"
          >
            <span
              className="block h-full bg-selected"
              style={{ width: `${(goal.dayOfMonth / goal.daysInMonth) * 100}%` }}
            />
          </span>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-3.5 rounded-[2px] bg-measure-data" />
            Month to date vs {goal.target}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-3.5 rounded-[2px] bg-status-outperforming" />
            Goal met
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0 border-l-2 border-dashed border-measure-goal" />
            {goal.paceTarget > 0
              ? `Pace mark: ${goal.paceTarget} by now finishes on ${goal.target}`
              : "Pace mark appears from the 2nd"}
          </li>
        </ul>
      </section>
      ) : (
        <section className="grid min-w-0 gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-raised md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
          <div className="min-w-0">
            <p className="eyebrow">
              {singleMonth ? `${periodLabel} · full month` : `${periodLabel} · ${periodSpan}`}
              {period === "ytd" ? ", to date" : ""}
            </p>
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="display-figure text-[30px] text-foreground">
                {summary.atGoal} of {summary.counting}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {summary.counting === 1 ? "salon" : "salons"} {singleMonth ? "reached" : summary.counting === 1 ? "has reached" : "have reached"}{" "}
                {goal.target}
                {singleMonth ? (
                  " in the month"
                ) : (
                  <>
                    {" "}
                    · {monthGoal.target} a month × {view.months}{" "}
                    {view.months === 1 ? "month" : "months"}
                  </>
                )}
              </span>
            </p>
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-3.5 rounded-[2px] bg-measure-data" />
              {columnLabel} vs {goal.target}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-3.5 rounded-[2px] bg-status-outperforming" />
              Goal met
            </li>
          </ul>
        </section>
      )}

      {/* -------------------------------------------------- the ranking -- */}
      <section className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-raised">
        <div className="flex flex-col gap-2.5 border-b border-border-hairline px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {districts.length > 1 ? (
              <TableSelect
                label="District"
                ariaLabel="Filter the leaderboard by district"
                value={district}
                onChange={setDistrict}
                options={[
                  { value: "all", label: "All districts" },
                  ...districts.map((entry) => ({ value: entry, label: entry })),
                ]}
              />
            ) : null}
            {locations.length > 1 ? (
              <SalonSearch id="leaderboard-search" value={search} onChange={setSearch} />
            ) : null}
          </div>

          {locations.length > 1 ? (
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {statusFilters.filter((entry) => entry.key === "all" || counts[entry.key] > 0).map(
                (entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    aria-pressed={status === entry.key}
                    onClick={() => setStatus(entry.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[22px] border px-3 py-[5px] text-[11.5px] transition-colors",
                      status === entry.key
                        ? "border-selected bg-selected text-selected-foreground"
                        : "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
                    )}
                  >
                    {entry.label}
                    <b className="font-black tabular-nums">{counts[entry.key]}</b>
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>

        <div
          aria-hidden
          className={cn(
            ROW_GRID,
            "hidden border-b border-border bg-surface-muted py-2.5 text-[8px] font-black tracking-[0.14em] text-subtle-foreground uppercase lg:grid",
          )}
        >
          <span className="[grid-area:rank]">Rank</span>
          <span className="[grid-area:salon]">Salon</span>
          <span className="text-right [grid-area:month]">{columnLabel}</span>
          <span className="[grid-area:bar]">Progress to {goal.target}</span>
          <span className="[grid-area:status]">Status</span>
        </div>

        <ol aria-label={`Salons ranked by qualifying reviews ${period === "month" ? "month to date" : singleMonth ? `in ${periodSpan}` : `${columnLabel}, ${periodSpan}`}`}>
          {shown.map(({ location, rank, tied }) => {
            const state = statusOf(location);
            const counting = rank !== null;
            return (
              <li
                key={location.storeCode}
                className={cn(
                  ROW_GRID,
                  "border-b border-border-row py-3 last:border-b-0",
                  state === "met" &&
                    "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--status-outperforming)_7%,transparent),transparent_45%)]",
                )}
              >
                <div className="flex flex-col items-center gap-0.5 self-start [grid-area:rank] lg:self-center">
                  <span
                    aria-label={counting ? `Rank ${rank}${tied ? ", tied" : ""}` : "Not ranked"}
                    className={cn(
                      "display-figure grid size-10 place-items-center rounded-full text-[24px] lg:size-11 lg:text-[26px]",
                      rank === 1 ? "bg-brand-yellow text-brand-yellow-foreground" : "text-foreground",
                      !counting && "text-muted-foreground",
                    )}
                  >
                    {counting ? rank : "—"}
                  </span>
                  {tied ? (
                    <span className="text-[8px] font-black tracking-[0.1em] text-muted-foreground uppercase">
                      Tied
                    </span>
                  ) : null}
                </div>

                <div className="min-w-0 [grid-area:salon]">
                  <Link
                    href={reviewsHref({
                      ...filters,
                      tab: "reviews",
                      storeCode: location.storeCode,
                      week: periodWeek,
                    })}
                    className="flex min-h-6 items-center text-[12.5px] font-black text-foreground hover:underline"
                  >
                    {location.locationName}
                  </Link>
                  <span className="block text-[10.5px] text-muted-foreground">
                    #{location.storeCode}
                    {location.district ? ` · ${location.district}` : ""}
                    {location.listingState === "verification_required"
                      ? " · Google verification required"
                      : ""}
                    {counting ? null : (
                      <>
                        {" · "}
                        <AnchorMarker location={location} canManageAnchors={canManageAnchors} />
                      </>
                    )}
                  </span>
                </div>

                <div className="[grid-area:month] lg:text-right">
                  <span className="block text-[8px] font-black tracking-[0.1em] text-muted-foreground uppercase lg:hidden">
                    {columnLabel}
                  </span>
                  {counting ? (
                    <Link
                      href={reviewsHref({
                        ...filters,
                        tab: "reviews",
                        storeCode: location.storeCode,
                        week: periodWeek,
                        qualifying: "yes",
                      })}
                      className="display-figure text-[30px] text-foreground hover:underline"
                    >
                      {location.qualifyingMonthToDate}
                      <span className="text-[16px] text-muted-foreground"> / {goal.target}</span>
                    </Link>
                  ) : (
                    <span className="display-figure text-[30px] text-muted-foreground">
                      —<span className="text-[16px]"> / {goal.target}</span>
                    </span>
                  )}
                </div>

                <div className="min-w-0 [grid-area:bar]">
                  <GoalProgressBar location={location} goal={goal} />
                </div>

                <div className="[grid-area:status]">
                  {state === "below" ? (
                    <StatusChip tone="belowMarket">{BELOW_GOAL_LABEL}</StatusChip>
                  ) : (
                    <GoalStatusChip location={location} goal={goal} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {shown.length === 0 ? (
          <p className="px-5 py-6 text-center text-[12.5px] text-muted-foreground">
            {locations.length === 0
              ? "No salon is in view."
              : "No salon matches these filters. Choose All to see every salon in view."}
          </p>
        ) : null}

        <p className="border-t border-border-hairline px-4 py-3 text-[11px] text-muted-foreground">
          Salons on the same count share a rank. Progress can pass 100%: the bar stops at
          full width and the overage shows as &ldquo;+N over&rdquo;. A salon without a
          review baseline isn&rsquo;t ranked, because nothing is being counted for it yet.{" "}
          {formatNumber(summary.qualifyingMonthToDate)} qualifying{" "}
          {summary.qualifyingMonthToDate === 1 ? "review" : "reviews"}{" "}
          {period === "month"
            ? `so far in ${month}`
            : singleMonth
              ? `in ${periodSpan}`
              : `in ${columnLabel} (${periodSpan})`}{" "}
          across the salons that are counting.
          {view.beforeCounting
            ? ` For a salon that had not started counting for all of ${periodSpan}, the figure is the 3–5★ reviews Google dates to that month.`
            : ""}
        </p>
      </section>
    </div>
  );
}
