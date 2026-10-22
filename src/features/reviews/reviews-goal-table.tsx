"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ScrollTable } from "@/components/ui/layout";
import {
  formatMonthToDate,
  isCounting,
  type ReviewGoalContext,
} from "@/lib/reviews/goal";
import { formatWeekRange } from "@/lib/reviews/reporting-week";
import {
  reviewsHref,
  WEEK_CURRENT,
  WEEK_MONTH,
  type ReviewFilters,
} from "@/lib/reviews/filters";
import type { LocationRollup } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { RATING_FLOOR } from "./rating-floor";
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
 * SALON GOAL PROGRESS — THE OVERVIEW'S PER-SALON TABLE
 * ============================================================================
 *
 * WHAT IT CARRIES, at Gwen Harlan's request (October 2026): qualifying
 * reviews this week, qualifying reviews this month to date, the monthly
 * target, and progress toward it. WHAT IT NO LONGER CARRIES: Unanswered, the
 * "Replies waiting" status, All this week and Last week. The response queue
 * still has its own view and its own count; it is not a reporting column.
 *
 * AVERAGE, HISTORICAL AND HELD ARE ONE PRESS AWAY under "More columns" rather
 * than gone, because they were on the leaderboard before and somebody uses them.
 *
 * Nothing here computes a salon's figures. The rollups arrive from the read
 * layer, and the status and percentage come from `lib/reviews/goal.ts`.
 */

type SortKey =
  | "salon"
  | "storeCode"
  | "week"
  | "month"
  | "progress"
  | "average"
  | "historical"
  | "held";

const NUMERIC: SortKey[] = ["week", "month", "progress", "average", "historical", "held"];

/*
 * A LISTING THAT IS NOT COUNTING SORTS BELOW A ZERO, in either direction, so it
 * never sits among the leaders when the order is flipped.
 */
function valueFor(location: LocationRollup, key: SortKey): number | string {
  const counting = isCounting(location);
  switch (key) {
    case "salon":
      return location.locationName.toLowerCase();
    case "storeCode":
      return location.storeCode;
    case "week":
      return counting ? location.qualifyingThisWeek : -1;
    case "month":
    case "progress":
      return counting ? location.qualifyingMonthToDate : -1;
    case "average":
      return location.averageRating ?? -1;
    case "historical":
      return location.historical;
    case "held":
      return location.total;
  }
}

export function ReviewGoalTable({
  locations,
  filters,
  goal,
  currentWeek,
  canManageAnchors,
}: {
  locations: LocationRollup[];
  filters: ReviewFilters;
  goal: ReviewGoalContext;
  currentWeek: string;
  canManageAnchors: boolean;
}) {
  const [search, setSearch] = useState("");
  const [district, setDistrict] = useState("all");
  const [more, setMore] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "month",
    descending: true,
  });

  const districts = useMemo(() => districtsOf(locations), [locations]);

  const rows = useMemo(() => {
    const matching = locations.filter(
      (location) =>
        (district === "all" || location.district === district) && matchesSalon(location, search),
    );
    return [...matching].sort((a, b) => {
      const left = valueFor(a, sort.key);
      const right = valueFor(b, sort.key);
      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      /* Month ties settle on the week; every tie then on the name, A first. */
      const settled =
        compared !== 0
          ? compared
          : sort.key === "month" || sort.key === "progress"
            ? (valueFor(a, "week") as number) - (valueFor(b, "week") as number)
            : 0;
      if (settled !== 0) return sort.descending ? -settled : settled;
      return a.locationName.localeCompare(b.locationName);
    });
  }, [locations, search, district, sort]);

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: NUMERIC.includes(key) },
    );

  const weekRange = formatWeekRange(currentWeek);
  const monthRange = formatMonthToDate(goal);

  return (
    <section className="min-w-0 rounded-[var(--radius-lg)] border border-border bg-surface shadow-raised">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-hairline px-4 py-3.5">
        <h3 className="mr-1 text-[13px] font-black text-foreground">Salon goal progress</h3>
        <SalonSearch id="goal-table-search" value={search} onChange={setSearch} />
        {districts.length > 1 ? (
          <TableSelect
            label="District"
            ariaLabel="Filter the goal table by district"
            value={district}
            onChange={setDistrict}
            options={[
              { value: "all", label: "All districts" },
              ...districts.map((entry) => ({ value: entry, label: entry })),
            ]}
          />
        ) : null}
        <button
          type="button"
          aria-pressed={more}
          onClick={() => setMore((value) => !value)}
          className={cn(
            "rounded-[22px] border border-border-strong px-3.5 py-[7px] text-[11.5px] font-bold text-foreground shadow-soft transition-colors hover:bg-surface-muted",
            more ? "bg-surface-muted" : "bg-surface",
          )}
        >
          {more ? "Hide extra columns" : "More columns"}
        </button>
        <p className="ml-auto text-[11px] text-muted-foreground">
          {rows.length === locations.length
            ? `${formatNumber(locations.length)} ${locations.length === 1 ? "salon" : "salons"}`
            : `${formatNumber(rows.length)} of ${formatNumber(locations.length)} salons`}
        </p>
      </div>

      <ScrollTable>
        <table
          aria-label="Salon goal progress"
          className={cn("data-table", more ? "min-w-[74rem]" : "min-w-[60rem]")}
        >
          <thead>
            <tr>
              {/* A floor on the salon column, so a name and its baseline line stay
                  readable when the table is wider than the screen and scrolls. */}
              <Header label="Salon" sortKey="salon" sort={sort} onSort={toggle} className="min-w-[15rem]" />
              <Header label="Store code" sortKey="storeCode" sort={sort} onSort={toggle} align="right" />
              {/*
                THE WEEK AND THE MONTH ARE TOLD APART THREE WAYS: the window in
                words under each heading, a rule across the top of each heading
                (the warm edge for the week, near-black for the month), and the
                month's figure set heavier than the week's.
              */}
              <Header
                label="Qualifying"
                detail={`This week · ${weekRange}`}
                sortKey="week"
                sort={sort}
                onSort={toggle}
                align="right"
                className="shadow-[inset_0_3px_0_var(--status-at-market-edge)]"
              />
              <Header
                label="Qualifying"
                detail={`Month to date · ${monthRange}`}
                sortKey="month"
                sort={sort}
                onSort={toggle}
                align="right"
                className="shadow-[inset_0_3px_0_var(--selected)]"
              />
              <th scope="col" data-align="right">
                Monthly target
              </th>
              <Header
                label="Progress toward target"
                detail={
                  goal.paceTarget > 0
                    ? `Dashed mark = ${goal.paceTarget} by now to finish on ${goal.target}`
                    : `Pace starts tomorrow`
                }
                sortKey="progress"
                sort={sort}
                onSort={toggle}
              />
              <th scope="col">Status</th>
              {more ? (
                <>
                  <Header label="Average" sortKey="average" sort={sort} onSort={toggle} align="right" />
                  <Header label="Historical" sortKey="historical" sort={sort} onSort={toggle} align="right" />
                  <Header label="Held" sortKey="held" sort={sort} onSort={toggle} align="right" />
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((location) => {
              const counting = isCounting(location);
              return (
                <tr key={location.storeCode}>
                  <td>
                    <Link
                      href={reviewsHref({
                        ...filters,
                        tab: "reviews",
                        storeCode: location.storeCode,
                        week: WEEK_CURRENT,
                      })}
                      className="flex min-h-6 items-center text-[12px] font-bold text-foreground hover:underline"
                    >
                      {location.locationName}
                    </Link>
                    <span className="block text-[10.5px] text-muted-foreground">
                      {location.district ?? "District not on record"}
                      {location.listingState === "verification_required"
                        ? " · Google verification required"
                        : ""}
                      {" · "}
                      <AnchorMarker location={location} canManageAnchors={canManageAnchors} />
                    </span>
                  </td>
                  <td data-align="right" className="tabular-nums">
                    {location.storeCode}
                  </td>
                  <td data-align="right">
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
                          "inline-flex min-h-6 min-w-6 items-center justify-end text-[12.5px] font-bold hover:underline",
                          location.qualifyingThisWeek > 0 ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {location.qualifyingThisWeek}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td data-align="right">
                    {counting ? (
                      <Link
                        href={reviewsHref({
                          ...filters,
                          tab: "reviews",
                          storeCode: location.storeCode,
                          week: WEEK_MONTH,
                          qualifying: "yes",
                        })}
                        className={cn(
                          "inline-flex min-h-6 min-w-6 items-center justify-end text-[14px] font-black hover:underline",
                          location.qualifyingMonthToDate > 0
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {location.qualifyingMonthToDate}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td data-align="right">{goal.target}</td>
                  <td className="min-w-[13rem]">
                    <GoalProgressBar location={location} goal={goal} />
                  </td>
                  <td>
                    <GoalStatusChip location={location} goal={goal} />
                  </td>
                  {more ? (
                    <>
                      <td data-align="right">
                        <span
                          className={cn(
                            "font-black",
                            location.averageRating !== null &&
                              location.averageRating < RATING_FLOOR
                              ? "text-measure-flagged-foreground"
                              : "text-foreground",
                          )}
                        >
                          {location.averageRating === null ? "—" : location.averageRating.toFixed(2)}
                        </span>
                      </td>
                      <td data-align="right" className="text-muted-foreground">
                        {formatNumber(location.historical)}
                      </td>
                      <td data-align="right">{formatNumber(location.total)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-[12.5px] text-muted-foreground">
          {locations.length === 0
            ? "No salon is in view."
            : "No salon matches that search. Clear it to see every salon in view."}
        </p>
      ) : null}

      <p className="border-t border-border-hairline px-4 py-3 text-[11px] text-muted-foreground">
        Qualifying means a 3-, 4- or 5-star Google review, counted in the week and month
        Google shows it was posted. 1–2 star reviews and imported history never count. This
        week runs Sunday to Saturday, Central time; month to date runs from the 1st through
        today. Reviews arrive with the daily 6&nbsp;AM sync, so one posted late on Saturday
        appears on Sunday morning, in the week it was posted.
      </p>
    </section>
  );
}

/**
 * A column header that sorts. `aria-sort` is the markup, and the button keeps
 * it reachable from the keyboard — the same header the leaderboard always had.
 */
function Header({
  label,
  detail,
  sortKey,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  detail?: string;
  sortKey: SortKey;
  sort: { key: SortKey; descending: boolean };
  onSort: (key: SortKey) => void;
  align?: "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      data-align={align}
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex min-h-6 items-center gap-1 whitespace-nowrap uppercase transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <span aria-hidden className={cn("text-[9px]", active ? "opacity-100" : "opacity-35")}>
          {active ? (sort.descending ? "▼" : "▲") : "↕"}
        </span>
      </button>
      {/* The window a column covers is information, so it is set in the muted
          ink rather than the hairline colour the table's sub-heading defaults to. */}
      {detail ? <small className="text-muted-foreground">{detail}</small> : null}
    </th>
  );
}
