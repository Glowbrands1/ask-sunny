import { businessToday } from "@/lib/business-date";
import { formatWeekRange, weekStartOf } from "./reporting-week";

/**
 * ============================================================================
 * HOW MANY GOOGLE REVIEWS ARE WE RECEIVING OVER TIME?
 * ============================================================================
 *
 * A different question from the one the reporting periods answer, and the page
 * asks both. Keeping them apart is the whole reason this module exists:
 *
 *   THE OFFICIAL WEEKLY COUNT is a reporting figure. A review counts toward a
 *   week only where it was proven to sit above its salon's baseline, so a
 *   fifteen-salon estate with no baselines set counts zero — correctly — and
 *   the twelve-week trend built on `google_review_location_periods` is an empty
 *   chart until somebody sets them.
 *
 *   THIS IS A VOLUME FIGURE. It counts the review RECORDS themselves, by the
 *   date the review carries, and it is true the moment a review is stored. It
 *   depends on no baseline, raises no weekly total, and must never be quoted as
 *   one — which is why every caption that renders these points says so.
 *
 * ============================================================================
 * WHICH DATE A REVIEW IS PLACED BY, AND IN WHICH ORDER
 * ============================================================================
 *
 * The same precedence the response queue already uses to say how long a review
 * has been waiting, and the same one `google_review_location_backlog` uses to
 * order held reviews — so the chart, the queue and the backlog view cannot
 * disagree about when a review happened:
 *
 *   1. `google_absolute_date`  — Google's own publication instant. The Apify
 *                                transport returns one; it is the real answer.
 *   2. `google_estimated_at`   — derived from Google's relative wording ("2
 *                                months ago") at the moment it was read. Coarse,
 *                                and labelled as an estimate everywhere it is
 *                                used. Too coarse to decide a reporting period;
 *                                good enough to place a bar on a month.
 *   3. `first_seen_at`         — when ASK Sunny first saw the review. Never a
 *                                review date, and it is only reached when Google
 *                                gave neither of the two above.
 *
 * NO DATE IS EVER INVENTED. `first_seen_at` is not null on any stored review,
 * so every record lands in exactly one bucket, and the caller is told how many
 * of them fell all the way through to first-seen so the caption can say so.
 *
 * ============================================================================
 * THE BUCKETS ARE THE APPLICATION'S OWN, NOT THE CHART LIBRARY'S
 * ============================================================================
 *
 * A week is the Sunday-to-Saturday reporting week `reporting-week.ts` defines,
 * judged in the business timezone — the same convention the reporting periods
 * use. The two describe different things, but they must not disagree about
 * where a week begins, or a Saturday-evening review would sit in a different
 * column here than in the weekly total beside it.
 *
 * EMPTY BUCKETS BETWEEN TWO POPULATED ONES ARE DRAWN AS ZEROS rather than
 * skipped, for the reason the twelve-week trend already records: a chart that
 * omits quiet weeks compresses its own axis and makes a silent fortnight look
 * like steady volume.
 *
 * Client-safe. No database client, no secret, no `server-only` import.
 */

export const TIMELINE_GRANULARITIES = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
] as const;

export type TimelineGranularity = (typeof TIMELINE_GRANULARITIES)[number]["key"];

export const DEFAULT_TIMELINE_GRANULARITY: TimelineGranularity = "weekly";

/**
 * HOW MANY COLUMNS EACH VIEW WILL DRAW BEFORE IT STARTS DROPPING THE OLDEST.
 *
 * A bound rather than a preference: an estate holding three years of imported
 * backlog would otherwise ask a phone to render 150 weekly columns, which is
 * not a chart. When the span is longer than this the MOST RECENT buckets are
 * kept — "what are we receiving lately" is the question — and the caller is
 * told it was trimmed so the caption can name the window rather than let a
 * reader assume they are seeing everything.
 */
export const MAX_WEEKLY_BUCKETS = 52;
export const MAX_MONTHLY_BUCKETS = 36;

/** The three date fields a review can be placed by, in precedence order. */
export interface TimelineRecord {
  googleAbsoluteDate: string | null;
  googleEstimatedAt: string | null;
  firstSeenAt: string;
}

/** Which of the three answered for a given review. Reported, never guessed. */
export type ReviewDateSource = "google_absolute" | "google_estimated" | "first_seen";

export interface TimelinePoint {
  /** The Sunday of the week, or `yyyy-mm` for a month. Stable, sortable. */
  key: string;
  /** The short form for the x axis: "Sep 13", "Sep 2026". */
  label: string;
  /** The full form for the tooltip: "Sep 13 – Sep 19", "September 2026". */
  range: string;
  /** Review records whose date falls in this bucket. */
  reviews: number;
}

export interface ReviewTimeline {
  weekly: TimelinePoint[];
  monthly: TimelinePoint[];
  /** Records placed on the chart. The two series hold the same reviews. */
  counted: number;
  /** How many landed by each date field, so the caption can be honest. */
  bySource: Record<ReviewDateSource, number>;
  /** True when the span was longer than the bucket ceiling above. */
  weeklyTrimmed: boolean;
  monthlyTrimmed: boolean;
}

/**
 * The business-zone calendar date a review should be placed on, and which field
 * supplied it. Null only where every field is unreadable, which stored data
 * cannot produce — a record with an unparseable `first_seen_at` is dropped from
 * the chart rather than dated by guesswork.
 */
export function reviewDateOf(
  record: TimelineRecord,
): { date: string; source: ReviewDateSource } | null {
  const candidates: { value: string | null; source: ReviewDateSource }[] = [
    { value: record.googleAbsoluteDate, source: "google_absolute" },
    { value: record.googleEstimatedAt, source: "google_estimated" },
    { value: record.firstSeenAt, source: "first_seen" },
  ];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const parsed = Date.parse(candidate.value);
    if (Number.isNaN(parsed)) continue;
    /*
     * THE INSTANT IS CONVERTED TO A BUSINESS-ZONE CALENDAR DATE FIRST, by the
     * one function in the application that knows what day it is for the
     * business. Bucketing the raw UTC instant would file a Saturday-evening
     * review into the following week — which is precisely the skew
     * `reporting-week.ts` exists to prevent on the other side of the page.
     */
    return { date: businessToday(new Date(parsed)), source: candidate.source };
  }

  return null;
}

/** `yyyy-mm` of an ISO calendar date. */
function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** The month after a `yyyy-mm` key. */
function nextMonth(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** "September 2026" and "Sep 2026", from a `yyyy-mm` key. */
function monthLabels(monthKey: string): { label: string; range: string } {
  const at = new Date(`${monthKey}-01T00:00:00Z`);
  /* UTC on purpose: the key is already a business-zone calendar label by now. */
  const short = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
  const long = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
  return { label: short, range: long };
}

/** "Sep 13", from a week-start date. */
function weekLabel(weekStart: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${weekStart}T00:00:00Z`));
}

/** The Sunday one week after another Sunday. */
function nextWeek(weekStart: string): string {
  const at = new Date(`${weekStart}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 7);
  return at.toISOString().slice(0, 10);
}

function seriesFrom(
  counts: Map<string, number>,
  step: (key: string) => string,
  labels: (key: string) => { label: string; range: string },
  ceiling: number,
): { points: TimelinePoint[]; trimmed: boolean } {
  const keys = [...counts.keys()].sort();
  if (keys.length === 0) return { points: [], trimmed: false };

  /* Contiguous from the first populated bucket to the last: no silent gaps. */
  const filled: TimelinePoint[] = [];
  let cursor = keys[0];
  const last = keys[keys.length - 1];
  /*
   * A HARD STOP ON THE WALK, not only on the result. A malformed key would
   * otherwise step past `last` for ever; the ceiling is doubled so a legitimate
   * long span still produces enough buckets to trim from.
   */
  const limit = ceiling * 4;
  while (cursor <= last && filled.length < limit) {
    filled.push({
      key: cursor,
      ...labels(cursor),
      reviews: counts.get(cursor) ?? 0,
    });
    cursor = step(cursor);
  }

  const trimmed = filled.length > ceiling;
  return { points: trimmed ? filled.slice(-ceiling) : filled, trimmed };
}

/**
 * The two series, from the review records themselves.
 *
 * BOTH ARE BUILT FROM ONE PASS over the same records, so the monthly view and
 * the weekly view cannot be counting different sets of reviews — the failure a
 * second, similar-looking query produces every time.
 */
export function buildReviewTimeline(records: TimelineRecord[]): ReviewTimeline {
  const weeks = new Map<string, number>();
  const months = new Map<string, number>();
  const bySource: Record<ReviewDateSource, number> = {
    google_absolute: 0,
    google_estimated: 0,
    first_seen: 0,
  };
  let counted = 0;

  for (const record of records) {
    const dated = reviewDateOf(record);
    if (!dated) continue;

    counted += 1;
    bySource[dated.source] += 1;

    const week = weekStartOf(dated.date);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);

    const month = monthKeyOf(dated.date);
    months.set(month, (months.get(month) ?? 0) + 1);
  }

  const weekly = seriesFrom(
    weeks,
    nextWeek,
    (key) => ({ label: weekLabel(key), range: formatWeekRange(key) }),
    MAX_WEEKLY_BUCKETS,
  );
  const monthly = seriesFrom(months, nextMonth, monthLabels, MAX_MONTHLY_BUCKETS);

  return {
    weekly: weekly.points,
    monthly: monthly.points,
    counted,
    bySource,
    weeklyTrimmed: weekly.trimmed,
    monthlyTrimmed: monthly.trimmed,
  };
}

/** The empty timeline, for a deployment holding nothing yet. */
export const EMPTY_REVIEW_TIMELINE: ReviewTimeline = {
  weekly: [],
  monthly: [],
  counted: 0,
  bySource: { google_absolute: 0, google_estimated: 0, first_seen: 0 },
  weeklyTrimmed: false,
  monthlyTrimmed: false,
};
