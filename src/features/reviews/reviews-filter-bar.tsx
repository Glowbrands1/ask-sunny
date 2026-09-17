"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

import {
  ASSIGNMENT_FILTERS,
  QUALIFYING_FILTERS,
  RATING_FILTERS,
  SEARCH_LIMIT,
  STATUS_FILTERS,
  hasActiveReviewFilters,
  reviewsHref,
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
 * NATIVE `<select>` ON PURPOSE, as the previous screen recorded: these are all
 * single-choice, where a native control is better on a phone, needs no
 * JavaScript to open, and is already keyboard- and screen-reader-correct. The
 * pill draws its own chrome because the shared `Select` renders a chevron as a
 * sibling that paints over a transparent select — found in visual QA once, and
 * not repeated here.
 */
export function ReviewsFilterBar({
  filters,
  districts,
  locations,
  weekStarts,
}: {
  filters: ReviewFilters;
  districts: string[];
  locations: { storeCode: string; label: string; district: string | null }[];
  weekStarts: string[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search ?? "");

  const go = (next: Partial<ReviewFilters>) => {
    /*
     * A FILTER CHANGE CLOSES THE DETAIL PANEL. Leaving it open would show one
     * review's detail above a list that no longer contains it, which reads as a
     * bug even though both halves are correct.
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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-5 py-3.5 sm:px-6">
      <span className="eyebrow mr-0.5 shrink-0 text-subtle-foreground">Filters</span>

      <FilterSelect
        label="Week"
        value={filters.week}
        onChange={(week) => go({ week })}
        defaultValue={WEEK_ALL}
        options={weekOptions}
      />

      <FilterSelect
        label="District"
        value={filters.district ?? "all"}
        onChange={(district) => go({ district: district === "all" ? null : district })}
        options={[
          { value: "all", label: "All districts" },
          ...districts.map((district) => ({ value: district, label: district })),
        ]}
      />

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

      <FilterSelect
        label="Rating"
        value={filters.rating}
        onChange={(rating) => go({ rating: rating as ReviewFilters["rating"] })}
        options={RATING_FILTERS.map((entry) => ({ value: entry.key, label: entry.label }))}
      />

      <FilterSelect
        label="Response"
        value={filters.status}
        onChange={(status) => go({ status: status as ReviewFilters["status"] })}
        options={STATUS_FILTERS.map((entry) => ({ value: entry.key, label: entry.label }))}
      />

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

      {/*
        WHETHER A REVIEW IS IN A REPORTING PERIOD AT ALL — a different question
        from the star rule beside it. "Counts toward weekly" asks about the
        rating; this asks whether the review was ever admitted to a week, which
        an imported backlog was not.
      */}
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

      {hasActiveReviewFilters(filters) ? (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            router.push("/reviews");
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
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
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
