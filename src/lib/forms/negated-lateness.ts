/**
 * ============================================================================
 * A LATENESS THAT DID NOT HAPPEN IS NO PUNCTUALITY TOPIC
 * (NEGATED_LATENESS_TOPIC_ENABLED)
 * ============================================================================
 *
 * QA tester 2, 26 Oct 2026 (invented name): "coaching form for rory vance, she
 * was not late today" came back with Topic of Coaching "Other" ticked and
 * "Other: Punctuality". The manager said the lateness did not happen. When the
 * notes speak of lateness only to deny it ("not late", "never late", "was on
 * time") and name no other attendance problem, a Punctuality topic is not
 * the manager's and is cleared. "not late but left early" still names one.
 * The Details stay as drafted: the account is the manager's own words. Pure.
 */

const LATE_WORD = /\b(?:late|lateness|tardy|tardiness)\b/gi;
const NEGATED_BEFORE =
  /\b(?:not|never|wasn't|wasnt|isn't|isnt|weren't|aren't|no\s+longer)\s+(?:(?:been|being|ever|even|really|once)\s+)*$/i;
const ON_TIME = /\b(?:was|were|is|are|came|arrived|clocked\s+in)\s+(?:in\s+)?on\s+time\b/i;
const OTHER_ATTENDANCE =
  /\b(?:left\s+early|leaving\s+early|clocked\s+out\s+early|absent|no[\s-]*call|no[\s-]*show|ncns|called\s+(?:out|off)|missed\s+(?:her|his|their|the)\s+shift|overslept)\b/i;
const PUNCTUALITY_TOPIC = /\b(?:punctual\w*|late\w*|tard\w*|attendance|on\s+time|timeliness)\b/i;

/** The notes mention lateness only to deny it, and name no other attendance problem. */
export function onlyNegatedLateness(notes: string): boolean {
  const text = notes ?? "";
  const lateness = [...text.matchAll(LATE_WORD)];
  if (lateness.some((match) => !NEGATED_BEFORE.test(text.slice(0, match.index ?? 0)))) return false;
  if (lateness.length === 0 && !ON_TIME.test(text)) return false;
  return !OTHER_ATTENDANCE.test(text);
}

/** The Coaching draft without a Punctuality "Other" topic the notes deny. Unchanged otherwise. */
export function withoutNegatedLatenessTopic(
  draft: { values: Record<string, string>; checked: Record<string, string[]> },
  notes: string,
): { values: Record<string, string>; checked: Record<string, string[]> } {
  const other = draft.values.other_topic ?? "";
  if (!onlyNegatedLateness(notes) || !PUNCTUALITY_TOPIC.test(other)) return draft;
  const values = { ...draft.values };
  delete values.other_topic;
  const topics = (draft.checked.coaching_topics ?? []).filter((key) => key !== "other");
  return { values, checked: { ...draft.checked, coaching_topics: topics } };
}
