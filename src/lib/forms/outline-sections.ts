/**
 * ============================================================================
 * A FIELD WRITTEN IN SECTIONS KEEPS ITS BLANK LINES (STEP_B_SECTION_SPACING_ENABLED)
 * ============================================================================
 *
 * QA's live draft test (Ask Bubbles production, Coaching Form v1, 8 Nov 2026; ported to Ask Sunny, which has the same
 * writer): after an edit, the blank lines between Observed / Expectation / Going Forward became single newlines. On: a
 * write keeps one blank line before each section heading when the field had them. Pure: the caller decides when the
 * flag applies. (Split out of #662 by QA, 12 Nov 2026; the add placement ships separately.)
 */

const HEADING = /^\s*(?:Observed|Observation|Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:/i;
const OBSERVED = /^\s*(?:Observed|Observation)\s*:/i;

function lines(text: string): string[] {
  return (text ?? "").replace(/\r\n/g, "\n").split("\n");
}

/** One blank line before each section heading (but the first), when the field had them. */
export function withSectionSpacing(old: string, next: string): string {
  if (!/\n\s*\n\s*(?:Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:/i.test(old ?? "")) return next;
  const all = lines(next);
  const out: string[] = [];
  for (const [index, line] of all.entries()) {
    if (index > 0 && HEADING.test(line) && !OBSERVED.test(line)) {
      while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
      if (out.length > 0) out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}
