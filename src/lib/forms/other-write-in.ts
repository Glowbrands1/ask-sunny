import { otherWriteInGuardEnabled } from "@/lib/config/chat-quality-flags";

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
const FIELD_LINE = /^(?:employee|job title|location|date|type of warning|payroll deduct\w*|prior actions)\s*:/i;

/** What happened, in the manager's own words, short enough for a write-in; or null. */
export function managerIssueWords(notes: string): string | null {
  const lines = (notes ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const stated = lines.find((line) => /^what happened\s*:/i.test(line));
  const source = stated ? [stated.replace(/^what happened\s*:\s*/i, "")] : lines.filter((line) => !FIELD_LINE.test(line));
  for (const line of source) {
    for (const part of line.split(/(?<=[.!?])\s+|[,;]\s+/)) {
      const clause = part.trim().replace(/[.!?\s]+$/, "");
      if (clause.split(/\s+/).length < 3 || REQUEST.test(clause)) continue;
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
): T {
  if (!otherWriteInGuardEnabled()) return draft;
  let values = draft.values;
  let checked = draft.checked;
  for (const [group, writeIn] of Object.entries(WRITE_INS)) {
    if (!fieldKeys.has(writeIn) || !(checked[group] ?? []).includes(OTHER)) continue;
    if ((values[writeIn] ?? "").trim() !== "") continue;
    const words = managerIssueWords(notes);
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
