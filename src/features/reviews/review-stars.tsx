import { Star } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * A RATING, AS STARS AND AS A NUMBER.
 *
 * Never conveyed by shape alone: the stars are `aria-hidden` and the number
 * beside them is what a screen reader announces, which is also what makes the
 * page readable in greyscale and on a printed pack.
 *
 * Shared by the tiles, the feed and the detail panel so a 3-star review looks
 * the same everywhere it appears.
 */
export function Stars({
  rating,
  showNumber = true,
  className,
}: {
  rating: number;
  showNumber?: boolean;
  className?: string;
}) {
  const whole = Math.round(rating);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={index}
            className={cn(
              "size-3",
              index < whole ? "fill-gold text-gold" : "text-border-strong",
            )}
          />
        ))}
      </span>
      {showNumber ? (
        <span className="text-[11px] font-black tabular-nums">
          {Number.isInteger(rating) ? rating : rating.toFixed(2)}
        </span>
      ) : null}
      <span className="sr-only">
        {Number.isInteger(rating) ? rating : rating.toFixed(2)} out of 5 stars
      </span>
    </span>
  );
}

/**
 * THE WEEKLY REPORTING VERDICT, ON EVERY REVIEW.
 *
 * Spelled out rather than implied by the rating, because the rule is a business
 * directive rather than something a reader should have to remember: 3, 4 and 5
 * count; 1 and 2 are stored, shown, worked — and do not raise the number.
 */
export function WeeklyEligibility({ eligible }: { eligible: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[10.5px] font-bold",
        /*
         * THE STATUS TOKEN, NOT THE DELTA TOKEN, and the distinction is the one
         * `theme-semantics.test.ts` exists to keep. `--delta-up` colours a
         * MOVEMENT and may only be spent where the business has said which
         * direction is better, which is why every user of it has to go through
         * `sentimentFor`. This is not a movement: it is the two states of a
         * stated rule — 3 stars and up counts toward the weekly total, 1 and 2
         * do not — and `status-outperforming` is the token this design system
         * already uses for "the business says this is the good state", in the
         * same StatusChip the leaderboard draws.
         */
        eligible ? "text-status-outperforming" : "text-measure-flagged-foreground",
      )}
    >
      <span aria-hidden>{eligible ? "✓" : "✕"}</span>
      {eligible ? "Counts toward weekly total" : "Does NOT count toward weekly total"}
    </span>
  );
}
