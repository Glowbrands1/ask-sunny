import { businessToday, businessWeekEnd, daysBetween } from "./business-date";

/**
 * DERIVED, NOT STORED.
 *
 * A follow-up's state is a function of three persisted fields and today's
 * business date. Nothing writes "overdue" anywhere: a form due yesterday is
 * overdue because yesterday is before today, and it became overdue at midnight
 * without anything running. That is the whole reason for deriving it — a stored
 * state would need a nightly job to flip it, and would be wrong for however
 * many hours the job was late.
 *
 * WHY THESE STATES ARE MUTUALLY EXCLUSIVE. The brief listed the rules
 * separately, and read literally they overlap: a draft with a follow-up date in
 * the past satisfies both DRAFTED and OVERDUE. Overlapping pills whose counts
 * do not add up to the total are the sort of thing a manager stops trusting, so
 * this resolves the overlap as a priority chain, ordered by what somebody needs
 * to know first:
 *
 *   archived      — off the active list; it is nobody's outstanding work
 *   followed_up   — the conversation happened; the date it was due no longer
 *                   decides anything
 *   overdue       — tracked, not done, and the date has passed
 *   open          — tracked, not done, still to come
 *   drafted       — a draft nobody has started tracking
 *   untracked     — anything else with no follow-up date
 *
 * A TRACKED DRAFT IS NOT "DRAFTED". It resolves to open or overdue, because
 * somebody deliberately scheduled it and hiding it under a lifecycle label
 * would drop it out of the counts that exist to chase it. `drafted` therefore
 * means "a draft, and nothing has been scheduled" — which is what makes the
 * five counts disjoint and their sum the total.
 */
export type FollowUpState =
  | "drafted"
  | "untracked"
  | "open"
  | "overdue"
  | "followed_up"
  | "archived";

/** The little a derivation needs to know about a form. */
export interface FollowUpFacts {
  status: "draft" | "finalized" | "revised";
  followUpDate: string | null;
  followedUpAt: string | null;
  archivedAt: string | null;
}

export function followUpState(
  form: FollowUpFacts,
  today: string = businessToday(),
): FollowUpState {
  if (form.archivedAt) return "archived";
  if (form.followedUpAt) return "followed_up";
  if (!form.followUpDate) return form.status === "draft" ? "drafted" : "untracked";
  return daysBetween(today, form.followUpDate) < 0 ? "overdue" : "open";
}

/** True while a form is somebody's outstanding work. */
export function needsFollowUp(form: FollowUpFacts, today?: string): boolean {
  const state = followUpState(form, today);
  return state === "overdue" || state === "open";
}

/* ------------------------------------------------------------- the filter --- */

/**
 * The shelves Form Monitoring offers, and the one the Overview links into.
 *
 * `all` is a value rather than the absence of one so the pill row has something
 * to mark as selected, and so a URL can say "all" explicitly.
 */
export const FOLLOW_UP_FILTERS = [
  "all",
  "drafted",
  "open",
  "overdue",
  "followed_up",
] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

/** Narrows an untrusted `?followup=` to a filter, defaulting to everything. */
export function parseFollowUpFilter(raw: string | null | undefined): FollowUpFilter {
  return FOLLOW_UP_FILTERS.includes(raw as FollowUpFilter) ? (raw as FollowUpFilter) : "all";
}

export function matchesFollowUpFilter(
  form: FollowUpFacts,
  filter: FollowUpFilter,
  today?: string,
): boolean {
  return filter === "all" || followUpState(form, today) === filter;
}

/* ------------------------------------------------------------- the counts --- */

export interface FollowUpCounts {
  all: number;
  drafted: number;
  open: number;
  overdue: number;
  followed_up: number;
}

/**
 * Counted from the rows themselves, every time, so a count cannot disagree with
 * the list beneath it. `all` is the row total, and because the states are
 * disjoint the other four plus the untracked and archived rows account for it
 * exactly.
 */
export function followUpCounts(
  forms: FollowUpFacts[],
  today: string = businessToday(),
): FollowUpCounts {
  const counts: FollowUpCounts = { all: forms.length, drafted: 0, open: 0, overdue: 0, followed_up: 0 };
  for (const form of forms) {
    const state = followUpState(form, today);
    if (state === "drafted") counts.drafted += 1;
    else if (state === "open") counts.open += 1;
    else if (state === "overdue") counts.overdue += 1;
    else if (state === "followed_up") counts.followed_up += 1;
  }
  return counts;
}

/* ---------------------------------------------------------- what's urgent --- */

export interface AttentionSummary {
  overdue: number;
  dueThisWeek: number;
  /** The two above. Never includes anything that is already done. */
  needsAttention: number;
}

/**
 * What the Overview card and the monitoring banner both say.
 *
 * "Due this week" is today through the end of the business week (see
 * `businessWeekEnd`), NOT a rolling seven days: a manager reading it on
 * Thursday is asking what is left before the weekend, not what lands next
 * Tuesday.
 *
 * Excluded by construction, because `followUpState` gets there first:
 * followed-up records, archived records, and forms with no follow-up date —
 * including drafts nobody has started tracking.
 */
export function attentionSummary(
  forms: FollowUpFacts[],
  today: string = businessToday(),
): AttentionSummary {
  const weekEnd = businessWeekEnd(today);
  let overdue = 0;
  let dueThisWeek = 0;

  for (const form of forms) {
    const state = followUpState(form, today);
    if (state === "overdue") overdue += 1;
    else if (state === "open" && form.followUpDate && form.followUpDate <= weekEnd) {
      dueThisWeek += 1;
    }
  }

  return { overdue, dueThisWeek, needsAttention: overdue + dueThisWeek };
}

/* --------------------------------------------------------------- wording --- */

/**
 * "3 days late", "Yesterday", "Today", "Tomorrow", "in 4 days".
 *
 * Deliberately NOT `relativeDay` from `@/lib/utils/date`: that one measures
 * against the demo anchor, so it would describe a real follow-up date relative
 * to a fixed instant in August. Lateness also gets its own phrasing — "3 days
 * late" is what somebody chasing it says, where "3 days ago" sounds like a
 * thing that is finished.
 */
export function relativeBusinessDay(date: string, today: string = businessToday()): string {
  const days = daysBetween(today, date);
  if (Number.isNaN(days)) return date;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days late`;
}

/** The single sentence at the top of Form Monitoring, or nothing to say. */
export function attentionSentence(summary: AttentionSummary): string | null {
  if (summary.needsAttention === 0) return null;
  const lead = `${summary.needsAttention} follow-up${summary.needsAttention === 1 ? "" : "s"} need${summary.needsAttention === 1 ? "s" : ""} attention`;
  const parts: string[] = [];
  if (summary.overdue > 0) parts.push(`${summary.overdue} overdue`);
  if (summary.dueThisWeek > 0) parts.push(`${summary.dueThisWeek} due this week`);
  return `${lead} — ${parts.join(" · ")}`;
}

/** How each state is labelled and coloured, in one place. */
export const FOLLOW_UP_LABEL: Record<FollowUpState, string> = {
  drafted: "Drafted",
  untracked: "Not tracked",
  open: "Open",
  overdue: "Overdue",
  followed_up: "Followed up",
  archived: "Archived",
};
