import { shiftDays, weekdayOf } from "@/lib/business-date";
import { followUpDatesByRules } from "@/lib/ai/edit-date-rules";
import { datesInText } from "@/lib/forms/form-date-answer";

/**
 * ============================================================================
 * A FOLLOW-UP THE FORM PROMISES IS A FOLLOW-UP ON THE CALENDAR
 * ============================================================================
 *
 * Pau (20 Nov 2026), after a live test where the AI wrote "A follow-up meeting
 * will be scheduled to review progress" into a Corrective Action's Action Plan
 * and `form_instances.follow_up_date` stayed null, so the follow-up never
 * reached the home page's outstanding follow-ups or Form Monitoring:
 *
 *   "(a) set the follow-up date automatically, one week after the form date,
 *    so you can change it … i choose A then be able to change it also"
 *
 * So a form Ask Sunny's agent loop creates — a Corrective Action, or any form
 * whose Action Plan promises a follow-up — gets a follow-up date when the
 * manager gave none: the form date plus seven days (today plus seven, when that has passed). A date the manager stated
 * ("follow up 12/1", "follow up next Friday") wins. Either way it is the same
 * `follow_up_date` the form's own date control sets, so the manager changes it
 * there, or in chat ("change the follow up to 12/3").
 *
 * Manual creation (the Forms page) sets no default: nothing there promises a
 * follow-up the manager did not choose.
 */

export const FOLLOW_UP_DEFAULT_DAYS = 7;

/**
 * One week after the form date; when that day has already passed (a backdated form), one week after today (Pau, via
 * QA, 20 Nov 2026: option b), so a new follow-up is never overdue the moment it is made. `today` is the salon's date.
 */
export function defaultFollowUpDate(formDate: string, today: string): string {
  const weekOut = shiftDays(formDate, FOLLOW_UP_DEFAULT_DAYS);
  return weekOut < today ? shiftDays(today, FOLLOW_UP_DEFAULT_DAYS) : weekOut;
}

/** An Action Plan that says a follow-up will happen ("A follow-up meeting will be scheduled…", "check in with her"). */
const PLAN_FOLLOW_UP = /\bfollow[- ]?up\b|\bfollow(?:ed|ing)?\s+up\b|\bcheck[- ]?in\b|\bcheck\s+back\b|\breview\s+(?:(?:her|his|their|the\s+employee's)\s+)?progress\b/i;

export function planPromisesFollowUp(plan: string | null | undefined): boolean {
  return PLAN_FOLLOW_UP.test(plan ?? "");
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const FOLLOW_UP_WORD = /\bfollow[- ]?up\b|\bfollowup\b|\bcheck[- ]?in\b/i;

/**
 * A weekday after a follow-up word: "follow up next Friday", "move the follow up to Tuesday". The first such
 * weekday AFTER today (a follow-up is ahead by design); "next Friday" said on a Friday is a week out. The reply says
 * the calendar date it set, so the manager sees which Friday it is and can change it.
 */
function weekdayAfterFollowUpWord(text: string, today: string): string | null {
  const cue = FOLLOW_UP_WORD.exec(text);
  if (!cue) return null;
  const rest = text.slice(cue.index);
  if (/\btomorrow\b/i.test(rest)) return shiftDays(today, 1);
  const match = /\b(?:(?:next|this|on|coming)\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b/i.exec(rest);
  if (!match) return null;
  const want = WEEKDAYS.findIndex((day) => day.startsWith(match[1]!.toLowerCase().slice(0, 3)));
  if (want < 0) return null;
  const ahead = ((want - weekdayOf(today) + 7) % 7) || 7;
  return shiftDays(today, ahead);
}

/**
 * The follow-up date the manager stated in these words, or null: a date a follow-up word points at ("follow up
 * 12/1", "follow-up on Dec 3"), or a weekday after one ("follow up next Friday"). Only one: two different dates is no
 * answer, and the default (or the date already set) stands.
 */
export function statedFollowUpDate(text: string, today: string): string | null {
  const dated = followUpDatesByRules(text ?? "", today);
  if (dated.length === 1) return dated[0]!;
  if (dated.length > 1) return null;
  return weekdayAfterFollowUpWord(text ?? "", today);
}

/** "change / move / set / push / reschedule … the follow up …", or "the follow-up date is …". */
const CHANGE_FOLLOW_UP =
  /\b(?:change|move|set|push|make|reschedule|update|put|switch|bump)\b[^.?!\n]{0,30}?\b(?:follow[- ]?up|followup|check[- ]?in)\b|\b(?:follow[- ]?up|followup)\s+(?:date\s+)?(?:is|should\s+be|to|=|:)\s/i;

/**
 * The follow-up date a message asks to set ("change the follow up to 12/3", "move the follow up to next Friday"),
 * or null when it does not ask for one. Follow-up dates are ahead by design and are never refused for being after
 * today (replay case nov15-agent-loop-g6-follow-up-date-after-today-written).
 */
export function followUpChangeAsked(text: string, today: string): string | null {
  const said = text ?? "";
  if (!CHANGE_FOLLOW_UP.test(said)) return null;
  const stated = statedFollowUpDate(said, today);
  if (stated) return stated;
  // "change the follow up to 12/3": the date after the follow-up word, when the rule's 40-character window missed it.
  const cue = FOLLOW_UP_WORD.exec(said);
  const after = cue ? datesInText(said.slice(cue.index), today).map((found) => found.iso) : [];
  return new Set(after).size === 1 ? after[0]! : null;
}

/** "Follow-up: Fri, Nov 27 (change it anytime)." — what the card and the reply say. */
export function followUpLine(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Follow-up: ${day} (change it anytime).`;
}

/**
 * The follow-up date a newly created form gets: the one the manager stated (always as stated), else the default. Null
 * when the form already has one (a reused draft, a date the manager set) — never overwritten.
 */
export function followUpDateForNewForm(input: {
  formDate: string;
  followUpDate: string | null;
  managerWords: string;
  today: string;
}): string | null {
  if (input.followUpDate) return null;
  return statedFollowUpDate(input.managerWords, input.today) ?? defaultFollowUpDate(input.formDate, input.today);
}

/**
 * The follow-up date Create will set on a card, and how the card's reply says it (f048b, QA's live 23a, 20 Nov 2026:
 * "ca for Test Testy, late on 11/19, we will meet again in a week to follow up" got "the follow-up meeting in a week
 * isn't part of this Corrective Action", while Create saved follow-up 11/26). Null when Create sets none: a form other
 * than a Corrective Action whose manager said nothing about a follow-up.
 */
export function followUpForCard(input: {
  corrective: boolean;
  formDate: string;
  managerWords: string;
  today: string;
}): { date: string; line: string } | null {
  if (!input.corrective && !planPromisesFollowUp(input.managerWords)) return null;
  const stated = statedFollowUpDate(input.managerWords, input.today);
  const date = stated ?? defaultFollowUpDate(input.formDate, input.today);
  const why = stated
    ? "as you said"
    : date === shiftDays(input.formDate, FOLLOW_UP_DEFAULT_DAYS)
      ? "a week after the form date"
      : "a week from today";
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return { date, line: `Follow-up: ${day} (${why}; change it on the form)` };
}
