/**
 * SECTION_BREAKS_KEPT_ENABLED (QA's live Sunny round 15, 10 Nov 2026): the P9 save at 03:07:44Z wrote Details of Coaching
 * as ONE paragraph, "Observed: … Expectation: … Going Forward: …", over a field written in sections ("Observed:\n…\n\n
 * Expectation:\n…"). The reader returned the new account on one line. A text the field holds in sections keeps them: each
 * heading the new text runs inline starts its own paragraph again, the heading on its own line as the old text had it.
 * Pure; the caller decides when it applies.
 */
const HEADING = /(Observed|Observation|Expectations?|Going Forward)\s*:\s*/g;
const OWN_LINE = /(?:^|\n)\s*(?:Observed|Observation)\s*:\s*\n/i;
/** Where a heading may start: the text, a line, or a sentence ("…on 10/14/26. Expectation:"). */
const STARTS = /(?:^|\n[ \t]*|[.!?]["')]?\s+)$/;

/**
 * A known label, capitalised, that starts the text, a line or a sentence. Never a word inside a sentence: "Also observed:"
 * (QA's Bubbles gate, nov7-refusal-bub-phone-trace) and "…was observed: …" are the manager's words, not sections.
 */
function headings(text: string): RegExpExecArray[] {
  return [...text.matchAll(HEADING)].filter((match) => STARTS.test(text.slice(0, match.index)));
}

export function withSectionBreaks(old: string | undefined, next: string): string {
  if (!old || !OWN_LINE.test(old)) return next;
  const found = headings(next);
  if (found.length < 2) return next;
  // Every heading already starts a line: the text has its sections.
  if (found.every((match) => match.index === 0 || next[match.index - 1] === "\n")) return next;
  const parts: string[] = [];
  const lead = next.slice(0, found[0]!.index).trim();
  if (lead) parts.push(lead);
  for (const [at, match] of found.entries()) {
    const start = match.index + match[0].length;
    const end = at + 1 < found.length ? found[at + 1]!.index : next.length;
    const body = next.slice(start, end).trim();
    parts.push(`${match[1]}:\n${body}`);
  }
  return parts.join("\n\n");
}
