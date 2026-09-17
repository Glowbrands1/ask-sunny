import { CATEGORY_LABEL, type ActivityCategory } from "./taxonomy";
import type { AnalyticsTotals, TrendPoint } from "./queries";
import type { FeedbackSummary, TopicRow, WhenRow } from "./feedback-queries";
import { changeAgainst } from "./queries";

/**
 * "WHAT THE NUMBERS SAY" — five sentences, computed with arithmetic.
 *
 * ============================================================================
 * NO MODEL IS INVOLVED, AND THAT IS THE WHOLE POINT
 * ============================================================================
 *
 * Every line below is a subtraction, a division or a maximum over figures the
 * dashboard is already showing. Asking Claude to summarise a dashboard would be
 * cheaper to write and worse in the two ways that matter: the sentence could be
 * wrong about the numbers printed directly above it, and it would differ every
 * time the page loaded — so a manager quoting it in a meeting could not be
 * quoted back the same words.
 *
 * Deterministic, reproducible, and cheap enough to compute on every render.
 *
 * ============================================================================
 * AN INSIGHT WITH NO BASIS IS OMITTED, NOT SOFTENED
 * ============================================================================
 *
 * Each of these returns null when the figures cannot support it — no activity,
 * no prior period, nothing rated. The card does not render, rather than
 * rendering a hedge. "Usage may be growing" is not an insight and takes up the
 * same space as one.
 *
 * Client-safe: pure functions over shapes the server already computed.
 */

export interface Insight {
  key: string;
  /** The figure the card leads with. Short — it is set large. */
  value: string;
  question: string;
  detail: string;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface InsightInput {
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  trend: TrendPoint[];
  when: WhenRow[];
  topics: TopicRow[];
  previousTopics: TopicRow[];
  feedback: FeedbackSummary;
  periodLabel: string;
  previousLabel: string;
  /** The timezone the hours are stated in, so the card can say which. */
  timezoneLabel: string;
}

export function buildInsights(input: InsightInput): Insight[] {
  return [
    usageGrowth(input),
    whenUsed(input),
    whatIsNeeded(input),
    areAnswersLanding(input),
    howManyRely(input),
  ].filter((insight): insight is Insight => insight !== null);
}

/* ----------------------------------------------------- is usage growing? -- */

function usageGrowth(input: InsightInput): Insight | null {
  const { totals, previous, trend, periodLabel, previousLabel } = input;
  if (totals.events === 0) return null;

  const change = changeAgainst(totals.events, previous.events);
  const busiest = trend.reduce<TrendPoint | null>(
    (best, point) => (best === null || point.events > best.events ? point : best),
    null,
  );

  /*
   * `changeAgainst` RETURNS NULL WHEN THE BASELINE IS ZERO, and that rule is
   * respected rather than worked around. Going from 0 to 7 is not "+700%" — it
   * is the first week of use, and dividing by zero to say otherwise turns a real
   * beginning into a fake trend. The card says the prior period had none.
   */
  const headline =
    change === null
      ? "New"
      : `${change >= 0 ? "+" : ""}${Math.round(change)}%`;

  const comparison =
    change === null
      ? `${formatCount(totals.events, "inquiry", "inquiries")} in the ${lower(periodLabel)}. The ${lower(previousLabel)} had none, so there is no percentage to compare against yet.`
      : `${formatCount(totals.events, "inquiry", "inquiries")} in the ${lower(periodLabel)} against ${totals.events === previous.events ? "the same" : previous.events} in the ${lower(previousLabel)}.`;

  return {
    key: "growth",
    value: headline,
    question: "Is usage growing?",
    detail: busiest
      ? `${comparison} Busiest day was ${formatDay(busiest.date)} with ${busiest.events}.`
      : comparison,
  };
}

/* --------------------------------------------------- when do they use it? -- */

function whenUsed(input: InsightInput): Insight | null {
  const { when, timezoneLabel } = input;
  const total = when.reduce((sum, row) => sum + row.events, 0);
  if (total === 0) return null;

  const byDay = new Map<number, number>();
  const byHour = new Map<number, number>();
  for (const row of when) {
    byDay.set(row.dayOfWeek, (byDay.get(row.dayOfWeek) ?? 0) + row.events);
    byHour.set(row.hourOfDay, (byHour.get(row.hourOfDay) ?? 0) + row.events);
  }

  const topDay = largest(byDay);
  const topHour = largest(byHour);
  if (topDay === null || topHour === null) return null;

  return {
    key: "when",
    value: DAY_NAMES[topDay.key].slice(0, 3),
    question: "When do leaders use it most?",
    detail: `${DAY_NAMES[topDay.key]}s carry ${share(topDay.value, total)} of inquiries, and ${hourRange(topHour.key)} is the single busiest slot at ${share(topHour.value, total)}. Plan announcements and training nudges around that rhythm — hours are ${timezoneLabel}.`,
  };
}

/* --------------------------------------------------- what do they need? --- */

function whatIsNeeded(input: InsightInput): Insight | null {
  const { topics, previousTopics } = input;
  const total = topics.reduce((sum, row) => sum + row.events, 0);
  if (total === 0 || topics.length === 0) return null;

  /* Already ordered by the query, but ordering is not a property to assume. */
  const leader = topics.reduce((best, row) => (row.events > best.events ? row : best));

  /*
   * THE FASTEST RISER IS COMPUTED ONLY OVER TOPICS WITH A REAL BASELINE.
   *
   * A category that went from nothing to four is not the fastest-growing thing
   * leaders need; it is a category that did not exist last month. Including it
   * would put a rounding error at the top of the card every period — the same
   * reason `changeAgainst` refuses a zero baseline.
   */
  const previousByKey = new Map(previousTopics.map((row) => [row.category, row.events]));
  let riser: { category: ActivityCategory; change: number; events: number } | null = null;
  for (const row of topics) {
    const change = changeAgainst(row.events, previousByKey.get(row.category) ?? 0);
    if (change === null || change <= 0) continue;
    if (riser === null || change > riser.change) {
      riser = { category: row.category, change, events: row.events };
    }
  }

  const lead = `${CATEGORY_LABEL[leader.category]} leads with ${formatCount(leader.events, "inquiry", "inquiries")} (${share(leader.events, total)} of the total).`;

  return {
    key: "needs",
    value: share(leader.events, total),
    question: "What do leaders need most?",
    detail: riser
      ? `${lead} Fastest riser: ${CATEGORY_LABEL[riser.category]}, up ${Math.round(riser.change)}% to ${riser.events}.`
      : `${lead} No topic has a prior-period baseline to grow from yet.`,
  };
}

/* ------------------------------------------------- are the answers good? -- */

function areAnswersLanding(input: InsightInput): Insight | null {
  const { totals, feedback } = input;
  if (totals.events === 0) return null;

  const answered = totals.events - totals.failures;
  const rate = Math.round((answered / totals.events) * 100);

  const rated = feedback.responses;
  const positive = feedback.outcomes.yes;
  const closed = feedback.queue.resolved + feedback.queue.dismissed;

  /*
   * TWO DIFFERENT MEASURES, AND THE CARD SAYS SO RATHER THAN BLENDING THEM.
   *
   * The answer rate is "did the request succeed", which the server knows about
   * every turn. "Got what they needed" is "was the answer any use", which is
   * known only about the turns somebody rated. Presenting the second as though
   * it described the first — the reference dashboard's "9% got what they
   * needed" beside a 100% answer rate — invites the reading that 91% of
   * everything failed, when in truth 19 people out of 1,467 answered a question
   * about it. So the denominator is stated.
   *
   * AND THE DENOMINATOR IS NOW OPEN FEEDBACK, not all of it: resolved and
   * dismissed ratings leave these figures. The word "open" carries that, and it
   * matters here more than anywhere — this card is the one somebody quotes.
   */
  const rating =
    rated === 0
      ? closed > 0
        ? "Every rating in this period has been resolved or dismissed, so there is no open feedback to report on."
        : "Nothing has been rated yet, so how useful the answers were is not yet known."
      : `Of the ${formatCount(rated, "open rating", "open ratings")}, ${share(positive, rated)} said they got what they needed${feedback.averageRating !== null ? `, averaging ${feedback.averageRating.toFixed(1)} stars` : ""}.`;

  return {
    key: "landing",
    value: `${rate}%`,
    question: "Are the answers landing?",
    detail: `${answered} of ${totals.events} inquiries were answered without a technical error. ${rating}`,
  };
}

/* ------------------------------------------------- how many rely on it? --- */

function howManyRely(input: InsightInput): Insight | null {
  const { totals, previous } = input;
  if (totals.activeUsers === 0) return null;

  const average = totals.events / totals.activeUsers;
  const moreThanBefore = totals.activeUsers - previous.activeUsers;

  const movement =
    previous.activeUsers === 0
      ? "None were active in the prior period."
      : moreThanBefore === 0
        ? "The same number were active in the prior period."
        : `${Math.abs(moreThanBefore)} ${moreThanBefore > 0 ? "more" : "fewer"} than the prior period.`;

  return {
    key: "reliance",
    value: String(totals.activeUsers),
    question: "How many leaders rely on it?",
    detail: `${formatCount(totals.activeUsers, "leader", "leaders")} used Ask Sunny at least once, averaging ${average.toFixed(1)} inquiries each. ${movement} The By Location tab lists who has not started.`,
  };
}

/* ------------------------------------------------------------- helpers --- */

function largest(counts: Map<number, number>): { key: number; value: number } | null {
  let best: { key: number; value: number } | null = null;
  for (const [key, value] of counts) {
    /*
     * TIES BREAK TOWARD THE LOWER KEY, which for days and hours means the
     * earlier one. Arbitrary but STABLE — `Map` iteration order is insertion
     * order, so without this the "busiest day" could change between two renders
     * of identical data purely because the rows arrived differently.
     */
    if (best === null || value > best.value || (value === best.value && key < best.key)) {
      best = { key, value };
    }
  }
  return best;
}

function share(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** "10am–11am", which reads better on a card than "10:00". */
function hourRange(hour: number): string {
  return `${clockLabel(hour)}–${clockLabel((hour + 1) % 24)}`;
}

function clockLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/**
 * A trend bucket's date as a short label.
 *
 * PARSED AS UTC AND FORMATTED AS UTC. The buckets are whole days produced by
 * `date_trunc`, so they carry no meaningful time — rendering them in a local
 * zone west of UTC would show every one of them as the day before.
 */
function formatDay(iso: string): string {
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
