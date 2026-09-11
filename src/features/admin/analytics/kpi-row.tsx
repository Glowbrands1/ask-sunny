import { StatColumn, StatPanel } from "@/components/ui/marquee";
import { formatNumber } from "@/lib/utils/format";
import { changeAgainst, type AnalyticsTotals } from "@/lib/analytics/queries";

/**
 * THE FIVE FIGURES THE PAGE OPENS WITH.
 *
 * One panel divided by hairlines, never a card each — the frozen stat treatment.
 * A figure reads as the largest thing on screen only when nothing is drawn
 * around it, and five bordered boxes make five objects that run together.
 *
 * WHAT IS DELIBERATELY NOT HERE: an average response time. The reference
 * dashboard leads with one, and Ask Sunny cannot honestly produce it yet —
 * latency is recorded from this release forward and only for chat, so a figure
 * shown today would describe a handful of turns and be read as describing the
 * product. It appears when there is a month of it to average.
 */
export function AnalyticsKpiRow({
  totals,
  previous,
  periodLabel,
}: {
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  periodLabel: string;
}) {
  return (
    <StatPanel className="xl:grid-cols-5">
      <StatColumn
        label="Total activity"
        value={formatNumber(totals.events)}
        delta={deltaLabel(totals.events, previous.events)}
        period={periodLabel}
      />
      <StatColumn
        label="Active leaders"
        value={formatNumber(totals.activeUsers)}
        delta={deltaLabel(totals.activeUsers, previous.activeUsers)}
        period={periodLabel}
      />
      <StatColumn
        label="Active locations"
        value={formatNumber(totals.activeSalons)}
        delta={deltaLabel(totals.activeSalons, previous.activeSalons)}
        period={periodLabel}
      />
      <StatColumn
        label="Forms created"
        value={formatNumber(totals.forms)}
        delta={deltaLabel(totals.forms, previous.forms)}
        period={periodLabel}
      />
      <StatColumn
        label="Reports analysed"
        value={formatNumber(totals.reports)}
        delta={deltaLabel(totals.reports, previous.reports)}
        period={periodLabel}
      />
    </StatPanel>
  );
}

/**
 * The comparison line, or an honest sentence when there is nothing to compare.
 *
 * NO PERCENTAGE AGAINST A ZERO BASELINE. `changeAgainst` returns null there and
 * this says "none in the prior period" instead of inventing "+700%". The
 * reference screenshots are full of four-figure percentages — +1475%, +650% —
 * and every one of them is a small number divided by a smaller one. A first
 * week of use is a real thing to report; dressing it as growth is not.
 *
 * Neither direction is coloured. A rise in adoption is good and a fall is bad,
 * but this system's one green is reserved for a business measure whose
 * `higher_is_better` the catalogue states, reached through `sentimentFor`;
 * borrowing it for an operational count would be the dashboard asserting a
 * judgement through a token that means something narrower.
 */
function deltaLabel(current: number, previous: number): string | undefined {
  const change = changeAgainst(current, previous);
  if (change === null) {
    if (current === 0) return undefined;
    return "first activity in this window";
  }
  const rounded = Math.round(change);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}% vs prior ${formatNumber(previous)}`;
}
