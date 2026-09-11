import Link from "next/link";

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
 */
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
  goal: number;
  vsLastWeek: number;
  averageRating: number;
  salonCount: number;
  href?: string;
  className?: string;
}) {
  const pct = goal > 0 ? Math.min(100, Math.round((gained / goal) * 100)) : 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl bg-brand-yellow px-5 py-4",
        className,
      )}
    >
      <div className="shrink-0">
        <p className="eyebrow text-brand-yellow-soft-foreground">Reviews gained</p>
        <p className="display-figure mt-1 text-[40px] text-brand-yellow-foreground">
          {vsLastWeek >= 0 ? "+" : ""}
          {formatNumber(gained)}
        </p>
      </div>

      <div className="min-w-[170px] flex-1">
        <div
          className="h-[7px] overflow-hidden rounded-sm"
          style={{ background: "var(--meter-track-on-yellow)" }}
          role="progressbar"
          aria-valuenow={gained}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-label="Reviews against the weekly goal"
        >
          <span
            className="block h-full bg-brand-yellow-foreground"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] font-bold text-brand-yellow-soft-foreground">
          {formatNumber(gained)} of {formatNumber(goal)} weekly goal
          {" · "}
          {vsLastWeek >= 0 ? "+" : "−"}
          {formatNumber(Math.abs(vsLastWeek))} vs last week
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3">
        <div>
          <p className="eyebrow text-brand-yellow-soft-foreground">Average rating</p>
          <p className="display-figure mt-1 text-[22px] text-brand-yellow-foreground">
            {averageRating.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="eyebrow text-brand-yellow-soft-foreground">Weekly goal</p>
          <p className="display-figure mt-1 text-[22px] text-brand-yellow-foreground">
            {formatNumber(goal)}
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
