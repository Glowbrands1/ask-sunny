"use client";

import Link from "next/link";
import { Search } from "lucide-react";

import { StatusChip, type StatusTone } from "@/components/ui/marquee";
import {
  GOAL_STATUS_LABEL,
  goalProgress,
  goalStatus,
  isCounting,
  type GoalStatus,
  type ReviewGoalContext,
} from "@/lib/reviews/goal";
import { reviewSetupHref } from "@/lib/reviews/filters";
import type { LocationRollup } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * THE PIECES THE GOAL TABLE AND THE LEADERBOARD SHARE
 * ============================================================================
 *
 * One progress bar, one status chip and one baseline marker, so a salon reads
 * the same on the Overview's table and on the ranked leaderboard. Nothing here
 * computes a figure: the month-to-date count arrives on the rollup, and the
 * status and the percentage come from `lib/reviews/goal.ts`.
 */

/**
 * THE MONTHLY STATUS, ON THE SHARED FOUR-STATE LADDER.
 *
 * Green is spent on "Goal met" alone — the one state the business has said is
 * good. "On pace" is the neutral rung, and "Behind pace" the amber one rather
 * than the coral: early in a month it is a nudge, not an alarm. A listing with
 * no baseline takes the quiet capacity chip, because it is a fact about the
 * setup rather than a judgement about the salon.
 */
const TONE: Record<GoalStatus, StatusTone> = {
  met: "outperforming",
  on_pace: "atMarket",
  behind_pace: "belowMarket",
  not_counting: "capacity",
};

export function GoalStatusChip({
  location,
  goal,
}: {
  location: LocationRollup;
  goal: ReviewGoalContext;
}) {
  const status = goalStatus(location, goal);
  return <StatusChip tone={TONE[status]}>{GOAL_STATUS_LABEL[status]}</StatusChip>;
}

/**
 * ============================================================================
 * PROGRESS TOWARD THE MONTHLY TARGET
 * ============================================================================
 *
 * THE PERCENTAGE IS NOT CAPPED; THE BAR IS. Twelve of ten is 120%, and the
 * caption says "+2 over" — but a bar that ran past its track would push the
 * figure beside it out of its column, so the fill stops at full width.
 *
 * THE DASHED MARK IS THE PACE, drawn only while the goal is still open: where a
 * salon needs to be by now to finish the month on target. It is a reference on
 * the track, never a second fill, so it cannot be mistaken for progress.
 */
export function GoalProgressBar({
  location,
  goal,
}: {
  location: LocationRollup;
  goal: ReviewGoalContext;
}) {
  if (!isCounting(location)) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="block h-[12px] min-w-[80px] flex-1 rounded-[4px] border border-border bg-[repeating-linear-gradient(135deg,var(--surface-muted)_0_6px,var(--surface)_6px_12px)]"
        />
        <span className="w-[4.25rem] shrink-0 text-right text-[12px] font-black text-muted-foreground">
          —
        </span>
      </div>
    );
  }

  const progress = goalProgress(location.qualifyingMonthToDate, goal.target);
  const met = location.qualifyingMonthToDate >= goal.target;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        role="img"
        aria-label={`${location.qualifyingMonthToDate} of ${goal.target} qualifying reviews, ${progress.percent}%`}
        className="relative block h-[12px] min-w-[80px] flex-1 rounded-[4px] bg-measure-data-track"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-[4px] transition-[width] duration-300 motion-reduce:transition-none",
            met ? "bg-status-outperforming" : "bg-measure-data",
          )}
          style={{ width: `${progress.barPercent}%` }}
        />
        {!met && goal.paceTarget > 0 ? (
          <span
            aria-hidden
            data-pace-mark
            className="absolute -inset-y-[3px] w-0 border-l-2 border-dashed border-measure-goal"
            style={{ left: `${Math.min(100, (goal.paceTarget / goal.target) * 100)}%` }}
          />
        ) : null}
      </span>
      <span className="w-[4.25rem] shrink-0 text-right leading-tight">
        <span className="block text-[12.5px] font-black text-foreground tabular-nums">
          {progress.percent}%
        </span>
        <span
          className={cn(
            "block text-[10px] font-bold whitespace-nowrap",
            met ? "text-status-outperforming" : "text-muted-foreground",
          )}
        >
          {met
            ? progress.over > 0
              ? `+${progress.over} over`
              : "Goal met"
            : `${progress.remaining} to go`}
        </span>
      </span>
    </div>
  );
}

/**
 * WHETHER THIS SALON IS BEING COUNTED.
 *
 * Unchanged in meaning from the leaderboard it replaces: a listing with no
 * anchor says "No anchor — counting nothing", and for an administrator that
 * sentence links to the listing's own baseline setup. The Google review id is
 * never rendered.
 */
export function AnchorMarker({
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

  /*
   * NO REVIEWER NAME. Reviews count by the date Google says they were posted,
   * so the anchor is no longer the line that decides what counts — and naming
   * it ("counting after A Google User") would point at a review that may have
   * left Google since.
   */
  const label = "Tracking active";

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

/** The search pill both tables lead with. */
export function SalonSearch({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Find a salon, store code or district
      </label>
      <span className="relative flex max-w-full items-center">
        <Search
          className="pointer-events-none absolute left-2.5 size-3 text-muted-foreground"
          aria-hidden
        />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Find a salon, store code or district"
          className="w-[17rem] max-w-full rounded-[22px] border border-border-strong bg-surface py-[7px] pr-3 pl-7 text-[11.5px] text-foreground shadow-soft placeholder:text-placeholder-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </span>
    </>
  );
}

/** Matches a salon by name, store code or district. */
export function matchesSalon(location: LocationRollup, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (term === "") return true;
  return (
    location.locationName.toLowerCase().includes(term) ||
    location.storeCode.toLowerCase().includes(term) ||
    (location.district ?? "").toLowerCase().includes(term)
  );
}

/**
 * The pill-shaped select the leaderboard has always used.
 *
 * The native `select` sits invisibly over the pill, so the menu is the
 * platform's own and keyboard and screen-reader behaviour come for free.
 */
export function TableSelect({
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

/** The distinct districts in a set of rollups, for a district select. */
export function districtsOf(locations: LocationRollup[]): string[] {
  return [
    ...new Set(
      locations
        .map((entry) => entry.district)
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ].sort();
}

/**
 * WHICH WINDOW A FIGURE COVERS, said in words as well as by position.
 *
 * The week and the month sit side by side on every surface, and the difference
 * between "3 this week" and "3 this month" is the whole question somebody is
 * asking. The week tag is the quiet warm tint; the month tag is near-black.
 */
export function WindowTag({
  window,
  children,
  className,
}: {
  window: "week" | "month";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-[22px] px-2 py-[3px] text-[8.5px] font-black tracking-[0.1em] whitespace-nowrap uppercase",
        window === "week"
          ? "bg-surface-muted text-body-foreground"
          : "bg-selected text-selected-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
