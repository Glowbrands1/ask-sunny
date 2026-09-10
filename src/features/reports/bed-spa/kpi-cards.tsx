import { cn } from "@/lib/utils/cn";

/**
 * THE KPI ROW FOR BED USAGE, SPA ENGAGEMENT AND SPA WELLNESS.
 *
 * ONE PANEL ON HAIRLINES, not a card each — the approved stat treatment,
 * reaching the three reports that were still drawing four bordered boxes. The
 * argument is the direction's own: a figure only reads as the largest thing on
 * the page when nothing is boxed around it, and four bordered boxes make four
 * objects that run together.
 *
 * WHAT DID NOT CHANGE, AND IT IS THE WHOLE REASON THIS WRAPPER EXISTS. A null
 * value renders as `N/A`, never as `0` — a card is the most quoted thing on the
 * page, and `0` is how "the source did not report this" becomes "this salon did
 * nothing" in somebody's summary. The helper line stays REQUIRED rather than
 * optional: a card whose meaning needs explaining and does not explain it is
 * worse than no card. Both survived the restyle intact.
 *
 * EMPHASIS IS A BIGGER FIGURE, NOT A DIFFERENT COLOUR. The headline card used
 * to be a soft navy panel, which is the one thing the treatment removes —
 * hierarchy in this direction comes from the size of the display figure. The
 * flag is spent on measures that are behind, and nothing else may take it.
 */

export interface KpiCard {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted. Null renders as `N/A`. */
  readonly value: string | null;
  /** One line saying what the figure is, or why it is unavailable. */
  readonly helper: string;
  /** A signed change line, where a comparison exists. */
  readonly changeLabel?: string;
  readonly trend?: "up" | "down" | "flat";
  /** The headline card, given the larger figure. At most one. */
  readonly emphasis?: boolean;
}

export function KpiCardRow({
  cards,
  className,
}: {
  cards: readonly KpiCard[];
  className?: string;
}) {
  return (
    <div className={cn("stat-grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {cards.map((card) => {
        /*
         * DOWN IS BEHIND, HERE. Every trend these three reports pass is a
         * difference against a benchmark — the chain average, or the average
         * across peers who have the same equipment installed — so a negative
         * one is a shortfall rather than merely a direction. Up and flat read
         * neutral: green is out of the system, and a row where something is
         * always coloured teaches managers to ignore the colour.
         */
        const behind = card.trend === "down";

        return (
          <div key={card.id}>
            <p className={cn("eyebrow", behind && "text-measure-flagged-foreground")}>
              {card.label}
            </p>

            <p
              className={cn(
                "display-figure mt-2 text-foreground",
                card.emphasis ? "text-[34px]" : "text-[26px]",
              )}
            >
              {card.value ?? "N/A"}
            </p>

            {card.changeLabel ? (
              <p
                className={cn(
                  "mt-1.5 text-[10.5px] font-bold tabular-nums",
                  behind ? "text-measure-flagged-foreground" : "text-muted-foreground",
                )}
              >
                {/* The word, so the meaning never rests on the colour. */}
                {behind ? <span className="sr-only">Behind benchmark: </span> : null}
                {card.changeLabel}
              </p>
            ) : null}

            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {card.helper}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The trend a signed percentage implies, or undefined.
 *
 * `undefined` rather than `flat` for a missing comparison: `flat` used to draw
 * a horizontal arrow and now reads as a neutral change line, and either way it
 * asserts "no change" about something that was never measured.
 */
export function trendFor(
  delta: number | null | undefined,
): "up" | "down" | "flat" | undefined {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return undefined;
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "flat";
}
