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

/**
 * ============================================================================
 * TWO PERCENT REPRESENTATIONS LIVE IN THIS CODEBASE. NAME THE ONE YOU HAVE.
 * ============================================================================
 *
 * They are not interchangeable and they look identical at a call site, which is
 * how Salon Performance came to print `+0.0%` under a card reading `+4.64%`:
 *
 *   PERCENTAGE POINTS  `percentDifference()` returns `(a / b - 1) * 100`, so
 *                      +127.4 means +127.4%. The classification ladders take
 *                      the same scale — `SPA_PEER_LADDER` has floors of 10, -5
 *                      and -15 — and every bed/spa comparison is in it.
 *
 *   A FRACTION         a stored `*_pct_change` fact is the source's own value,
 *                      0.0464 for +4.64%. The KPI cards, the chart tooltips and
 *                      the Ask Sunny briefing all render these through
 *                      something that multiplies by 100.
 *
 * `signed` takes POINTS. `signedRate` takes a FRACTION. Neither guesses, and
 * the multiplication happens once, here, rather than at the call sites — a
 * `* 100` scattered into a component is the same bug waiting to be reintroduced
 * somewhere a test is not looking.
 *
 * NEGATIVE ZERO IS NORMALISED. A change of -0.00004 rounds to zero, and
 * "-0.00%" reads as a decline that did not happen. A value that rounds to
 * nothing is shown as nothing, without a sign.
 */
export function signed(percentPoints: number | null | undefined, digits = 1): string | null {
  if (percentPoints === null || percentPoints === undefined || !Number.isFinite(percentPoints)) {
    return null;
  }
  const body = Math.abs(percentPoints).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Rounds to zero: no sign, because neither "+" nor "-" is true of it.
  if (Number(body.replace(/,/g, "")) === 0) return `${body}%`;
  return `${percentPoints < 0 ? "-" : "+"}${body}`.concat("%");
}

/**
 * A stored FRACTION as a signed percentage: `0.0464` -> `"+4.64%"`.
 *
 * Two decimal places by default, because this is what the headline cards show
 * and the reading beside them has to agree digit for digit. A manager comparing
 * "+4.6%" in a sentence with "+4.64%" on a card has to work out whether they
 * are the same number.
 */
export function signedRate(fraction: number | null | undefined, digits = 2): string | null {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return null;
  return signed(fraction * 100, digits);
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
