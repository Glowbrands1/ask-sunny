import { ScrollTable } from "@/components/ui/layout";
import { formatMetricValue } from "@/lib/reporting/read/aggregation";
import type { SalonMetricRow } from "@/lib/reporting/read/salon-detail";
import { MetricLineage } from "./metric-lineage";

/**
 * EVERY FIGURE THE REPORT HOLDS FOR THIS SALON.
 *
 * One row per stored fact, which is why there is no "Unavailable" column here:
 * a row exists because a value exists. Listing the sheet's whole catalogue
 * instead would fill the table with absences for measures this salon was never
 * reported for, and a screen of "Unavailable" reads as a broken page rather
 * than as the report's actual shape. What is missing is stated where a manager
 * asked a specific question — the headline cards and the comparison section.
 *
 * EVERY UNIT KEEPS ITS OWN FORMATTING, through one function: currency gets a
 * symbol, counts get separators, a percentage is multiplied by 100 exactly
 * once, a ratio keeps two decimals, a rank gets its `#`. The unit comes from
 * the reviewed vocabulary, so a percentage cannot be rendered as a count by a
 * component that forgot.
 *
 * A `% change` row is the SOURCE'S OWN figure and is labelled as such. It is
 * not recomputed, and it is not hidden either: it is a column the workbook
 * carries, and a manager comparing it against the change shown on a card above
 * is entitled to find the same number.
 */
export function SalonMetricTable({
  rows,
  sourceReport,
  windowLabel,
}: {
  rows: SalonMetricRow[];
  sourceReport: string | null;
  /** The comparison on screen, named in each row's lineage. */
  windowLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        This report holds no figures for this salon under the selected comparison.
      </p>
    );
  }

  return (
    <ScrollTable>
      <table className="data-table min-w-[640px]">
        <caption className="sr-only">
          Every figure this report holds for this salon under {windowLabel}, with the
          basis year and the source column each was read from.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3">
              Measure
            </th>
            <th scope="col" className="pr-3">
              Basis
            </th>
            <th scope="col" data-align="right" className="pr-3">
              Value
            </th>
            <th scope="col" className="">
              <span className="sr-only">Source</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.metricCode}|${row.basisYear ?? "none"}`}
              className="align-top"
            >
              <th scope="row" className="pr-3 text-left font-normal">
                <span className="font-medium text-foreground">{row.label}</span>
                {row.comparisonOfCode !== null ? (
                  <span className="block text-xs text-subtle-foreground">
                    As reported by the source, not recomputed here
                  </span>
                ) : null}
              </th>
              <td className="pr-3 text-muted-foreground">
                {/*
                  A rolling figure carries NO basis year, because the trailing
                  window is the period. Saying "—" there is honest; printing the
                  current year would attach it to a year it does not describe.
                */}
                {row.basisYear ?? "—"}
              </td>
              <td data-align="right" className="pr-3 text-foreground">
                {formatMetricValue(row.value, row.unit)}
              </td>
              <td>
                <MetricLineage
                  label={row.label}
                  windowLabel={
                    row.basisYear !== null ? `basis ${row.basisYear}` : windowLabel
                  }
                  figures={[
                    {
                      heading: "Value",
                      figure: {
                        metricCode: row.metricCode,
                        basisYear: row.basisYear,
                        value: row.value,
                        sourceSheet: row.sourceSheet,
                        sourceColumn: row.sourceColumn,
                      },
                    },
                  ]}
                  sourceReport={sourceReport}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
