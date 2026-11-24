import { otherWriteInGuardEnabled, otherWriteInNotAQuestionEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "OTHER" IS NEVER TICKED WITH NOTHING WRITTEN BESIDE IT
 * ============================================================================
 *
 * OTHER_WRITE_IN_GUARD_ENABLED (QA, 29 Oct 2026; same flag in both apps). A
 * tester's lateness coaching draft came back with Topic of Coaching "Other"
 * ticked and the Other write-in empty — a ticked box with no label beside it,
 * which the field's own rule forbids ("Only when the Other box is ticked").
 * The prompt asks for the pair; this holds it on the output.
 *
 * When "Other" is ticked and its write-in is empty, the write-in is filled
 * with what happened in the manager's own words (the first clause of their
 * notes that is not the request for the form, e.g. "She was late three times
 * last week"). With no such clause, "Other" is unticked. A write-in the model
 * filled is left as it is. Off: the draft as the model returned it.
 */

/** Checkbox group → the write-in field printed beside its "Other" box. */
const WRITE_INS: Readonly<Record<string, string>> = {
  coaching_topics: "other_topic",
};

const OTHER = "other";
const LONGEST = 120;

/** A clause that only asks for the form, or only names who and where. */
const REQUEST =
  /\b(?:create|make|start|draft|fill(?:\s+out)?|do|need|want|please|write\s+up)\b[^.,;\n]*\b(?:form|coaching|ca|c\/a|corrective\s+action|write-?up)\b|\b(?:coaching|corrective\s+action)\s+form\b|^(?:for|at)\b/i;
/**
 * A question the manager asked (OTHER_WRITE_IN_NOT_A_QUESTION_ENABLED): "Which
 * forms can I create here?", a turn before the request, is not what happened.
 */
const QUESTION = /^(?:which|what|how)\b.*\b(?:can|could|do|should)\s+(?:i|we)\b/i;
const FIELD_LINE = /^(?:employee|job title|location|date|type of warning|payroll deduct\w*|prior actions)\s*:/i;

/**
 * HOTFIX (QA, 17 Nov 2026; the tester's coaching form): "Coaching for test testy on greeting guests at the door" put the
 * whole request in Other's topic. A clause that names the form's own person (the record's employee name, any case) has
 * its topic after the name: "on greeting guests at the door" → "Greeting guests at the door".
 */
function topicAfterName(clause: string, employeeName: string | null | undefined): string | null {
  const name = (employeeName ?? "").trim().toLowerCase();
  if (!name) return null;
  const at = clause.toLowerCase().indexOf(name);
  if (at < 0) return null;
  // Only a topic the request leads into ("<name> on …", "about …"); "<name> at Kearney" is a place, read as before.
  const lead = /^[\s,:-]*(?:on|about|regarding|re|for|with)\s+/i.exec(clause.slice(at + name.length));
  if (!lead) return null;
  const after = clause.slice(at + name.length + lead[0].length).trim();
  if (after.split(/\s+/).length < 2) return null;
  return after.charAt(0).toUpperCase() + after.slice(1);
}

/** What happened, in the manager's own words, short enough for a write-in; or null. */
/**
 * `requestTopicOnly` (a loop card's write-in, port from the sibling app's A1, 23 Nov 2026): only the topic the manager
 * named after the person's name; never a clause of the account.
 */
export function managerIssueWords(notes: string, employeeName?: string | null, requestTopicOnly = false): string | null {
  const lines = (notes ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  /*
   * The topic the manager led into after the person's name ("Coaching for <name> on greeting guests at the door"), in any
   * line, comes first: a loop card's account line ("What happened: <name> is not greeting guests …", which Create now
   * drafts from) is the write-up, never the topic (QA, 18 Nov 2026).
   */
  for (const line of lines) {
    if (FIELD_LINE.test(line) || /^what happened\s*:/i.test(line)) continue;
    for (const part of line.split(/(?<=[.!?])\s+|[,;]\s+/)) {
      const named = topicAfterName(part.trim().replace(/[.!?\s]+$/, ""), employeeName);
      if (named) return named.length > LONGEST ? null : named;
    }
  }
  if (requestTopicOnly) return null;
  const stated = lines.find((line) => /^what happened\s*:/i.test(line));
  const source = stated ? [stated.replace(/^what happened\s*:\s*/i, "")] : lines.filter((line) => !FIELD_LINE.test(line));
  const skipQuestions = otherWriteInNotAQuestionEnabled();
  for (const line of source) {
    for (const part of line.split(/(?<=[.!?])\s+|[,;]\s+/)) {
      const clause = part.trim().replace(/[.!?\s]+$/, "");
      const named = topicAfterName(clause, employeeName);
      if (named) return named.length > LONGEST ? null : named;
      if (clause.split(/\s+/).length < 3 || REQUEST.test(clause)) continue;
      if (skipQuestions && (/\?\s*$/.test(part) || QUESTION.test(clause))) continue;
      if (clause.length > LONGEST) return null;
      return clause.charAt(0).toUpperCase() + clause.slice(1);
    }
  }
  return null;
}

export function guardOtherWriteIn<T extends { values: Record<string, string>; checked: Record<string, string[]> }>(
  draft: T,
  notes: string,
  fieldKeys: ReadonlySet<string>,
  employeeName?: string | null,
  /** The topic the coaching card carried (`coachingTopic`, checked against the manager's message by the loop). */
  cardTopic?: string | null,
  /**
   * Port from the sibling app (its QA's live re-run, 23 Nov 2026, A1): a loop card's write-in is the topic the card
   * names, else the topic the manager named after the person's name (QA, 17 Nov 2026); never a sentence of the account.
   */
  cardOnly = false,
): T {
  if (!otherWriteInGuardEnabled()) return draft;
  let values = draft.values;
  let checked = draft.checked;
  for (const [group, writeIn] of Object.entries(WRITE_INS)) {
    if (!fieldKeys.has(writeIn) || !(checked[group] ?? []).includes(OTHER)) continue;
    /* HOTFIX follow-up (QA, 17 Nov 2026): the card's own topic first; the text after the person's name is the fallback. */
    const topic = (cardTopic ?? "").trim();
    if (topic) {
      values = { ...values, [writeIn]: topic.slice(0, LONGEST) };
      continue;
    }
    /* HOTFIX: a topic that is the whole request naming the person ("Coaching for <name> on …") becomes the topic. */
    const written = (values[writeIn] ?? "").trim();
    const trimmed = written ? topicAfterName(written, employeeName) : null;
    if (trimmed) {
      values = { ...values, [writeIn]: trimmed };
      continue;
    }
    if (written !== "") continue;
    const words = managerIssueWords(notes, employeeName, cardOnly);
    if (words) {
      values = { ...values, [writeIn]: words };
      continue;
    }
    const rest = checked[group]!.filter((option) => option !== OTHER);
    checked = { ...checked };
    if (rest.length > 0) checked[group] = rest;
    else delete checked[group];
  }
  return values === draft.values && checked === draft.checked ? draft : { ...draft, values, checked };
}
