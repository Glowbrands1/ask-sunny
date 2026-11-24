/*
 * ============================================================================
 * AN ADDRESS GIVEN AS THE EMPLOYEE'S, WHERE IT SITS (port of Ask Bubbles 4f9f706c; its QA, the u22 live run)
 * ============================================================================
 *
 * In Ask Bubbles, an address line given as the employee's ("address: <street>, <city>, <state>. <zip>") was read as the
 * card's store; the same readers here read it as the salon. The exit form's Permanent Address reader
 * (`exit-details.ts`) reads an address after "permanent / home / mailing / current address" (or "address" with "is" or
 * a colon) that starts with a street number: through a ZIP code where there is one, else to the end of the sentence. The
 * same shape lives here, with no imports, so the salon readers (`proposal.ts`, `salon-mention.ts`, `salon-cue.ts`) can leave every
 * such address out without importing the exit form's reader. Never gated: it only ever leaves something out.
 */
export const ADDRESS_LABEL =
  /\b(?:(?:permanent|home|mailing|current)\s+address(?:\s+is|\s*[:=\-–—])?|address\s*(?:is|[:=\-–—]))\s*/gi;
export const ADDRESS_THROUGH_ZIP = /^\d{1,6}[A-Za-z]?\s+[^\n]{2,100}?\b\d{5}(?:-\d{4})?\b/;
export const ADDRESS_TO_END = /^\d{1,6}[A-Za-z]?\s+[^\n.;!?]{2,100}?(?=\s*(?:[.;!?\n]|,\s*(?:she|he|they|her|his|last|and)\b|$))/i;

/**
 * Every address the exit form's Permanent Address reader reads, where it sits in the text. Never gated: the salon readers
 * use it only to leave an address out.
 */
export function typedAddressSpans(text: string): Array<{ readonly start: number; readonly end: number; readonly address: string }> {
  const spans: Array<{ start: number; end: number; address: string }> = [];
  for (const match of (text ?? "").matchAll(ADDRESS_LABEL)) {
    const start = (match.index ?? 0) + match[0].length;
    const found = ADDRESS_THROUGH_ZIP.exec(text.slice(start)) ?? ADDRESS_TO_END.exec(text.slice(start));
    if (found) spans.push({ start, end: start + found[0].length, address: found[0] });
  }
  return spans;
}

/** The text with every typed address blanked (same length), so no salon reader reads a salon inside one. */
export function withoutAddressLines(text: string): string {
  let out = text ?? "";
  for (const span of typedAddressSpans(out)) out = out.slice(0, span.start) + " ".repeat(span.end - span.start) + out.slice(span.end);
  return out;
}

