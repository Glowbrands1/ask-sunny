import { cn } from "@/lib/utils/cn";
import {
  freshnessSegments,
  type FreshnessFacts,
} from "@/lib/reporting/read/freshness-line";

/**
 * ============================================================================
 * THE ONE FRESHNESS LINE EVERY REPORT SHOWS
 * ============================================================================
 *
 * The 14 September review: "Please add one line to the top of every report...
 * This should replace the current row of four chips, which is harder to scan
 * and inconsistent from tab to tab."
 *
 * ONE COMPONENT, FIVE REPORTS. The chips it replaces were four in one place,
 * three in another and a sentence in a third, each assembled where it was
 * rendered — which is why they had drifted. The segments are built by
 * `lib/reporting/read/freshness-line.ts`, which is pure and tested; this decides
 * only how they look.
 *
 * REMOVED WITH THE CHIPS: "Recipient slice" and "Recipient slice — not
 * company-wide". The review is blunt about it — "That is internal language and
 * will not mean anything to a Salon Director. '15 salons included' communicates
 * the same thing clearly." The FACT it carried is not lost: the salon count is
 * a count of the salons in view, and where the delivery covered more than the
 * reader sees, `detail` below says so in words a manager uses.
 */
export function ReportFreshnessLine({
  facts,
  detail,
  className,
}: {
  facts: FreshnessFacts;
  /**
   * A second line for anything report-specific — the wider delivery this is a
   * slice of, or a note about the window. Kept out of the four segments so the
   * line itself stays scannable and identical everywhere.
   */
  detail?: string | null;
  className?: string;
}) {
  const segments = freshnessSegments(facts);

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {segments.map((segment, index) => (
          <span key={segment} className="flex items-center gap-x-2">
            {index > 0 ? (
              <span aria-hidden className="text-subtle-foreground">
                |
              </span>
            ) : null}
            <span className={index === 0 ? "font-medium text-foreground" : undefined}>
              {segment}
            </span>
          </span>
        ))}
      </p>
      {detail ? <p className="mt-1">{detail}</p> : null}
    </div>
  );
}
