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
 * with the review inventory and its average rating in ONE object rather than a
 * card holding three.
 *
 * ============================================================================
 * WHAT THE BAR STOPPED CARRYING, AND WHY THE SHELL IS UNCHANGED
 * ============================================================================
 *
 * The goal meter, "X of Y weekly goal", "± N vs last week" and the "Weekly
 * goal" cell are gone. All four described the open REPORTING PERIOD, which is
 * `/reviews`'s subject and not this block's: every one of them reads zero until
 * a listing's baseline has been set and a review has arrived above it, which is
 * correct there and unreadable on a landing page.
 *
 * The shell did not change with them. Same rounded yellow field, same padding,
 * same eyebrow-over-figure cells, same inverted pill action on the right. The
 * meter's column becomes the spacer that keeps the figures left and the action
 * right, so the bar keeps its proportions at every width it had before.
 *
 * EVERY FIGURE ARRIVES AS A PROP AND NONE IS COMPUTED HERE.
 */

/** The bar's shell, so every state keeps the block's colour and dimensions. */
const BAR = "flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl bg-brand-yellow px-5 py-4";

export function ReviewsBar({
  totalReviews,
  averageRating,
  salonCount,
  href = "/reviews",
  className,
}: {
  /** Every review record held — never a sync's fetched count. */
  totalReviews: number;
  /** Null only when no review is held at all — never 0.00 for "none". */
  averageRating: number | null;
  salonCount: number;
  href?: string;
  className?: string;
}) {
  return (
    <div className={cn(BAR, className)}>
      <div className="shrink-0">
        <p className="eyebrow text-brand-yellow-soft-foreground">Total reviews</p>
        <p className="display-figure mt-1 text-[40px] text-brand-yellow-foreground">
          {/*
            NO SIGN. The old headline carried a "+" driven by the week-over-week
            delta; an inventory has no direction, and a "+88" would read as
            eighty-eight arrivals rather than eighty-eight reviews held.
          */}
          {formatNumber(totalReviews)}
        </p>
      </div>

      {/* The meter's column, keeping the figures and the action where they were. */}
      <div aria-hidden className="min-w-[170px] flex-1" />

      <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3">
        <div>
          <p className="eyebrow text-brand-yellow-soft-foreground">Average rating</p>
          <p className="display-figure mt-1 text-[22px] text-brand-yellow-foreground">
            {/* An em dash, never 0.00: nobody gave us nothing. */}
            {averageRating === null ? "—" : averageRating.toFixed(2)}
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
 * follows. "0 reviews, — average, 0 salons" is indistinguishable from an estate
 * that lost everything, and a reader has no way to tell that the integration
 * has simply never run or that a query failed.
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

/** Holds the bar's exact dimensions while the review read resolves. */
export function ReviewsBarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(BAR, className)} aria-busy>
      <div className="shrink-0">
        <Skeleton className="h-2 w-24 bg-brand-yellow-foreground/15" />
        <Skeleton className="mt-2 h-[40px] w-24 bg-brand-yellow-foreground/15" />
      </div>
      <div aria-hidden className="min-w-[170px] flex-1" />
      <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3">
        {[0, 1].map((index) => (
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
