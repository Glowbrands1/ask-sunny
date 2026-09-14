/**
 * ============================================================================
 * THE SHARED PARTS OF A REPORT'S PLAIN-LANGUAGE READING
 * ============================================================================
 *
 * The review asked every report to land on four headline metrics, one chart,
 * one plain-language interpretation and the detail behind a disclosure. Five
 * reports need that interpretation and they read different data, so each has
 * its own module — but the SHAPE and the NUMBER FORMATTING have to be shared,
 * because two reports rounding differently is exactly the sort of thing a
 * reader notices and cannot explain.
 *
 * THE FOUR RULES EVERY INTERPRETER FOLLOWS, restated here because they belong
 * to the idea rather than to any one report:
 *
 *   1. EVERY SENTENCE CARRIES ITS OWN FIGURE. Not "utilization is strong" but
 *      "24.1 tans per bed against the chain's 23.0". A reader who disagrees can
 *      check it, and a sentence with a number in it cannot drift away from the
 *      data the way an adjective can.
 *
 *   2. A NULL PRODUCES NO SENTENCE. Where a figure is missing the point is
 *      omitted, never softened into a guess and never rendered as a zero.
 *
 *   3. NOTHING FLAGGED AS A DATA ISSUE IS READ AS PERFORMANCE. A figure the
 *      source could not produce honestly is a question about the delivery, and
 *      saying so is not the same as saying a salon did badly.
 *
 *   4. NO RECOMMENDATION IS ISSUED. These describe what the period shows. They
 *      do not authorise a purchase, a discipline or a decision.
 *
 * THE FORMATTERS RETURN `null` FOR A NULL rather than a dash, so a caller has
 * to decide what an absent figure means instead of printing "—" into the middle
 * of a sentence.
 */

/** One report's reading: a headline, its supporting points, or a reason. */
export interface ReportInterpretation {
  /** One sentence naming what the period shows. Empty when unavailable. */
  readonly headline: string;
  /** Supporting sentences, each derived from a figure in the view. */
  readonly points: readonly string[];
  /** Why nothing could be said. Null when the reading is available. */
  readonly unavailableReason: string | null;
}

export const NOTHING_TO_READ: ReportInterpretation = {
  headline: "",
  points: [],
  unavailableReason: "This period has no figures to read.",
};

export function count(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString("en-US");
}

export function ratio(value: number | null | undefined, digits = 1): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A FRACTION as a percentage: 0.1868 -> "18.7%". */
export function rate(value: number | null | undefined, digits = 1): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${(value * 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** A percentage difference, with its sign always shown: "+7.1%", "-13.0%". */
export function signed(percent: number | null | undefined, digits = 1): string | null {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  const body = Math.abs(percent).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${percent < 0 ? "-" : "+"}${body}`.concat("%");
}

export function money(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** `a, b and c`, for a list a person reads rather than scans. */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
