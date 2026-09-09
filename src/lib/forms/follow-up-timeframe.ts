import type { FormField } from "./document";

/**
 * ============================================================================
 * A TIMEFRAME THE MANAGER AGREED, NOT A DATE ASK SUNNY CHOSE
 * ============================================================================
 *
 * §9.2 of the Performance Management Framework defines a Follow-Up Coaching
 * field as "Next Follow-Up: [Timeframe]" — what the manager and the employee
 * agreed between them. The drafting prompt forbids scheduling talk, and under
 * that blanket rule this field came back empty on every draft: two different
 * things wear the same word.
 *
 *   THE INSTANCE'S `follow_up_date`   a calendar date. Managed by the manager
 *                                     through its own control, drives Form
 *                                     Monitoring, and belongs to no field.
 *
 *   A `follow_up_timeframe` FIELD     the agreed timeframe in the manager's own
 *                                     words: "in two weeks", "on her next
 *                                     closing shift", "before the end of the
 *                                     month".
 *
 * So the prompt now permits the second while still forbidding the first, and
 * this is the guard on what comes back.
 *
 * ============================================================================
 * WHAT THE GUARD ACTUALLY REFUSES
 * ============================================================================
 *
 * "If the manager supplied a timeframe, Ask Sunny may populate the field. If no
 * timeframe was supplied, do not invent one." The first half is a permission and
 * needs no enforcement. The second half is the risk, and a prompt instruction is
 * a request rather than a boundary — so a drafted timeframe survives only if the
 * manager's own notes contain something that could BE a timeframe.
 *
 * DELIBERATELY A COARSE TEST, in one direction. It asks whether the notes
 * mention time at all — a duration, a weekday, a month, a date, "next shift",
 * "end of the month". It does not try to check that the drafted wording matches
 * what they said, because paraphrase is exactly what drafting is for: "two
 * weeks" may reasonably become "in two weeks, at her next one-to-one".
 *
 * What it catches is the case that matters: notes with no time reference at all,
 * and a confident "in two weeks" appearing on the record anyway. That is an
 * invented commitment between a manager and an employee, and neither of them
 * made it.
 */

/**
 * Words and shapes that mean the manager said something about WHEN.
 *
 * Kept plain and readable rather than one large expression, because this list is
 * the whole content of the rule and somebody will need to extend it.
 */
const TIME_REFERENCE: readonly RegExp[] = [
  // Durations: "two weeks", "30 days", "a fortnight", "next week".
  /\b\d+\s*(?:day|days|week|weeks|month|months|shift|shifts)\b/i,
  /\b(?:a|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:day|days|week|weeks|month|months|shift|shifts)\b/i,
  /\b(?:next|this|following|coming)\s+(?:day|week|month|shift|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b/i,
  // Named days and months.
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // Explicit dates, in the shapes managers type.
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{1,2}(?:st|nd|rd|th)\b/i,
  /*
   * Relative phrasings, and a distinction that cost a test to find: a
   * follow-up POINTS FORWARD.
   *
   * "today" and "tonight" were on this list as bare words, and the notes a
   * manager actually writes end "...on the floor today" — describing WHEN THE
   * INCIDENT HAPPENED. That let an invented "in two weeks" through on the
   * strength of a word about the past. So the bare forms are gone and the
   * forward-looking uses are spelled out.
   */
  /\btomorrow\b/i,
  /\b(?:later|by|before|end of)\s+(?:today|tonight)\b/i,
  /\b(?:end|start|beginning)\s+of\s+(?:the\s+)?(?:day|week|month|shift|quarter)\b/i,
  /\bby\s+(?:the\s+)?(?:end|close)\b/i,
  /\b(?:in|within|after|before)\s+(?:a|an|one|two|three|\d+)\b/i,
  /\b(?:her|his|their)\s+next\b/i,
  /\bnext\s+(?:one[- ]to[- ]one|1:1|check[- ]in|review|visit)\b/i,
  /\b(?:fortnight|biweekly|bi-weekly|weekly|monthly)\b/i,
];

/** Whether the manager's notes refer to a time at all. */
export function notesCarryATimeframe(notes: string): boolean {
  const text = notes ?? "";
  return TIME_REFERENCE.some((pattern) => pattern.test(text));
}

export interface TimeframeGuardResult {
  readonly values: Record<string, string>;
  /** Field keys emptied because the manager gave no timeframe to work from. */
  readonly emptied: string[];
}

/**
 * Empties a drafted timeframe the manager's notes cannot support.
 *
 * Runs on the model's output, before validation and before anything is stored,
 * so an invented commitment has no path to `form_instance_values`.
 *
 * A field with no `semantics` marker is untouched, so this cannot affect the
 * other thirteen templates — none of which declares one.
 */
export function guardFollowUpTimeframe(
  values: Record<string, string>,
  fields: readonly FormField[],
  notes: string,
): TimeframeGuardResult {
  const timeframeKeys = new Set(
    fields
      .filter((field) => field.semantics === "follow_up_timeframe")
      .map((field) => field.key),
  );

  if (timeframeKeys.size === 0) return { values, emptied: [] };
  if (notesCarryATimeframe(notes)) return { values, emptied: [] };

  const kept: Record<string, string> = {};
  const emptied: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (timeframeKeys.has(key) && value.trim() !== "") {
      emptied.push(key);
      continue;
    }
    kept[key] = value;
  }

  return { values: kept, emptied };
}

/**
 * The rule the prompt carries for a form that HAS a timeframe field.
 *
 * Replaces the blanket prohibition for those forms only. It still forbids the
 * calendar date and the placeholder — the two things the blanket rule existed to
 * stop — while permitting the field the framework defines.
 */
export const FOLLOW_UP_TIMEFRAME_RULES: readonly string[] = [
  "ONE FIELD ON THIS FORM ASKS FOR A FOLLOW-UP TIMEFRAME, and it is the one exception to the rule about scheduling. Write the timeframe the manager and employee agreed, in the manager's own terms — \"in two weeks\", \"at her next closing shift\", \"before the end of the month\".",
  "If the manager did not say when the follow-up would happen, LEAVE THAT FIELD EMPTY. Do not choose a timeframe for them: it is a commitment between a manager and an employee, and inventing one puts an agreement on the record that neither of them made.",
  "Even there, do not write a calendar date unless the manager gave one, and never write a placeholder. The form's own follow-up date is recorded separately by the manager and is not this field.",
  "In every OTHER field, still say nothing about follow-up dates or scheduling.",
];
