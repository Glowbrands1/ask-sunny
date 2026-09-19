"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

import {
  ASSIGNMENT_FILTERS,
  EMPTY_REVIEW_FILTERS,
  QUALIFYING_FILTERS,
  RATING_FILTERS,
  SEARCH_LIMIT,
  STATUS_FILTERS,
  hasActiveReviewFilters,
  reviewsHref,
  reviewsTabHref,
  WEEK_ALL,
  WEEK_CURRENT,
  type ReviewFilters,
} from "@/lib/reviews/filters";
import { formatWeekRange } from "@/lib/reviews/reporting-week";
import { cn } from "@/lib/utils/cn";

/**
 * THE FILTER STRIP.
 *
 * Every control writes the URL and lets the server re-render, which is the same
 * mechanism the drill-down links use. One vocabulary, one code path: a filter
 * set by clicking a tile and a filter set from this bar cannot mean different
 * things, because there is only one place that reads them.
 *
 * ============================================================================
 * TWO ROWS: THE ONES EVERYBODY USES, AND THE ONES THIS PAGE ALSO HAS
 * ============================================================================
 *
 * The bar used to render all seven selects at once. Location and rating are
 * what somebody actually reaches for; week, reporting assignment, weekly-total
 * eligibility and district are real and are used by the drill-down links, but
 * putting them in the same row buried the two that matter behind five that
 * mostly do not — a toolbar that has to be read rather than used.
 *
 * So the caller says which controls belong on its view, and the rest are behind
 * "More filters". NOTHING IS REMOVED: every filter still parses from the URL,
 * still narrows the same query, and still appears here the moment it is in
 * force, because a filter silently narrowing the page from a collapsed panel is
 * worse than a crowded toolbar.
 *
 * NATIVE `<select>` ON PURPOSE, as the previous screen recorded: these are all
 * single-choice, where a native control is better on a phone, needs no
 * JavaScript to open, and is already keyboard- and screen-reader-correct. The
 * pill draws its own chrome because the shared `Select` renders a chevron as a
 * sibling that paints over a transparent select — found in visual QA once, and
 * not repeated here.
 */

/** Which controls a view puts in the toolbar's first row. */
export type ReviewFilterControl =
  | "week"
  | "district"
  | "location"
  | "rating"
  | "status"
  | "qualifying"
  | "assignment"
  | "search";

const ALL_CONTROLS: ReviewFilterControl[] = [
  "week",
  "district",
  "location",
  "rating",
  "status",
  "qualifying",
  "assignment",
  "search",
];

export function ReviewsFilterBar({
  filters,
  districts,
  locations,
  weekStarts,
  controls = ALL_CONTROLS,
}: {
  filters: ReviewFilters;
  districts: string[];
  locations: { storeCode: string; label: string; district: string | null }[];
  weekStarts: string[];
  /** The controls this view leads with. Everything else sits behind More. */
  controls?: ReviewFilterControl[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search ?? "");
  const [showMore, setShowMore] = useState(false);

  const go = (next: Partial<ReviewFilters>) => {
    /*
     * A FILTER CHANGE CLOSES THE DETAIL PANEL. Leaving it open would show one
     * review's detail above a list that no longer contains it, which reads as a
     * bug even though both halves are correct.
     *
     * IT DOES NOT CHANGE THE TAB. `filters` carries the open view and is spread
     * first, so narrowing to one salon leaves the reader looking at the same
     * thing they were looking at.
     */
    router.push(reviewsHref({ ...filters, ...next, openReviewId: null }));
  };

  /* The weeks newest first: "this week" is what somebody reaches for. */
  const weekOptions = [
    { value: WEEK_ALL, label: "All time" },
    { value: WEEK_CURRENT, label: "This week" },
    ...[...weekStarts]
      .reverse()
      .slice(1)
      .map((weekStart) => ({ value: weekStart, label: formatWeekRange(weekStart) })),
  ];

  /*
   * A CONTROL THE VIEW DID NOT ASK FOR STILL APPEARS WHEN IT IS IN FORCE.
   * Somebody arriving from "Historical — not yet counted" is looking at a
   * narrowed page; the control that narrowed it has to be on screen and has to
   * be clearable, whichever view they landed on.
   */
  const inForce: Partial<Record<ReviewFilterControl, boolean>> = {
    week: filters.week !== WEEK_ALL,
    district: filters.district !== null,
    location: filters.storeCode !== null,
    rating: filters.rating !== "all",
    status: filters.status !== "all",
    qualifying: filters.qualifying !== "all",
    assignment: filters.assignment !== "all",
    search: (filters.search?.length ?? 0) > 0,
  };

  const leads = (control: ReviewFilterControl) =>
    controls.includes(control) || inForce[control] === true;
  const hidden = ALL_CONTROLS.filter((control) => !leads(control));
  const shows = (control: ReviewFilterControl) => leads(control) || showMore;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-5 py-3 sm:px-6">
      <span className="eyebrow mr-0.5 shrink-0 text-subtle-foreground">Filters</span>

      {shows("location") ? (
        <FilterSelect
          label="Location"
          value={filters.storeCode ?? "all"}
          onChange={(storeCode) => go({ storeCode: storeCode === "all" ? null : storeCode })}
          options={[
            { value: "all", label: "All locations" },
            /* The store code is on the label, so this control is both filters. */
            ...locations.map((location) => ({
              value: location.storeCode,
              label: `${location.label} · ${location.storeCode}`,
            })),
          ]}
        />
      ) : null}

      {shows("rating") ? (
        <FilterSelect
          label="Rating"
          value={filters.rating}
          onChange={(rating) => go({ rating: rating as ReviewFilters["rating"] })}
          options={RATING_FILTERS.map((entry) => ({ value: entry.key, label: entry.label }))}
        />
      ) : null}

      {shows("status") ? (
        <FilterSelect
          label="Response"
          value={filters.status}
          onChange={(status) => go({ status: status as ReviewFilters["status"] })}
          options={STATUS_FILTERS.map((entry) => ({ value: entry.key, label: entry.label }))}
        />
      ) : null}

      {shows("week") ? (
        <FilterSelect
          label="Week"
          value={filters.week}
          onChange={(week) => go({ week })}
          defaultValue={WEEK_ALL}
          options={weekOptions}
        />
      ) : null}

      {shows("district") ? (
        <FilterSelect
          label="District"
          value={filters.district ?? "all"}
          onChange={(district) => go({ district: district === "all" ? null : district })}
          options={[
            { value: "all", label: "All districts" },
            ...districts.map((district) => ({ value: district, label: district })),
          ]}
        />
      ) : null}

      {shows("qualifying") ? (
        <FilterSelect
          label="Weekly total"
          value={filters.qualifying}
          onChange={(qualifying) =>
            go({ qualifying: qualifying as ReviewFilters["qualifying"] })
          }
          options={QUALIFYING_FILTERS.map((entry) => ({
            value: entry.key,
            label: entry.label,
          }))}
        />
      ) : null}

      {/*
        WHETHER A REVIEW IS IN A REPORTING PERIOD AT ALL — a different question
        from the star rule beside it. "Counts toward weekly" asks about the
        rating; this asks whether the review was ever admitted to a week, which
        an imported backlog was not.
      */}
      {shows("assignment") ? (
        <FilterSelect
          label="Reporting"
          value={filters.assignment}
          onChange={(assignment) =>
            go({ assignment: assignment as ReviewFilters["assignment"] })
          }
          options={ASSIGNMENT_FILTERS.map((entry) => ({
            value: entry.key,
            label: entry.label,
          }))}
        />
      ) : null}

      {shows("search") ? (
        <form
          className="flex min-w-0 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            go({ search: search.trim() === "" ? null : search.trim() });
          }}
        >
          <label htmlFor="review-search" className="sr-only">
            Search reviewer name, comment or location
          </label>
          <span className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-2.5 size-3 text-muted-foreground"
              aria-hidden
            />
            <input
              id="review-search"
              type="search"
              value={search}
              maxLength={SEARCH_LIMIT}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, comment or location"
              className="w-[15rem] max-w-full rounded-[22px] border border-border-strong bg-surface py-[7px] pr-3 pl-7 text-[11.5px] text-foreground shadow-soft placeholder:text-placeholder-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </span>
          <button
            type="submit"
            className="pill-action bg-selected text-selected-foreground transition-colors hover:bg-selected-hover"
          >
            Search
          </button>
        </form>
      ) : null}

      {hidden.length > 0 && !showMore ? (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="inline-flex items-center gap-1.5 rounded-[22px] border border-border-strong bg-surface px-3.5 py-[7px] text-[11.5px] font-bold text-foreground shadow-soft transition-colors hover:bg-surface-muted"
        >
          <SlidersHorizontal className="size-3" aria-hidden />
          More filters
        </button>
      ) : null}

      {hasActiveReviewFilters(filters) ? (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            /*
              RESET CLEARS THE FILTERS, NOT THE VIEW. Throwing somebody back to
              the Overview because they widened a rating would be the control
              doing two things, one of which nobody asked for.
            */
            router.push(reviewsTabHref(EMPTY_REVIEW_FILTERS, filters.tab));
          }}
          className="inline-flex items-center gap-1 rounded-[22px] border border-border-strong bg-surface px-3 py-[7px] text-[11.5px] font-bold text-foreground shadow-soft transition-colors hover:bg-surface-muted"
        >
          <X className="size-3" aria-hidden />
          Reset
        </button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  defaultValue = "all",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const active = value !== defaultValue;
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
      <span className="max-w-[12rem] truncate font-bold whitespace-nowrap">{current}</span>
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
        aria-label={label}
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
