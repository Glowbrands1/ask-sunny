import {
  NOTHING_TO_READ,
  count,
  list,
  plural,
  signed,
  type ReportInterpretation,
} from "./interpretation-kit";
import type { DashboardKpi, Movers, SalonRankingRow } from "./dashboard";

/**
 * ============================================================================
 * WHAT A SALON PERFORMANCE WINDOW SHOWS, IN SENTENCES
 * ============================================================================
 *
 * The only report with a real PERIOD COMPARISON in it, which is what it is for
 * and is also the one thing it can most easily lie about.
 *
 * THE COMPARISON IS NAMED, ALWAYS. Every change sentence says what it is a
 * change AGAINST, using the card's own `baselineLabel`. The review found the
 * page comparing to 2024 while the reader assumed 2025; a reading that said
 * "+7.1%" without naming the baseline would reproduce that defect in prose
 * after it had been fixed in the data.
 *
 * DIRECTION IS NOT SENTIMENT. `higherIsBetter` is null for measures where the
 * business has not said which way is good, and nothing here calls a movement
 * good or bad. An increase is reported as an increase and nothing more.
 *
 * A MEASURE THE WINDOW DOES NOT SUPPORT PRODUCES NO CHANGE SENTENCE.
 * `buildKpiCards` marks those unsupported, and reading one as "flat" would
 * invent a comparison the source never made. They are named at the end instead,
 * so their absence is explained rather than silent.
 */

export interface SalonPerformanceInterpretationInput {
  readonly kpis: readonly DashboardKpi[];
  /** Rows for the measure the reader has selected, already sorted. */
  readonly rows: readonly SalonRankingRow[];
  readonly movers: Movers;
  /** The selected measure's label, for the movement sentences. */
  readonly metricLabel: string;
  readonly windowLabel: string;
}

/** A change that exists, is supported, and can be spoken about. */
function comparable(kpi: DashboardKpi): boolean {
  return kpi.supported !== false && kpi.change.value !== null && kpi.baselineLabel !== null;
}

export function interpretSalonPerformance(
  input: SalonPerformanceInterpretationInput,
): ReportInterpretation {
  const { kpis, rows, movers, metricLabel, windowLabel } = input;
  if (kpis.length === 0 && rows.length === 0) return NOTHING_TO_READ;

  const points: string[] = [];

  const salonCount = kpis[0]?.salonCount ?? rows.length;
  const headline = `${count(salonCount)} ${plural(salonCount, "salon")} over ${windowLabel.toLowerCase()}.`;

  /* --------------------------------------------------- the headline moves -- */
  const moved = kpis.filter(comparable);

  if (moved.length === 0) {
    points.push(
      "None of the headline measures has a comparison in this window, so nothing here is a change — the figures are levels only.",
    );
  } else {
    /*
     * ONE SENTENCE PER MEASURE, each naming its OWN baseline. They can differ:
     * a rolling window compares against a different span from a year-to-date
     * one, and the cards carry their own labels for exactly that reason.
     */
    for (const kpi of moved) {
      points.push(`${kpi.label} is ${signed(kpi.change.value)} against ${kpi.baselineLabel}.`);
    }
  }

  /* ------------------------------------------------------- who moved most -- */
  if (!movers.comparable) {
    points.push(
      `No salon has a comparable figure for ${metricLabel} in this window, so there are no movements to read.`,
    );
    return { headline, points, unavailableReason: null };
  }

  if (movers.gainers.length > 0) {
    const top = movers.gainers[0];
    points.push(
      `On ${metricLabel} the largest increase is ${top.storeName} at ${signed(top.change)}${
        movers.gainers.length > 1
          ? `, with ${movers.gainers.length - 1} other ${plural(
              movers.gainers.length - 1,
              "salon",
            )} up as well`
          : ""
      }.`,
    );
  }

  /*
   * AN EMPTY DECLINERS LIST IS A FINDING, not a blank. The review asked for it
   * by name: "the Decreases panel is empty with no explanation". Every salon
   * being up is worth saying, and is not the same as the figures being missing.
   */
  if (movers.decliners.length === 0) {
    points.push(
      `No salon is down on ${metricLabel} in this window — the decreases list is empty because there are none, not because the figures are missing.`,
    );
  } else {
    const worst = movers.decliners[0];
    points.push(
      `${movers.decliners.length} ${plural(movers.decliners.length, "salon")} ${
        movers.decliners.length === 1 ? "is" : "are"
      } down, steepest at ${worst.storeName} with ${signed(worst.change)}${
        movers.decliners.length > 1
          ? ` — also ${list(movers.decliners.slice(1, 4).map((row) => row.storeName))}`
          : ""
      }.`,
    );
  }

  /* -------------------------------------------------- what could not move -- */
  const unsupported = kpis.filter((kpi) => kpi.supported === false);
  if (unsupported.length > 0) {
    points.push(
      `${list(unsupported.map((kpi) => kpi.label))} ${
        unsupported.length === 1 ? "is" : "are"
      } not reported for this window, so ${
        unsupported.length === 1 ? "it is" : "they are"
      } absent above rather than zero.`,
    );
  }

  return { headline, points, unavailableReason: null };
}
