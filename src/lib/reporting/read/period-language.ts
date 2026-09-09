import {
  REPORT_PERIOD_TYPE_LABEL,
  type ReportFamily,
  type ReportPeriodTypeId,
} from "./report-families";

/**
 * ============================================================================
 * "LAST MONTH", RESOLVED AGAINST WHAT WAS ACTUALLY INGESTED
 * ============================================================================
 *
 * A manager does not say `mtd:2026-08-31`. They say "last month", "year to
 * date", "how are we doing this month", "what about July". Before this module
 * every one of those was answered from the NEWEST period, silently — so "how
 * did we do last month" got this month's figures under a heading that said
 * nothing about which month it was.
 *
 * Two halves, deliberately separate:
 *
 *   `detectPeriodIntent`   pure text. What window did they ASK for.
 *   `resolvePeriod`        pure data. Which stored period IS that, if any.
 *
 * NOTHING HERE KNOWS WHAT MONTH IT IS. The resolution is relative to the
 * PERIODS THAT EXIST, never to a clock and never to a constant. "Last month"
 * means the period before the newest one this family holds; if the newest
 * delivery is October's, last month is September's, and nothing had to be
 * edited in between. That is the whole point: `CURRENT_BASIS_YEAR = 2026` and
 * `DEMO_ANCHOR = "2026-08-26"` are the two ways this codebase has previously
 * frozen time, and neither is reachable from here.
 *
 * ============================================================================
 * WHY A REFUSAL IS A RESULT AND NOT A FALLBACK
 * ============================================================================
 *
 * Four things can go wrong, and each needs a different sentence:
 *
 *   nothing is ingested at all;
 *   the family does not DELIVER that window (Bed Usage has no year to date);
 *   the family delivers it but that period has not arrived (asked for July,
 *     only August is loaded);
 *   there is only one period, so there is no "previous".
 *
 * `resolvePeriod` returns the reason rather than quietly handing back the
 * newest period, because a manager asking about July and being shown August is
 * the failure that looks most like an answer. The one place a fallback IS
 * correct is a question that named no window at all — and that case is
 * reported as `fellBackToLatest` so the briefing can say which period it read.
 */

/* -------------------------------------------------------------- detection -- */

export type PeriodIntentKind =
  /** "latest", "current", "most recent", "right now". */
  | "latest"
  /** "last month", "previous month", "the month before". */
  | "previous"
  /** "this month", "month to date", "MTD". */
  | "month_to_date"
  /** "this year", "year to date", "YTD". */
  | "year_to_date"
  /** "last twelve months", "LTM", "trailing twelve". */
  | "last_twelve_months"
  /** A named month, with or without a year: "July", "Aug 2026". */
  | "named_month";

export interface PeriodIntent {
  readonly kind: PeriodIntentKind;
  /** 1-12. Set only for `named_month`. */
  readonly month: number | null;
  /** Four-digit year. Set only when the question stated one. */
  readonly year: number | null;
  /** The words that matched, so a briefing can echo what was asked for. */
  readonly phrase: string;
}

/**
 * Phrases, longest first within each kind.
 *
 * `this month` maps to month-to-date rather than to a named month, because that
 * is what the reports deliver: no source here carries a completed calendar
 * month distinct from its month-to-date accumulation.
 *
 * `today` and `yesterday` are DELIBERATELY ABSENT. They are not period
 * selectors in this data — every family's newest delivery already is the most
 * recent day or month available, and mapping "today" onto a period would let
 * Sunny imply it holds figures for a day that has not been delivered. Freshness
 * handles that honestly instead: see `report-freshness.ts`.
 */
const INTENT_PHRASES: readonly { kind: PeriodIntentKind; phrases: readonly string[] }[] = [
  {
    kind: "last_twelve_months",
    phrases: [
      "last twelve months",
      "last 12 months",
      "trailing twelve months",
      "trailing 12 months",
      "rolling twelve months",
      "rolling 12 months",
      "ltm",
    ],
  },
  {
    kind: "year_to_date",
    phrases: ["year to date", "year-to-date", "ytd", "this year", "so far this year"],
  },
  {
    kind: "month_to_date",
    phrases: [
      "month to date",
      "month-to-date",
      "mtd",
      "this month",
      "so far this month",
      "the month so far",
    ],
  },
  {
    kind: "previous",
    phrases: [
      "last month",
      "previous month",
      "the month before",
      "prior month",
      "previous period",
      "last period",
      "prior period",
    ],
  },
  {
    kind: "latest",
    phrases: [
      "latest",
      "most recent",
      "current period",
      "newest",
      "the current report",
      "latest report",
    ],
  },
];

const MONTH_NAMES: readonly string[] = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Three-letter forms, excluding the ones that are also ordinary words. */
const MONTH_ABBREVIATIONS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  /*
   * `mar`, `may`, `jun` and `aug` are absent as abbreviations. "Mar" is a verb,
   * "May" is a modal that appears in almost every policy sentence, and a
   * three-letter match on either would put a month intent on "we may need to
   * coach her". The FULL names are matched for every month, so nothing is lost
   * except a shorthand nobody types for those four.
   */
  apr: 4,
  jul: 7,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternFor(phrases: readonly string[]): RegExp {
  return new RegExp(
    `\\b(?:${[...phrases]
      .sort((left, right) => right.length - left.length)
      .map(escape)
      .join("|")})\\b`,
    "i",
  );
}

const INTENT_PATTERNS = INTENT_PHRASES.map((entry) => ({
  kind: entry.kind,
  pattern: patternFor(entry.phrases),
}));

/**
 * A month name with an optional four-digit year: "July", "in August 2026".
 *
 * The year is only taken when it directly follows the month, so "August" in a
 * sentence that also mentions 2024 as a comparison basis does not silently
 * become August 2024.
 */
const NAMED_MONTH = new RegExp(
  `\\b(${[...MONTH_NAMES.filter((name) => name !== "may"), ...Object.keys(MONTH_ABBREVIATIONS)].join("|")})\\b(?:\\s+(\\d{4}))?`,
  "i",
);

/**
 * MAY, WHICH NEEDS COMPANY BEFORE IT COUNTS AS A MONTH.
 *
 * It is the one month name that is also a modal verb, and it turns up in
 * ordinary management sentences constantly — "we may need to coach her", "she
 * may have missed the tour", "policy may require". Matched bare, every one of
 * those became a request for May's figures.
 *
 * So it is only a month when a YEAR follows it or a PREPOSITION introduces it,
 * which is how anyone actually asks: "May 2026", "in May", "for May". Nothing
 * is lost — a manager asking about the month says one of those — and the modal
 * is left alone.
 *
 * The other three that were dropped as ABBREVIATIONS (`mar`, `jun`, `aug`)
 * keep their full names, because "march", "june" and "august" as ordinary words
 * are vanishingly rare in this product's traffic while "may" is not.
 */
const MAY_AS_MONTH = /\b(?:in|during|for|of|since|through|about)\s+(may)\b(?:\s+(\d{4}))?|\b(may)\s+(\d{4})\b/i;

/**
 * The period window this question asked for, or null.
 *
 * READS THE QUESTION ONLY. A follow-up that names no window inherits the
 * period through the report CONTEXT, not through remembered intent — the same
 * rule every other gate in this pipeline follows, and for the same reason:
 * carrying intent forward on history means it never leaves.
 *
 * ORDER OF PRECEDENCE. An explicit window beats a named month, because "August
 * year to date" is a year-to-date question that happens to name where it ends.
 * A named month beats nothing, and nothing means the caller falls back to the
 * latest period and says so.
 */
export function detectPeriodIntent(question: string): PeriodIntent | null {
  for (const { kind, pattern } of INTENT_PATTERNS) {
    const match = pattern.exec(question);
    if (match) return { kind, month: null, year: null, phrase: match[0] };
  }

  const may = MAY_AS_MONTH.exec(question);
  if (may) {
    const year = may[2] ?? may[4];
    return {
      kind: "named_month",
      month: 5,
      year: year ? Number(year) : null,
      phrase: may[0].trim(),
    };
  }

  const named = NAMED_MONTH.exec(question);
  if (named) {
    const word = named[1].toLowerCase();
    const fromName = MONTH_NAMES.indexOf(word);
    const month = MONTH_ABBREVIATIONS[word] ?? (fromName >= 0 ? fromName + 1 : null);
    if (month !== null) {
      return {
        kind: "named_month",
        month,
        year: named[2] ? Number(named[2]) : null,
        phrase: named[0],
      };
    }
  }

  return null;
}

/* -------------------------------------------------------------- resolution -- */

/**
 * A stored period, in the one shape this resolver reads.
 *
 * Each family's own listing is adapted to this rather than the resolver
 * learning five shapes: Sales Totals lists report DATES, the Comp Report lists
 * period rows, and the bed and spa reports list grain-keyed windows. One
 * normalisation, one resolution.
 */
export interface ResolvablePeriod {
  /** The family's own identifier for this period. Opaque here. */
  readonly id: string;
  /** Which window it is. `daily` for a one-day delivery. */
  readonly type: ReportPeriodTypeId;
  /** ISO `yyyy-mm-dd`. */
  readonly start: string;
  /** ISO `yyyy-mm-dd`. */
  readonly end: string;
  /** How the source labelled it, for a briefing to quote. */
  readonly label: string;
}

export type PeriodUnavailableReason =
  /** Nothing is ingested for this family at all. */
  | "no_periods"
  /** The family's source does not deliver that window. */
  | "type_not_delivered"
  /** It delivers that window, but not for the period asked for. */
  | "period_not_ingested"
  /** Only one period exists, so there is no earlier one. */
  | "no_previous_period";

export interface PeriodResolutionFailure {
  readonly reason: PeriodUnavailableReason;
  /** Manager-facing, and it names what IS available. */
  readonly detail: string;
}

/**
 * GENERIC OVER THE PERIOD TYPE, so a caller gets back exactly what it passed
 * in.
 *
 * The catalog's periods carry an ingestion timestamp and a salon count that
 * this resolver has no use for and must not strip: the loaders downstream read
 * them. A non-generic result would hand back a narrowed `ResolvablePeriod` and
 * every caller would have to widen it again by hand, which is a cast waiting to
 * be wrong.
 */
export type PeriodResolution<T extends ResolvablePeriod = ResolvablePeriod> =
  | {
      readonly ok: true;
      readonly period: T;
      /** The intent it satisfied. Null when the question named no window. */
      readonly intent: PeriodIntent | null;
      /**
       * True when the question named no window and the newest was read.
       *
       * Reported rather than silent, so the briefing can say which period it is
       * describing. This is the ONE case where a fallback is right.
       */
      readonly fellBackToLatest: boolean;
    }
  | { readonly ok: false; readonly failure: PeriodResolutionFailure; readonly intent: PeriodIntent };

/** The period type an intent is asking for, or null when it does not name one. */
function typeFor(intent: PeriodIntent): ReportPeriodTypeId | null {
  switch (intent.kind) {
    case "month_to_date":
      return "mtd";
    case "year_to_date":
      return "ytd";
    case "last_twelve_months":
      return "ltm";
    default:
      return null;
  }
}

/** Newest first, by end date then by the family's declared type preference. */
function ordered<T extends ResolvablePeriod>(
  periods: readonly T[],
  family: ReportFamily,
): T[] {
  const preference = family.periodTypes;
  return [...periods].sort(
    (left, right) =>
      right.end.localeCompare(left.end) ||
      preference.indexOf(left.type) - preference.indexOf(right.type),
  );
}

function describeAvailable(periods: readonly ResolvablePeriod[]): string {
  const labels = periods.slice(0, 6).map((period) => `${period.label} (${period.end})`);
  const more = periods.length > labels.length ? `, and ${periods.length - labels.length} more` : "";
  return labels.length > 0 ? `${labels.join("; ")}${more}` : "none";
}

/**
 * The stored period a question means, or the reason there is not one.
 *
 * `periods` is everything the family holds, in any order — this function sorts
 * it. Passing only the newest would make `previous` and `named_month`
 * unanswerable, which is the shape the loaders had before this existed.
 */
export function resolvePeriod<T extends ResolvablePeriod>(input: {
  readonly family: ReportFamily;
  readonly periods: readonly T[];
  readonly intent: PeriodIntent | null;
}): PeriodResolution<T> {
  const { family, intent } = input;
  const all = ordered(input.periods, family);

  if (all.length === 0) {
    return {
      ok: false,
      intent: intent ?? { kind: "latest", month: null, year: null, phrase: "latest" },
      failure: {
        reason: "no_periods",
        detail: `No ${family.label} delivery has been ingested, so there is no period to read.`,
      },
    };
  }

  /* ------------------------------------------- no window named: newest wins */
  if (!intent) {
    return { ok: true, period: all[0], intent: null, fellBackToLatest: true };
  }

  /* --------------------------------- a window type the source may not deliver */
  const wantedType = typeFor(intent);
  if (wantedType) {
    if (!family.periodTypes.includes(wantedType)) {
      return {
        ok: false,
        intent,
        failure: {
          reason: "type_not_delivered",
          detail: `The ${family.sourceReport} does not deliver ${REPORT_PERIOD_TYPE_LABEL[wantedType]}. It delivers ${family.periodTypes
            .map((type) => REPORT_PERIOD_TYPE_LABEL[type])
            .join(" and ")}.`,
        },
      };
    }
    const ofType = all.filter((period) => period.type === wantedType);
    if (ofType.length === 0) {
      return {
        ok: false,
        intent,
        failure: {
          reason: "period_not_ingested",
          detail: `No ${REPORT_PERIOD_TYPE_LABEL[wantedType]} period has been ingested for ${family.label}. Loaded periods: ${describeAvailable(all)}.`,
        },
      };
    }
    return { ok: true, period: ofType[0], intent, fellBackToLatest: false };
  }

  /* ------------------------------------------------------ latest, explicitly */
  if (intent.kind === "latest") {
    return { ok: true, period: all[0], intent, fellBackToLatest: false };
  }

  /* ---------------------------------------------------------------- previous */
  if (intent.kind === "previous") {
    /*
     * THE PERIOD BEFORE THE NEWEST OF THE SAME TYPE, not simply the second row.
     * Spa Wellness holds MTD, YTD and LTM all ending on the same day, so "the
     * second period" there is the same month read over a year — which is the
     * exact mistake `GRAIN_PRECEDENCE` in `bed-spa/read.ts` was written to stop
     * a tab making.
     *
     * For a DAILY family this is the newest delivery from an earlier month:
     * Sales Totals arrives every morning, so "last month" cannot mean "the
     * previous delivery", which would be yesterday.
     */
    const newest = all[0];
    const sameType = all.filter((period) => period.type === newest.type);

    const earlier =
      newest.type === "daily"
        ? sameType.find((period) => period.end.slice(0, 7) < newest.end.slice(0, 7))
        : sameType.find((period) => period.end < newest.end);

    if (!earlier) {
      return {
        ok: false,
        intent,
        failure: {
          reason: "no_previous_period",
          detail: `Only one ${family.label} period is loaded (${newest.label}), so there is no earlier one to compare with.`,
        },
      };
    }
    return { ok: true, period: earlier, intent, fellBackToLatest: false };
  }

  /* ------------------------------------------------------------- named month */
  const month = String(intent.month).padStart(2, "0");
  const candidates = all.filter((period) => {
    const [periodYear, periodMonth] = period.end.split("-");
    if (periodMonth !== month) return false;
    return intent.year === null || Number(periodYear) === intent.year;
  });

  if (candidates.length === 0) {
    return {
      ok: false,
      intent,
      failure: {
        reason: "period_not_ingested",
        detail: `No ${family.label} period ending in ${intent.phrase} has been ingested. Loaded periods: ${describeAvailable(all)}.`,
      },
    };
  }

  /*
   * The family's own type preference decides which window of that month, so a
   * named month resolves to month-to-date rather than to a twelve-month
   * accumulation that happens to end on the same day.
   */
  const preferred = family.periodTypes
    .map((type) => candidates.find((period) => period.type === type))
    .find((period): period is T => period !== undefined);

  return { ok: true, period: preferred ?? candidates[0], intent, fellBackToLatest: false };
}
