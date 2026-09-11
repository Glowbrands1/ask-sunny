import {
  isBehindBenchmark,
  type PerformanceBand,
} from "@/lib/reporting/performance/classification";
import { cn } from "@/lib/utils/cn";

import { formatDelta } from "./format";

/**
 * A SIGNED DIFFERENCE AGAINST A BENCHMARK, CORAL WHEN IT IS A SHORTFALL.
 *
 * The same treatment the Overview's stat panel gives a measure that is behind,
 * reaching the report tables that already carry the comparison. It exists as
 * one component rather than a class at each call site for two reasons.
 *
 * FIRST, THE FLAG AND THE BADGE CANNOT DISAGREE. Every table that shows a
 * `v Chain` or `vs Peers` figure also shows the band beside it as a badge. Two
 * independent expressions of "is this behind" in adjacent cells is how a row
 * ends up coral next to a badge reading At Market — so both now read the band
 * through `isBehindBenchmark`.
 *
 * SECOND, AND THIS IS THE ONE THAT WOULD ACTUALLY MISLEAD SOMEBODY:
 * `reportable` carries the FAST exemption. A FAST level running 28% under the
 * chain is the intended consequence of a decision already taken, so it is shown
 * as a figure and never raised as a finding. The badge column already honours
 * that. Colouring the figure coral anyway would put the single most alarming
 * mark on the page against the one row nobody should act on.
 *
 * NEVER COLOUR ALONE. The sign is in the text (`-10.6%`, not `10.6%`) and the
 * band is named in words in the status column, so the meaning survives
 * greyscale, colour blindness and a printed page.
 */
export function DeltaFigure({
  delta,
  band,
  /** False where the band must not be raised as a finding — see FAST. */
  reportable = true,
  /** Why there is no comparison, for the cell's tooltip. */
  reason,
  className,
}: {
  delta: number | null | undefined;
  band: PerformanceBand | null | undefined;
  reportable?: boolean;
  reason?: string | null;
  className?: string;
}) {
  const behind = reportable && isBehindBenchmark(band);

  return (
    <span
      title={reason ?? undefined}
      className={cn(
        "tabular-nums",
        behind && "font-bold text-measure-flagged-foreground",
        className,
      )}
    >
      {formatDelta(delta)}
    </span>
  );
}
