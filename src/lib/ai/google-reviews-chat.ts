import { salonByNumber } from "@/data/salons";
import { formatReviewsInstant } from "@/lib/reviews/display-time";
import {
  formatGoalMonth,
  formatMonthToDate,
  GOAL_STATUS_LABEL,
  goalProgress,
  goalStatus,
  goalSummary,
  type ReviewGoalContext,
} from "@/lib/reviews/goal";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import type { LocationRollup } from "@/lib/reviews/types";

/**
 * Google review figures for a chat turn, from the Google Reviews page's own
 * snapshot. Behind GOOGLE_REVIEWS_IN_CHAT_ENABLED.
 *
 * QA T11 (25 Oct 2026): Sunny answered "I don't have review counts" while
 * /reviews showed the month to date against the goal. This module decides
 * whether a question is about Google reviews, which listings it names, and
 * writes the block. The read and the permission check are in
 * `google-reviews-chat-read.ts`.
 *
 * THE SAME SALONS THE PAGE SHOWS. /reviews lists every salon to anybody with
 * View Google reviews, so the block does too, never more. The caller's own
 * salons are marked so the answer can lead with them.
 *
 * Client-safe: no database client and no `server-only` import.
 */

const GOOGLE_REVIEW_PATTERNS: readonly RegExp[] = [
  /\bgoogle\b[\s\S]{0,40}\b(?:reviews?|ratings?|stars?)\b/i,
  /\b(?:reviews?|ratings?)\b[\s\S]{0,20}\bgoogle\b/i,
  /\b(?:how many|number of|count of)\b[\s\S]{0,40}\breviews\b/i,
  /\breviews?\b[\s\S]{0,60}\b(?:this month|month to date|mtd|this week|goal|target|on track|on pace|behind pace)\b/i,
  /\b(?:on track|on pace|behind pace|goal|target)\b[\s\S]{0,40}\breviews?\b/i,
  /\b(?:review (?:goal|count|target)s?|star ratings?)\b/i,
];

/** A review of a person or a document, not a Google review. */
const OTHER_REVIEW = /\b(?:policy|performance|annual|employee|coaching|90[- ]day|manager|peer)\s+reviews?\b/i;

export function isGoogleReviewQuestion(question: string): boolean {
  if (!GOOGLE_REVIEW_PATTERNS.some((pattern) => pattern.test(question))) return false;
  if (OTHER_REVIEW.test(question) && !/\bgoogle\b/i.test(question)) return false;
  return true;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Store codes of the listings a question names, by salon name ("KS Manhattan"
 * or "Manhattan") or salon number. Empty when it names none.
 */
export function storeCodesNamedIn(question: string): string[] {
  const named: string[] = [];
  for (const listing of GOOGLE_REVIEW_LOCATIONS) {
    const salon = salonByNumber(listing.salonNumber);
    if (!salon) continue;
    const place = salon.name.replace(/^(?:KS|NE|MO)\s+/, "");
    const byName = new RegExp(`\\b(?:${escapeRegExp(salon.state)}\\s+)?${escapeRegExp(place)}\\b`, "i");
    const byNumber = new RegExp(`\\b${escapeRegExp(listing.salonNumber)}\\b`);
    if (byName.test(question) || byNumber.test(question)) named.push(listing.storeCode);
  }
  return named;
}

function salonLabel(location: Pick<LocationRollup, "salonNumber" | "locationName">): string {
  const salon = location.salonNumber ? salonByNumber(location.salonNumber) : undefined;
  return salon?.name ?? location.locationName;
}

const HEADING = "GOOGLE REVIEWS — MONTH TO DATE";

/** How old the last sync may be before the answer has to say the figures may be out of date. */
export const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

const PAGE = "Google Reviews in the sidebar";

const RULES = [
  "- These are the figures the Google Reviews page shows. Answer from them: give the count, the goal and whether the salon is on track, and say which period and which salon each figure is for.",
  "- On track means Goal met or On pace above. Behind pace means not on track yet.",
  "- Never state a Google review figure that is not written here, never estimate one, and never send the manager to another tracker for a figure written here.",
  `- The manager can see the same figures on ${PAGE}.`,
].join("\n");

export function reviewsNotPermittedBlock(): string {
  return `${HEADING}\n\nThis account's role does not include View Google reviews. No review figures were read. Do not state any Google review count, rating, goal or salon figure. Say plainly that Google review figures are not available for their role.`;
}

export function reviewsUnavailableBlock(reason: string): string {
  return `${HEADING}\n\n${reason} No figure was estimated. Say so plainly, do not give a Google review count, and point the manager to ${PAGE}.`;
}

/** "Data as of" and, past two days, the instruction to say the figures may be out of date. */
export function freshnessLines(lastSyncAt: string | null, now: Date): string[] {
  const shown = formatReviewsInstant(lastSyncAt);
  if (!lastSyncAt || !shown) {
    return ["Data as of: no sync is recorded. Say the figures may not be current, and point the manager to " + PAGE + "."];
  }
  const lines = [`Data as of: the last Google review sync, ${shown} (Central time).`];
  if (now.getTime() - new Date(lastSyncAt).getTime() > STALE_AFTER_MS) {
    lines.push(
      `The last sync is more than 2 days old. Say so first: these figures are as of ${shown} and may be out of date, and the latest are on ${PAGE}.`,
    );
  }
  return lines;
}

/**
 * The block. `locations` are the page's rows, already narrowed to any salon
 * the question names; `ownStoreCodes` are the caller's salons, marked.
 */
export function formatGoogleReviewsBlock(input: {
  readonly goal: ReviewGoalContext;
  readonly locations: readonly LocationRollup[];
  readonly ownStoreCodes: ReadonlySet<string>;
  readonly lastSyncAt: string | null;
  readonly now: Date;
}): string {
  const { goal } = input;
  const period = `${formatGoalMonth(goal)} ${goal.monthStart.slice(0, 4)} month to date, ${formatMonthToDate(goal)} (Central time)`;
  const lines: string[] = [
    HEADING,
    "",
    `Period: ${period}.`,
    ...freshnessLines(input.lastSyncAt, input.now),
    `Goal: ${goal.target} qualifying Google reviews (3, 4 or 5 stars) per salon per month. On pace today means at least ${goal.paceTarget} so far.`,
  ];

  for (const location of input.locations) {
    const own = input.ownStoreCodes.has(location.storeCode) ? ", this manager's salon" : "";
    const name = `${salonLabel(location)} (store ${location.storeCode}${own})`;
    const status = goalStatus(location, goal);
    if (status === "not_counting") {
      lines.push(`- ${name}: not counting yet. No baseline is set, so the page shows no month-to-date figure for it.`);
      continue;
    }
    const progress = goalProgress(location.qualifyingMonthToDate, goal.target);
    const still = progress.remaining > 0 ? `${progress.remaining} still needed` : "goal reached";
    lines.push(
      `- ${name}: ${location.qualifyingMonthToDate} qualifying reviews month to date of the ${goal.target} goal, ${still}. Status: ${GOAL_STATUS_LABEL[status]}. ${location.qualifyingThisWeek} this reporting week.`,
    );
  }

  if (input.locations.length > 1) {
    const summary = goalSummary([...input.locations], goal);
    lines.push(
      `Total for the ${summary.counting} counting salons above: ${summary.qualifyingMonthToDate} qualifying reviews month to date against a combined goal of ${summary.combinedTarget}. ${summary.atGoal} at goal, ${summary.onPace} on pace, ${summary.behindPace} behind pace.`,
    );
  }

  return [...lines, "", RULES].join("\n");
}
