import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { AggregatedFigure } from "@/lib/reporting/read/sales-totals-aggregate";
import { SALES_TOTALS_MEASURES_BY_CODE } from "@/lib/reporting/sales-totals/metric-map";
import { figureHeading } from "@/lib/reporting/read/sales-totals-aggregate";
import type { SalesTotalsWindow } from "@/lib/reporting/sales-totals/metric-map";

import { formatSalesTotalsValue } from "./format";

/**
 * THE SELECTED SALONS' OWN FIGURES.
 *
 * These are the only numbers on the page that add up, and the headings say
 * which operation produced each one. Three cases, and the card never lies
 * about which it is in:
 *
 *   SUMMED     several salons, an additive measure. "Total sales $11,838.81",
 *              with the mean per salon as a secondary line — because a manager
 *              wants both and only one of them is the headline.
 *   REPORTED   one salon, or one salon's PPTA. Its own figure, untouched.
 *   REFUSED    PPTA across several salons. No number, and the reason. PPTA is
 *              money per transaction; combining it needs transaction counts as
 *              weights and the report does not publish them. A sum would be
 *              meaningless and a plain mean would be a different number
 *              wearing an authoritative label.
 *
 * "Total" appears only where a total was actually computed. That is the whole
 * correction: the previous version put the source's column name ("Grand Total")
 * on a per-salon average, so $734.50 for 98 consolidated salons sat next to one
 * salon's $958.79 and the dashboard looked broken.
 */
export function SelectedSalonCards({
  figures,
  window,
  reportDate,
  monthStart,
}: {
  figures: readonly AggregatedFigure[];
  window: SalesTotalsWindow;
  reportDate: string;
  monthStart: string;
}) {
  if (figures.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Select at least one salon to see its figures.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {figures.map((figure) => {
        const measure = SALES_TOTALS_MEASURES_BY_CODE[figure.metricCode];
        const heading = figureHeading(measure, "salon", figure.selectedSalons);
        const refused = figure.basis === "not_aggregatable";

        return (
          <Card key={figure.metricCode} className={cn(refused && "border-dashed")}>
            <CardContent className="space-y-1.5 p-4">
              <p className="eyebrow">{heading}</p>

              <p
                className={cn(
                  "text-[26px] leading-none font-semibold tabular-nums",
                  figure.value === null ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {figure.value === null
                  ? refused
                    ? "Not comparable"
                    : "Unavailable"
                  : formatSalesTotalsValue(figure.value, figure.unit)}
              </p>

              {/* HOW the number was arrived at, in plain words. */}
              {figure.basis === "summed" ? (
                <p className="text-[11px] text-muted-foreground">
                  Sum across {figure.reportingSalons}
                  {figure.reportingSalons === 1 ? " salon" : " salons"}
                  {figure.reportingSalons < figure.selectedSalons
                    ? ` (${figure.selectedSalons - figure.reportingSalons} did not report)`
                    : ""}
                </p>
              ) : null}

              {figure.basis === "reported" && figure.value !== null ? (
                <p className="text-[11px] text-muted-foreground">
                  As reported for this salon
                </p>
              ) : null}

              {/* The companion average. Secondary, and never the headline. */}
              {figure.meanPerSalon !== null && figure.selectedSalons > 1 ? (
                <p className="text-[11px] text-muted-foreground">
                  Average per selected salon{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatSalesTotalsValue(figure.meanPerSalon, figure.unit)}
                  </span>
                </p>
              ) : null}

              {refused && figure.reason ? (
                <p className="text-[11px] leading-snug text-subtle-foreground">
                  {figure.reason}
                </p>
              ) : null}

              {/* WHICH SPAN, on the card, so the window control never has to be
                  remembered from elsewhere on the page. */}
              <p className="border-t border-border pt-1.5 text-[11px] text-muted-foreground">
                {window === "daily" ? (
                  <>
                    <span className="font-medium text-foreground">Previous day</span> ·{" "}
                    {reportDate}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">Month to date</span> ·{" "}
                    {monthStart} through {reportDate}
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
