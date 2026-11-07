/**
 * ============================================================================
 * A FIELD WRITTEN IN SECTIONS KEEPS ITS SECTIONS
 * ============================================================================
 *
 * QA's live draft test (the sibling app's production, Coaching Form v1, 8 Nov 2026): on a draft whose Details of Coaching
 * read "Observed: … \n\nExpectation: … \n\nGoing Forward: …", "add to the details that she was reminded about the
 * meeting twice" was appended after "Going Forward" — under the plan, not under what was observed — and the blank
 * lines between the sections became single newlines.
 *
 *   STEP_B_ADD_UNDER_OBSERVED_ENABLED   added account text goes at the end of the Observed section (an "add", or a
 *                                       whole-text write that is the old text with new lines after its last section).
 *   STEP_B_SECTION_SPACING_ENABLED      a write keeps one blank line before each section heading when the field had
 *                                       them.
 *
 * Pure: the caller decides when each flag applies.
 */

const HEADING = /^\s*(?:Observed|Observation|Expectations?|Going Forward|Plan|Follow[- ]?up)\s*:/i;
const OBSERVED = /^\s*(?:Observed|Observation)\s*:/i;

function lines(text: string): string[] {
  return (text ?? "").replace(/\r\n/g, "\n").split("\n");
}

/** The field is written in sections: an Observed heading and another after it. */
export function hasSections(text: string): boolean {
  const all = lines(text);
  const at = all.findIndex((line) => OBSERVED.test(line));
  return at >= 0 && all.slice(at + 1).some((line) => HEADING.test(line));
}

/** The old text with the added lines at the end of its Observed section. */
export function addUnderObserved(old: string, added: string): string {
  const all = lines(old);
  const at = all.findIndex((line) => OBSERVED.test(line));
  const next = all.findIndex((line, index) => index > at && HEADING.test(line));
  if (at < 0 || next < 0) return `${old.trim()}\n${added.trim()}`;
  let end = next;
  while (end - 1 > at && all[end - 1]!.trim() === "") end -= 1;
  return [...all.slice(0, end), added.trim(), ...all.slice(end)].join("\n");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A whole-text write that is the old text, every section in place, with new lines after its last section: those lines
 * belong under Observed. Null when the write is anything else.
 */
export function tailAfterLastSection(old: string, next: string): string | null {
  if (!hasSections(old)) return null;
  const was = squash(old);
  const now = squash(next);
  if (!now.startsWith(was) || now.length === was.length) return null;
  const all = lines(next);
  const oldLines = lines(old).filter((line) => line.trim() !== "");
  const kept = all.filter((line) => line.trim() !== "");
  if (kept.length <= oldLines.length) return null;
  const tail = kept.slice(oldLines.length).join("\n").trim();
  return tail === "" || HEADING.test(tail) ? null : tail;
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
