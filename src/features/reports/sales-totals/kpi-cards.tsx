import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { SalesTotalsFigure, SalesTotalsSubject } from "@/lib/reporting/read/sales-totals-read";
import type { SalesTotalsWindow } from "@/lib/reporting/sales-totals/metric-map";

import { formatSalesTotalsValue } from "./format";

/**
 * THE SIX MEASURES FOR THE SELECTED SCOPE.
 *
 * The hard part of this report is not the numbers, it is saying what they are.
 * Two labelling mistakes are available and both are seriously misleading:
 *
 *   1. CALLING AN AVERAGE A TOTAL. The report's summary block holds per-salon
 *      averages over all 249 salons — "All Salons · Grand Total · $818.45" is
 *      average revenue per salon, not the estate's takings. A card that said
 *      "Grand Total $818.45" for All Salons would understate the business by a
 *      factor of 249 and nobody reading it would know.
 *
 *   2. CONFUSING THE DAY WITH THE MONTH. Both windows come from the same
 *      delivery and look identical. On the first of the month they are even
 *      equal. So every card names its window and its span explicitly rather
 *      than relying on a control elsewhere on the page being remembered.
 *
 * Unavailable is never zero. A blank cell in the source means the figure was
 * not reported, which is a different fact from a zero.
 */
export function SalesTotalsKpiCards({
  subject,
  window,
  reportDate,
  monthStart,
}: {
  subject: SalesTotalsSubject;
  window: SalesTotalsWindow;
  reportDate: string;
  monthStart: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {subject.figures.map((figure) => (
        <MeasureCard
          key={figure.metricCode}
          figure={figure}
          subject={subject}
          window={window}
          reportDate={reportDate}
          monthStart={monthStart}
        />
      ))}
    </div>
  );
}

function MeasureCard({
  figure,
  subject,
  window,
  reportDate,
  monthStart,
}: {
  figure: SalesTotalsFigure;
  subject: SalesTotalsSubject;
  window: SalesTotalsWindow;
  reportDate: string;
  monthStart: string;
}) {
  /*
   * The heading a reader can trust. A summary scope's figure is an average per
   * salon whenever the metric says so; a salon's own Grand Total is its
   * takings. PPTA is an average at every scope, because it is money per
   * transaction.
   */
  const isAverage =
    figure.aggregation === "average" ||
    (subject.kind === "summary" && figure.summaryIsAverage);

  const qualifier =
    figure.aggregation === "average"
      ? "Average per transaction"
      : subject.kind === "summary" && figure.summaryIsAverage
        ? `Average per salon · ${subject.salonCount ?? "?"} salons`
        : "This salon";

  return (
    <Card>
      <CardContent className="space-y-1.5 p-4">
        <p className="eyebrow">{figure.metricLabel}</p>

        <p
          className={cn(
            "text-[26px] leading-none font-semibold tabular-nums",
            figure.value === null ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {figure.value === null
            ? "Unavailable"
            : formatSalesTotalsValue(figure.value, figure.unit)}
        </p>

        {/* WHAT the number is. */}
        <p className={cn("text-[11px]", isAverage ? "text-primary" : "text-muted-foreground")}>
          {qualifier}
        </p>

        {/* WHICH SPAN it covers, named on the card itself. */}
        <p className="border-t border-border pt-1.5 text-[11px] text-muted-foreground">
          {window === "daily" ? (
            <>
              <span className="font-medium text-foreground">Previous day</span> · {reportDate}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Month to date</span> · {monthStart}{" "}
              through {reportDate}
            </>
          )}
        </p>

        {figure.value === null ? (
          <p className="text-[11px] text-muted-foreground">
            Not reported in this delivery — not zero.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
