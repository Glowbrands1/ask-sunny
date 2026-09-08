import { StatCard } from "@/components/stat-card";
import { cn } from "@/lib/utils/cn";

/**
 * THE KPI ROW, matching the existing Salon Performance cards.
 *
 * `StatCard` takes a `DashboardMetric`, so this wrapper exists for one reason:
 * to make a MISSING figure look like a missing figure. A card is the most
 * quoted thing on the page, and `0` on one is how "the source did not report
 * this" becomes "this salon did nothing" in somebody's summary. So a null
 * value renders as `N/A` with the reason in the helper line, and the helper is
 * required rather than optional — a card whose meaning needs explaining and
 * does not explain it is worse than no card.
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
  /** The headline card, given the accent treatment. At most one. */
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
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {cards.map((card) => (
        <StatCard
          key={card.id}
          emphasis={card.emphasis}
          metric={{
            id: card.id,
            label: card.label,
            value: card.value ?? "N/A",
            helper: card.helper,
            changeLabel: card.changeLabel,
            trend: card.trend,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The trend a signed percentage implies, or undefined.
 *
 * `undefined` rather than `flat` for a missing comparison: `flat` draws a
 * horizontal arrow, which asserts "no change" about something that was never
 * measured.
 */
export function trendFor(
  delta: number | null | undefined,
): "up" | "down" | "flat" | undefined {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return undefined;
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "flat";
}
