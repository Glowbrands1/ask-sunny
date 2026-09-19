"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { ScrollTable } from "@/components/ui/layout";
import { StatusChip, type StatusTone } from "@/components/ui/marquee";
import { reviewSetupHref, reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import type { LocationRollup } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { RATING_FLOOR } from "./rating-floor";

/**
 * ============================================================================
 * THE SALON LEADERBOARD
 * ============================================================================
 *
 * EVERY FIGURE AND EVERY DRILL-DOWN IS THE ONE THAT WAS ALREADY HERE. Nothing
 * in this file computes a salon's numbers: the rollups arrive from the read
 * layer exactly as they did when this table lived at the bottom of a very long
 * page, and qualifying-this-week, all-this-week, last week, unanswered, the
 * average, historical, held and the anchor status all render what they are
 * given. What changed is that the table has a view of its own, and therefore
 * room for the two things a fifteen-row table needs: a way to find a salon, and
 * a way to order the rows by the column somebody is actually asking about.
 *
 * THE SEARCH AND THE SORT ARE LOCAL, AND THAT IS THE RIGHT PLACE FOR THEM. They
 * do not change which reviews were read — the page's own filters do that, in
 * the URL, and they still narrow this table's rows before it ever sees them.
 * Reordering a table that is already on screen is a rendering decision, so it
 * costs no round trip and puts nothing in a link that would read as a filter.
 *
 * THE DEFAULT ORDER IS UNCHANGED: qualifying this week, then all this week,
 * then the salon name. A leaderboard that opened on a different order than the
 * one it has always had would be answering a question nobody asked.
 */

/**
 * A LISTING'S RUNG ON THE SHARED STATUS LADDER.
 *
 * The same four tones the report tabs use, so a chip means the same thing
 * wherever a DM sees it. What it says is what the records can actually support:
 * an open 1- or 2-star review needs attention; anything else unanswered is
 * behind; a listing with everything answered is at goal; a listing with no
 * reviews at all is "quiet", which is a fact rather than a judgement.
 */
export function listingStatus(location: LocationRollup): {
  tone: StatusTone;
  label: string;
} {
  /*
   * NOT COUNTING comes FIRST, ahead of every performance state. A listing with
   * no anchor cannot be described as at goal or behind, because nothing about
   * its week has been measured — and a green chip on an unmeasured salon is the
   * page asserting something nobody has established.
   */
  if (location.anchorReviewId === null && location.total > 0) {
    return { tone: "capacity", label: "No anchor" };
  }
  if (location.criticalOpen > 0) return { tone: "under", label: "Needs attention" };
  if (location.unanswered > 0) return { tone: "belowMarket", label: "Replies waiting" };
  if (location.total === 0) return { tone: "capacity", label: "Nothing synced" };
  return { tone: "outperforming", label: "All answered" };
}

/**
 * ============================================================================
 * WHETHER THIS SALON IS BEING COUNTED, AND HOW TO FIX IT IF IT IS NOT
 * ============================================================================
 *
 * THE MOST IMPORTANT WORDS IN THE TABLE when the answer is no. A listing with
 * no anchor is not having a quiet week — it is not being counted at all, and
 * only saying so stops the zero beside it from being read as news about the
 * salon. For an administrator the sentence is also the way to resolve it: it
 * links to that listing's own baseline setup, with its picker already open.
 *
 * ONCE AN ANCHOR EXISTS IT SAYS SO BRIEFLY AND NAMES A PERSON. "Tracking active
 * · counting after Tarissa Barry" is what an operator needs to confirm the
 * boundary is where they left it. THE GOOGLE REVIEW ID IS NEVER RENDERED — it
 * is an internal key, it means nothing to a reader, and putting it on a screen
 * is how it starts being copied into emails and spreadsheets.
 *
 * THE LINK IS A LINK, not a control. Following it opens a page; it cannot move
 * an anchor, and no filter or sync action on this dashboard can either. Moving
 * one is a POST from the setup screen, made deliberately.
 */
function AnchorMarker({
  location,
  canManageAnchors,
}: {
  location: LocationRollup;
  canManageAnchors: boolean;
}) {
  if (location.anchorReviewId === null) {
    const text = "No anchor — counting nothing";
    return canManageAnchors ? (
      <Link
        href={reviewSetupHref(location.storeCode)}
        className="font-bold text-measure-flagged-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title={`Set the review baseline for ${location.locationName}`}
      >
        {text}
      </Link>
    ) : (
      <span className="font-bold text-measure-flagged-foreground">{text}</span>
    );
  }

  const label = location.anchorReviewer
    ? `Tracking active · counting after ${location.anchorReviewer}`
    : "Tracking active";

  return canManageAnchors ? (
    <Link
      href={reviewSetupHref(location.storeCode)}
      className="text-status-outperforming hover:underline"
      title={`Review the baseline for ${location.locationName}`}
    >
      {label}
    </Link>
  ) : (
    <span className="text-status-outperforming">{label}</span>
  );
}

/* --------------------------------------------------------------- sorting -- */

type SortKey =
  | "salon"
  | "storeCode"
  | "qualifying"
  | "allThisWeek"
  | "lastWeek"
  | "unanswered"
  | "average"
  | "historical"
  | "held";

const NUMERIC_DESC_FIRST: SortKey[] = [
  "qualifying",
  "allThisWeek",
  "lastWeek",
  "unanswered",
  "average",
  "historical",
  "held",
];

function valueFor(location: LocationRollup, key: SortKey): number | string {
  switch (key) {
    case "salon":
      return location.locationName.toLowerCase();
    case "storeCode":
      return location.storeCode;
    case "qualifying":
      return location.qualifyingThisWeek;
    case "allThisWeek":
      return location.reviewsThisWeek;
    case "lastWeek":
      return location.lastWeek;
    case "unanswered":
      return location.unanswered;
    /* A salon with nothing rated sorts last in either direction rather than
       masquerading as a zero-star salon. */
    case "average":
      return location.averageRating ?? -1;
    case "historical":
      return location.historical;
    case "held":
      return location.total;
  }
}

/* ----------------------------------------------------------- the table --- */

export function ReviewsLeaderboard({
  locations,
  filters,
  canManageAnchors,
}: {
  locations: LocationRollup[];
  filters: ReviewFilters;
  canManageAnchors: boolean;
}) {
  const [search, setSearch] = useState("");
  const [district, setDistrict] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null);

  const districts = useMemo(
    () =>
      [
        ...new Set(
          locations
            .map((entry) => entry.district)
            .filter((entry): entry is string => Boolean(entry)),
        ),
      ].sort(),
    [locations],
  );

  const statuses = useMemo(
    () => [...new Set(locations.map((entry) => listingStatus(entry).label))].sort(),
    [locations],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();

    const matching = locations.filter((location) => {
      if (district !== "all" && location.district !== district) return false;
      if (status !== "all" && listingStatus(location).label !== status) return false;
      if (term === "") return true;
      /* Salon, store code and district: the three ways somebody names a row. */
      return (
        location.locationName.toLowerCase().includes(term) ||
        location.storeCode.toLowerCase().includes(term) ||
        (location.district ?? "").toLowerCase().includes(term)
      );
    });

    if (!sort) {
      /* THE ORDER THIS TABLE HAS ALWAYS OPENED IN. */
      return [...matching].sort(
        (a, b) =>
          b.qualifyingThisWeek - a.qualifyingThisWeek ||
          b.reviewsThisWeek - a.reviewsThisWeek ||
          a.locationName.localeCompare(b.locationName),
      );
    }

    return [...matching].sort((a, b) => {
      const left = valueFor(a, sort.key);
      const right = valueFor(b, sort.key);
      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      /* Ties fall back to the salon name so the order never wobbles. */
      const settled = compared !== 0 ? compared : a.locationName.localeCompare(b.locationName);
      return sort.descending ? -settled : settled;
    });
  }, [locations, search, district, status, sort]);

  const toggle = (key: SortKey) => {
    setSort((current) => {
      if (current?.key !== key) {
        return { key, descending: NUMERIC_DESC_FIRST.includes(key) };
      }
      return { key, descending: !current.descending };
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="leaderboard-search" className="sr-only">
          Find a salon, store code or district
        </label>
        <span className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2.5 size-3 text-muted-foreground"
            aria-hidden
          />
          <input
            id="leaderboard-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a salon, store code or district"
            className="w-[17rem] max-w-full rounded-[22px] border border-border-strong bg-surface py-[7px] pr-3 pl-7 text-[11.5px] text-foreground shadow-soft placeholder:text-placeholder-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </span>

        <TableSelect
          label="District"
          /*
            A DISTINCT ACCESSIBLE NAME FROM THE TOOLBAR'S OWN DISTRICT PILL.
            Both can be on screen at once — the toolbar's narrows what was READ,
            this reorders what is DRAWN — and two controls announcing themselves
            as "District" is a screen reader describing them as the same thing.
          */
          ariaLabel="Filter the table by district"
          value={district}
          onChange={setDistrict}
          options={[
            { value: "all", label: "All districts" },
            ...districts.map((entry) => ({ value: entry, label: entry })),
          ]}
        />

        <TableSelect
          label="Status"
          ariaLabel="Filter the table by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            ...statuses.map((entry) => ({ value: entry, label: entry })),
          ]}
        />

        <p className="ml-auto text-[11px] text-muted-foreground">
          {rows.length === locations.length
            ? `${formatNumber(locations.length)} ${
                locations.length === 1 ? "salon" : "salons"
              }`
            : `${formatNumber(rows.length)} of ${formatNumber(locations.length)} salons`}
        </p>
      </div>

      <ScrollTable>
        <table className="data-table min-w-[58rem]">
          <thead>
            <tr>
              <SortableHeader label="Salon" sortKey="salon" sort={sort} onSort={toggle} />
              <SortableHeader
                label="Store code"
                sortKey="storeCode"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="Qualifying this week"
                sortKey="qualifying"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="All this week"
                sortKey="allThisWeek"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="Last week"
                sortKey="lastWeek"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="Unanswered"
                sortKey="unanswered"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="Average"
                sortKey="average"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="Historical"
                sortKey="historical"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <SortableHeader
                label="Held"
                sortKey="held"
                sort={sort}
                onSort={toggle}
                align="right"
              />
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((location) => {
              const chip = listingStatus(location);
              return (
                <tr key={location.storeCode}>
                  <td>
                    {/*
                      THE SALON NAME IS THE DRILL-DOWN. "KS Manhattan = 12
                      reviews this week" opens exactly those twelve, in the
                      Google Reviews view where the records live.
                    */}
                    <Link
                      href={reviewsHref({
                        ...filters,
                        tab: "reviews",
                        storeCode: location.storeCode,
                        week: "current",
                      })}
                      className="block text-[12px] font-bold text-foreground hover:underline"
                    >
                      {location.locationName}
                    </Link>
                    <span className="block text-[10.5px] text-muted-foreground">
                      {location.district ?? "District not on record"}
                      {location.listingState === "verification_required"
                        ? " · Google verification required"
                        : ""}
                      {" · "}
                      <AnchorMarker
                        location={location}
                        canManageAnchors={canManageAnchors}
                      />
                    </span>
                  </td>
                  <td data-align="right" className="tabular-nums">
                    {location.storeCode}
                  </td>
                  <td data-align="right">
                    <Link
                      href={reviewsHref({
                        ...filters,
                        tab: "reviews",
                        storeCode: location.storeCode,
                        week: "current",
                        qualifying: "yes",
                      })}
                      className="text-[13px] font-black text-foreground hover:underline"
                    >
                      {location.qualifyingThisWeek}
                    </Link>
                  </td>
                  <td data-align="right">{location.reviewsThisWeek}</td>
                  <td data-align="right">{location.lastWeek}</td>
                  <td data-align="right">
                    {location.unanswered > 0 ? (
                      <Link
                        href={reviewsHref({
                          ...filters,
                          tab: "needs",
                          storeCode: location.storeCode,
                          status: "needs_response",
                          week: "all",
                        })}
                        className={cn(
                          "font-black hover:underline",
                          location.criticalOpen > 0
                            ? "text-measure-flagged-foreground"
                            : "text-foreground",
                        )}
                      >
                        {location.unanswered}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td data-align="right">
                    <span
                      className={cn(
                        "text-[12.5px] font-black",
                        location.averageRating !== null &&
                          location.averageRating < RATING_FLOOR
                          ? "text-measure-flagged-foreground"
                          : "text-foreground",
                      )}
                    >
                      {location.averageRating === null
                        ? "—"
                        : location.averageRating.toFixed(2)}
                    </span>
                  </td>
                  <td data-align="right">
                    {location.historical > 0 ? (
                      <Link
                        href={reviewsHref({
                          ...filters,
                          tab: "reviews",
                          storeCode: location.storeCode,
                          week: "all",
                          assignment: "historical",
                        })}
                        className="text-muted-foreground hover:underline"
                      >
                        {formatNumber(location.historical)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td data-align="right">{formatNumber(location.total)}</td>
                  <td>
                    <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>

      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-6 text-center text-[12.5px] text-muted-foreground shadow-soft">
          No salon matches that search. Clear it to see every salon in view.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A column header that sorts.
 *
 * `aria-sort` IS THE MARKUP, not a class. A screen reader announcing "Average,
 * sorted descending" is the whole of what a sighted reader gets from the arrow,
 * and a button inside the header keeps it reachable from the keyboard.
 */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; descending: boolean } | null;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sort?.key === sortKey;

  return (
    <th
      scope="col"
      data-align={align}
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <span aria-hidden className={cn("text-[9px]", active ? "opacity-100" : "opacity-35")}>
          {active ? (sort.descending ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

function TableSelect({
  label,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== "all";
  const current = options.find((option) => option.value === value)?.label ?? "";

  return (
    <span
      className={cn(
        "relative inline-flex items-baseline gap-1.5 rounded-[22px] border px-3.5 py-[7px] text-[11.5px] shadow-soft transition-colors",
        active
          ? "border-selected bg-selected text-selected-foreground"
          : "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
      )}
    >
      <span
        className={cn(
          "eyebrow shrink-0",
          active ? "text-selected-foreground opacity-70" : "text-subtle-foreground",
        )}
      >
        {label}
      </span>
      <span className="max-w-[11rem] truncate font-bold whitespace-nowrap">{current}</span>
      <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0 self-center opacity-60">
        <path
          d="M4 6.5 8 10.5 12 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="reviews-filter-select absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
