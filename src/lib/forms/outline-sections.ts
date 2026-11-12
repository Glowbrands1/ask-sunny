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

/** A heading's label, as typed ("Expectation"), when the line is the label alone. */
const LABEL_ALONE = /^\s*(Observed|Observation|Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:\s*$/i;
/** A heading line with text after its colon: "Expectation: <D> is expected …". */
const LABEL_WITH_TEXT = /^(\s*(?:Observed|Observation|Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:)[ \t]*(\S.*)$/i;
const POLICY_REFERENCE = /^\s*Policy reference\s*:/i;

/*
 * QA's Ask Sunny r37 live check (12 Nov 2026, main 7e8dcdb6; names invented): on Details written "Observed:\nOn 11/9,
 * <D> was rude to a client.\n\nExpectation:\n<D> is expected …\n\nPolicy reference: …", the turn "make that update: he also
 * ignored a second client" saved "Observed: On 11/9, … and ignored a second client.\n\nExpectation: <D> is expected …
 * \nPolicy reference: …" — the labels pulled onto the text line, and the blank line before "Policy reference:" lost.
 * When the field had them: a label that stood on its own line stays on its own line, and "Policy reference:" keeps
 * its blank line.
 */
function withLabelsAsBefore(old: string, next: string): string {
  const before = lines(old);
  const alone = new Set(before.map((line) => LABEL_ALONE.exec(line)?.[1]?.toLowerCase()).filter((label): label is string => Boolean(label)));
  const policyApart = before.some((line, at) => POLICY_REFERENCE.test(line) && at > 0 && before[at - 1]!.trim() === "");
  const out: string[] = [];
  for (const line of lines(next)) {
    const labelled = LABEL_WITH_TEXT.exec(line);
    const label = labelled?.[1]?.replace(/:\s*$/, "").trim().toLowerCase();
    if (labelled && label && alone.has(label)) {
      out.push(labelled[1]!.trimEnd(), labelled[2]!);
      continue;
    }
    if (policyApart && POLICY_REFERENCE.test(line) && out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    out.push(line);
  }
  return out.join("\n");
}

/** One blank line before each section heading (but the first), when the field had them. */
export function withSectionSpacing(old: string, next: string): string {
  if (!/\n\s*\n\s*(?:Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:/i.test(old ?? "")) return next;
  const all = lines(withLabelsAsBefore(old, next));
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
