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
  type RankMetric,
  type ReviewGoalContext,
} from "@/lib/reviews/goal";
import {
  reviewsHref,
  WEEK_CURRENT,
  WEEK_MONTH,
  type ReviewFilters,
} from "@/lib/reviews/filters";
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
 * reviews month to date, each salon drawn against the monthly target, with the
 * week's figure beside it and a toggle to rank by the week instead.
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
  "[grid-template-areas:'rank_salon_salon'_'rank_status_status'_'rank_week_month'_'rank_bar_bar'] " +
  "lg:grid-cols-[3.5rem_minmax(0,1.5fr)_5.5rem_7rem_minmax(11rem,1.5fr)_7.5rem] " +
  "lg:[grid-template-areas:'rank_salon_week_month_bar_status'] lg:items-center";

export function ReviewsLeaderboard({
  locations,
  filters,
  goal,
  canManageAnchors,
}: {
  locations: LocationRollup[];
  filters: ReviewFilters;
  goal: ReviewGoalContext;
  canManageAnchors: boolean;
}) {
  const [metric, setMetric] = useState<RankMetric>("month");
  const [status, setStatus] = useState<"all" | GoalStatus>("all");
  const [district, setDistrict] = useState("all");
  const [search, setSearch] = useState("");

  const districts = useMemo(() => districtsOf(locations), [locations]);
  const ranked = useMemo(() => rankLocations(locations, metric), [locations, metric]);
  const summary = useMemo(() => goalSummary(locations, goal), [locations, goal]);

  const counts: Record<"all" | GoalStatus, number> = {
    all: locations.length,
    met: summary.atGoal,
    on_pace: summary.onPace,
    behind_pace: summary.behindPace,
    not_counting: summary.notCounting,
  };

  /*
   * THE RANK IS DECIDED BEFORE ANY FILTER. Narrowing to one district shows
   * each salon's place on the whole board, so "4th" means the same thing
   * whichever rows happen to be on screen.
   */
  const shown = ranked.filter(
    ({ location }) =>
      (status === "all" || goalStatus(location, goal) === status) &&
      (district === "all" || location.district === district) &&
      matchesSalon(location, search),
  );

  const month = formatGoalMonth(goal);
  const daysLeft = goal.daysInMonth - goal.dayOfMonth;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* -------------------------------------------- where the month is -- */}
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

      {/* -------------------------------------------------- the ranking -- */}
      <section className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-raised">
        <div className="flex flex-col gap-2.5 border-b border-border-hairline px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Rank by"
              className="inline-flex rounded-[22px] border border-border-strong bg-surface p-0.5 shadow-soft"
            >
              {(
                [
                  ["month", "Rank by month to date"],
                  ["week", "Rank by this week"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={metric === key}
                  onClick={() => setMetric(key)}
                  className={cn(
                    "rounded-[20px] px-3 py-[5px] text-[11.5px] font-bold whitespace-nowrap transition-colors",
                    metric === key
                      ? "bg-selected text-selected-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
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
              {STATUS_FILTERS.filter((entry) => entry.key === "all" || counts[entry.key] > 0).map(
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
          <span className="text-right [grid-area:week]">This week</span>
          <span className="text-right [grid-area:month]">Month to date</span>
          <span className="[grid-area:bar]">Progress to {goal.target}</span>
          <span className="[grid-area:status]">Status</span>
        </div>

        <ol aria-label={`Salons ranked by qualifying reviews ${metric === "month" ? "month to date" : "this week"}`}>
          {shown.map(({ location, rank, tied }) => {
            const state = goalStatus(location, goal);
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
                      week: WEEK_CURRENT,
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

                <div className="[grid-area:week] lg:text-right">
                  <span className="block text-[8px] font-black tracking-[0.1em] text-muted-foreground uppercase lg:hidden">
                    This week
                  </span>
                  {counting ? (
                    <Link
                      href={reviewsHref({
                        ...filters,
                        tab: "reviews",
                        storeCode: location.storeCode,
                        week: WEEK_CURRENT,
                        qualifying: "yes",
                      })}
                      className={cn(
                        "inline-flex min-h-6 min-w-6 items-center text-[15px] font-black tabular-nums hover:underline lg:justify-end",
                        location.qualifyingThisWeek > 0 ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {location.qualifyingThisWeek > 0 ? `+${location.qualifyingThisWeek}` : "0"}
                    </Link>
                  ) : (
                    <span className="text-[15px] font-black text-muted-foreground">—</span>
                  )}
                </div>

                <div className="[grid-area:month] lg:text-right">
                  <span className="block text-[8px] font-black tracking-[0.1em] text-muted-foreground uppercase lg:hidden">
                    Month to date
                  </span>
                  {counting ? (
                    <Link
                      href={reviewsHref({
                        ...filters,
                        tab: "reviews",
                        storeCode: location.storeCode,
                        week: WEEK_MONTH,
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
                  <GoalStatusChip location={location} goal={goal} />
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
          {summary.qualifyingMonthToDate === 1 ? "review" : "reviews"} so far in {month}{" "}
          across the salons that are counting.
        </p>
      </section>
    </div>
  );
}
