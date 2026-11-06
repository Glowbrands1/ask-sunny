/**
 * ============================================================================
 * A LATENESS THAT DID NOT HAPPEN IS NO PUNCTUALITY TOPIC
 * (NEGATED_LATENESS_TOPIC_ENABLED, default off)
 * ============================================================================
 *
 * QA tester 2, 26 Oct 2026 (invented name): "coaching form for rory vance, she
 * was not late today" came back with Topic of Coaching "Other" ticked and
 * "Other: Punctuality". The manager said the lateness did not happen. When the
 * notes speak of lateness only to deny it ("not late", "wasn't late", "never
 * late", "was on time") and name no other attendance problem, a Punctuality
 * topic is not the manager's and is cleared. "not late but left early" still
 * names one, and "not late today but was late yesterday" names a real one.
 * The Details stay as drafted: the account is the manager's own words.
 *
 * The Corrective Action reader (`ca-policy.ts`) uses `withoutNegatedLateness`
 * so that "she was not late" is not read as an attendance account. Pure.
 */

const LATE_WORD = /\b(?:late|lateness|tardy|tardiness)\b/gi;
const NEGATED_BEFORE =
  /\b(?:not|never|(?:was|is|were|are|has|have|had|did|does|do)n['’]?t|no\s+longer)\s+(?:(?:been|being|ever|even|really|once)\s+)*$/i;
const ON_TIME = /\b(?:was|were|is|are|came|arrived|clocked\s+in)\s+(?:in\s+)?on\s+time\b/i;
const OTHER_ATTENDANCE =
  /\b(?:left\s+early|leaving\s+early|clocked\s+out\s+early|absent|absences?|no[\s-]*call|no[\s-]*show|ncns|called\s+(?:out|off)|call[\s-]?offs?|missed\s+(?:her|his|their|a|the)\s+shift|overslept)\b/i;
const PUNCTUALITY_TOPIC = /\b(?:punctual\w*|late\w*|tard\w*|attendance|on\s+time|timeliness)\b/i;

/** Each lateness word in the text, with whether the words just before it deny it. */
function latenessMentions(text: string): { index: number; length: number; negated: boolean }[] {
  return [...text.matchAll(LATE_WORD)].map((match) => {
    const index = match.index ?? 0;
    return { index, length: match[0].length, negated: NEGATED_BEFORE.test(text.slice(0, index)) };
  });
}

/** The notes mention lateness only to deny it, and name no other attendance problem. */
export function onlyNegatedLateness(notes: string): boolean {
  const text = notes ?? "";
  const lateness = latenessMentions(text);
  if (lateness.some((mention) => !mention.negated)) return false;
  if (lateness.length === 0 && !ON_TIME.test(text)) return false;
  return !OTHER_ATTENDANCE.test(text);
}

/**
 * The text with every denied lateness word blanked ("she was not late" → "she
 * was not ____"), so a reader looking for an attendance account does not find
 * one there. A lateness that is not denied, and every other word, stay.
 */
export function withoutNegatedLateness(text: string): string {
  let out = text ?? "";
  for (const mention of latenessMentions(out).reverse()) {
    if (!mention.negated) continue;
    out = out.slice(0, mention.index) + "_".repeat(mention.length) + out.slice(mention.index + mention.length);
  }
  return out;
}

/** The Coaching draft without a Punctuality "Other" topic the notes deny. Unchanged otherwise. */
export function withoutNegatedLatenessTopic<T extends { values: Record<string, string>; checked: Record<string, string[]> }>(
  draft: T,
  notes: string,
): T {
  const other = draft.values.other_topic ?? "";
  if (!onlyNegatedLateness(notes) || !PUNCTUALITY_TOPIC.test(other)) return draft;
  const values = { ...draft.values };
  delete values.other_topic;
  const checked = { ...draft.checked };
  const topics = (draft.checked.coaching_topics ?? []).filter((key) => key !== "other");
  if (topics.length > 0) checked.coaching_topics = topics;
  else delete checked.coaching_topics;
  return { ...draft, values, checked };
}
