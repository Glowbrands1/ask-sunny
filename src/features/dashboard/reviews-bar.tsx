import Link from "next/link";

import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

/**
 * GOOGLE REVIEWS AS A HORIZONTAL YELLOW BAR.
 *
 * This is where yellow earns its anchor in the daylight half. Everything else
 * down here is white paper on peach, and the direction caps filled yellow at
 * two blocks a screen — this is the one that carries the brand below the band,
 * with the weekly count, the goal meter and the average rating in ONE object
 * rather than a card holding three.
 *
 * The meter track is the brand ink at 22% rather than a white wash, so the bar
 * stays one colour with a darker channel cut into it.
 *
 * EVERY FIGURE ARRIVES AS A PROP AND NONE IS COMPUTED HERE. The bar used to be
 * handed sums of `DEMO_REVIEW_METRICS`; it is now handed the same reporting
 * period the Google Reviews tab renders. What changed in this file is only what
 * a MISSING figure looks like — a null average and an unconfigured goal both
 * draw an em dash rather than a zero, because a 0.00 rating and a 0 goal are
 * claims nobody made.
 */

/** The bar's shell, so every state keeps the block's colour and dimensions. */
const BAR = "flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl bg-brand-yellow px-5 py-4";

export function ReviewsBar({
  gained,
  goal,
  vsLastWeek,
  averageRating,
  salonCount,
  href = "/reviews",
  className,
}: {
  gained: number;
  /** The estate's weekly target, or null when none is configured. */
  goal: number | null;
  vsLastWeek: number;
  /** Null when the period counted no review — never 0 for "none". */
  averageRating: number | null;
  salonCount: number;
  href?: string;
  className?: string;
}) {
  /*
   * THE METER IS CLAMPED; THE COUNT IS NOT. A week that beats its goal fills
   * the bar and still prints what it actually counted.
   */
  const hasGoal = goal !== null && goal > 0;
  const pct = hasGoal ? Math.min(100, Math.round((gained / goal) * 100)) : 0;

  return (
    <div className={cn(BAR, className)}>
      <div className="shrink-0">
        <p className="eyebrow text-brand-yellow-soft-foreground">Reviews gained</p>
        <p className="display-figure mt-1 text-[40px] text-brand-yellow-foreground">
          {vsLastWeek >= 0 ? "+" : ""}
          {formatNumber(gained)}
        </p>
      </div>

      <div className="min-w-[170px] flex-1">
        {hasGoal ? (
          <div
            className="h-[7px] overflow-hidden rounded-sm"
            style={{ background: "var(--meter-track-on-yellow)" }}
            role="progressbar"
            /*
             * `aria-valuenow` STAYS INSIDE ITS OWN RANGE. A value above the
             * maximum is invalid ARIA and is announced unpredictably, so the
             * clamped figure is the one on the range and the real count is
             * spoken by `aria-valuetext`.
             */
            aria-valuenow={Math.min(gained, goal)}
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuetext={`${formatNumber(gained)} of ${formatNumber(goal)}`}
            aria-label="Reviews against the weekly goal"
          >
            <span
              className="block h-full bg-brand-yellow-foreground"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        <p
          className={cn(
            "text-[11px] font-bold text-brand-yellow-soft-foreground",
            hasGoal && "mt-2",
          )}
        >
          {/*
            NO METER MEANS NO PERCENTAGE AND NO INVENTED TARGET. The count, the
            comparison and the rating are all still real; the goal is the one
            thing this deployment has not been told.
          */}
          {hasGoal
            ? `${formatNumber(gained)} of ${formatNumber(goal)} weekly goal`
            : `${formatNumber(gained)} counted · no weekly goal set`}
          {" · "}
          {vsLastWeek >= 0 ? "+" : "−"}
          {formatNumber(Math.abs(vsLastWeek))} vs last week
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3">
        <div>
          <p className="eyebrow text-brand-yellow-soft-foreground">Average rating</p>
          <p className="display-figure mt-1 text-[22px] text-brand-yellow-foreground">
            {/* An em dash, never 0.00: nobody gave us nothing. */}
            {averageRating === null ? "—" : averageRating.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="eyebrow text-brand-yellow-soft-foreground">Weekly goal</p>
          <p className="display-figure mt-1 text-[22px] text-brand-yellow-foreground">
            {goal === null ? "—" : formatNumber(goal)}
          </p>
        </div>
        <div>
          <p className="eyebrow text-brand-yellow-soft-foreground">Salons</p>
          <p className="display-figure mt-1 text-[22px] text-brand-yellow-foreground">
            {formatNumber(salonCount)}
          </p>
        </div>
      </div>

      {/* On yellow the action inverts: the brand ink becomes the fill. */}
      <Link
        href={href}
        className="pill-action shrink-0 bg-brand-yellow-foreground text-brand-yellow"
      >
        Open
      </Link>
    </div>
  );
}

/**
 * THE BLOCK WITH A SENTENCE IN IT INSTEAD OF FIGURES.
 *
 * A sentence, not zeros — the rule the Performance Overview card already
 * follows. "+0 reviews gained, — average, 0 salons" is indistinguishable from a
 * week in which the estate collapsed, and a reader has no way to tell that the
 * integration has simply never run or that a query failed.
 *
 * The Open button stays, because the tab is where the answer is either way.
 */
export function ReviewsBarNotice({
  children,
  href = "/reviews",
  className,
}: {
  children: React.ReactNode;
  href?: string;
  className?: string;
}) {
  return (
    <div className={cn(BAR, className)}>
      <p className="min-w-[170px] flex-1 text-[13px] leading-relaxed font-bold text-brand-yellow-foreground">
        {children}
      </p>
      <Link
        href={href}
        className="pill-action shrink-0 bg-brand-yellow-foreground text-brand-yellow"
      >
        Open
      </Link>
    </div>
  );
}

/** Holds the bar's exact dimensions while the reporting read resolves. */
export function ReviewsBarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(BAR, className)} aria-busy>
      <div className="shrink-0">
        <Skeleton className="h-2 w-24 bg-brand-yellow-foreground/15" />
        <Skeleton className="mt-2 h-[40px] w-24 bg-brand-yellow-foreground/15" />
      </div>
      <div className="min-w-[170px] flex-1">
        <Skeleton className="h-[7px] w-full bg-brand-yellow-foreground/15" />
        <Skeleton className="mt-2 h-2 w-48 bg-brand-yellow-foreground/15" />
      </div>
      <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <Skeleton className="h-2 w-16 bg-brand-yellow-foreground/15" />
            <Skeleton className="mt-2 h-[22px] w-12 bg-brand-yellow-foreground/15" />
          </div>
        ))}
      </div>
      <Skeleton className="h-8 w-20 shrink-0 rounded-full bg-brand-yellow-foreground/15" />
    </div>
  );
}
