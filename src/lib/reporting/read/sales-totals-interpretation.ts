import { isPptaUnusable, PPTA_DEFINITION } from "../ppta";
import {
  NOTHING_TO_READ,
  count,
  list,
  money,
  plural,
  ratio,
  type ReportInterpretation,
} from "./interpretation-kit";
import type { AggregatedFigure } from "./sales-totals-aggregate";
import type { SalesTotalsSubject } from "./sales-totals-read";

/**
 * ============================================================================
 * WHAT A SALES TOTALS DELIVERY SHOWS, IN SENTENCES
 * ============================================================================
 *
 * The one report on a DAILY cadence, and the only one whose figures are money.
 * Both facts shape what can honestly be said about it.
 *
 * NO PERIOD COMPARISON IS ATTEMPTED. The delivery carries one report date and
 * its month to date, and nothing else — no prior day, no prior month, no last
 * year. "Down on yesterday" is not available from this data, so it is not said.
 * This is the difference between a reading and a narrative, and it is the whole
 * reason this is derived rather than written.
 *
 * A FLAGGED PPTA IS A DATA QUESTION, NEVER A PERFORMANCE FINDING. A salon with
 * a non-positive or absurd PPTA is named as needing the delivery checked and is
 * excluded from the leader and laggard sentences entirely — see
 * `lib/reporting/ppta.ts` and the trace in `docs/ppta-trace-2026-09-14.md`.
 * Ranking a salon last on a figure the source could not produce is exactly the
 * mistake the review found.
 */

export interface SalesTotalsInterpretationInput {
  /** The selected salons' own rows. Never the estate summary population. */
  readonly salons: readonly SalesTotalsSubject[];
  /** Combined figures for the selection, by metric code. */
  readonly figures: readonly AggregatedFigure[];
  /** `Report day` or `Month to date`, for a sentence that says which. */
  readonly windowLabel: string;
  /** How many salons the whole delivery carries, for context on a selection. */
  readonly deliverySalonCount: number;
}

function figure(
  figures: readonly AggregatedFigure[],
  code: string,
): AggregatedFigure | null {
  return figures.find((entry) => entry.metricCode === code) ?? null;
}

/** One salon's value for a metric, or null when it did not report one. */
function valueOf(salon: SalesTotalsSubject, code: string): number | null {
  const found = salon.figures.find((entry) => entry.metricCode === code);
  return found?.value ?? null;
}

export function interpretSalesTotals(
  input: SalesTotalsInterpretationInput,
): ReportInterpretation {
  const { salons, figures, windowLabel } = input;
  if (salons.length === 0) return NOTHING_TO_READ;

  const points: string[] = [];
  const window = windowLabel.toLowerCase();

  /* ------------------------------------------------------------- headline -- */
  const revenue = figure(figures, "grand_total");
  const tans = figure(figures, "tans");
  const ppta = figure(figures, "ppta");

  const revenueText = money(revenue?.value ?? null, 2);
  const tansText = count(tans?.value ?? null);

  const headline =
    revenueText && tansText
      ? `${revenueText} across ${salons.length} ${plural(salons.length, "salon")} on ${tansText} tans, for the ${window} window.`
      : `${salons.length} ${plural(salons.length, "salon")} in view, for the ${window} window.`;

  if (salons.length < input.deliverySalonCount) {
    points.push(
      `This is ${salons.length} of the ${input.deliverySalonCount} salons the delivery carries; the figures above cover the selection only.`,
    );
  }

  /* ----------------------------------------------------------------- PPTA -- */
  /*
   * THE FLAGGED SALONS COME FIRST, before any leader or laggard sentence, so a
   * reader knows which figures are in question before they read a comparison
   * that might have used one.
   */
  const flagged = salons.filter((salon) => isPptaUnusable(valueOf(salon, "ppta")));
  if (flagged.length > 0) {
    points.push(
      `${flagged.length} ${plural(flagged.length, "salon")} ${
        flagged.length === 1 ? "reports" : "report"
      } a PPTA outside what product sales per tan can take — ${list(
        flagged.map((salon) => salon.label),
      )}. That is a question for the delivery, not a performance finding, and ${
        flagged.length === 1 ? "it is" : "they are"
      } left out of the comparisons below.`,
    );
  }

  if (ppta?.value !== null && ppta?.value !== undefined) {
    points.push(
      `PPTA across the selection is ${money(ppta.value, 2)} — ${PPTA_DEFINITION.toLowerCase()}${
        ppta.basis === "weighted"
          ? ", weighted by each salon's own tans rather than averaged across salons"
          : ""
      }.`,
    );
  }

  /* ------------------------------------------------------- who leads, who -- */
  const usable = salons.filter((salon) => !isPptaUnusable(valueOf(salon, "ppta")));
  const withPpta = usable
    .map((salon) => ({ salon, value: valueOf(salon, "ppta") }))
    .filter((entry): entry is { salon: SalesTotalsSubject; value: number } => entry.value !== null)
    .sort((a, b) => b.value - a.value);

  if (withPpta.length >= 2) {
    const best = withPpta[0];
    const worst = withPpta[withPpta.length - 1];
    points.push(
      `On PPTA the spread runs from ${money(best.value, 2)} at ${best.salon.label} to ${money(
        worst.value,
        2,
      )} at ${worst.salon.label}. Product attachment is the behaviour behind that gap, and it is coachable in a shift.`,
    );
  }

  /* ------------------------------------------------------------ new EFTs -- */
  const efts = figure(figures, "efts");
  const newCustomers = figure(figures, "new_customers");
  if (efts?.value !== null && efts?.value !== undefined && tansText) {
    points.push(
      `${count(efts.value)} ${plural(efts.value, "EFT membership")} taken${
        newCustomers?.value !== null && newCustomers?.value !== undefined
          ? ` and ${count(newCustomers.value)} new ${plural(newCustomers.value, "customer")}`
          : ""
      } over the same ${window} window.`,
    );
  }

  /* ------------------------------------------- what is NOT in this report -- */
  /*
   * Said out loud, because the absence is the most common wrong assumption
   * about this delivery: it holds one date and its month to date, and a reader
   * looking for a trend will otherwise read the two as one.
   */
  const perSalon = revenue?.meanPerSalon ?? null;
  if (perSalon !== null && salons.length > 1) {
    points.push(
      `That averages ${money(perSalon, 2)} per salon, over the ${ratio(
        revenue?.reportingSalons ?? 0,
        0,
      )} that reported a figure.`,
    );
  }

  return { headline, points, unavailableReason: null };
}
