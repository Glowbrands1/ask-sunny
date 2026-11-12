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

/**
 * Gate-Sunny-2 (12 Nov 2026): the added text repeats a line of the old field's own text (the reader echoed the field,
 * on one line or in sections, before the new sentence). Such an add is left to the writer's own handling
 * (ADD_NOT_REPEATED), never moved under Observed whole.
 */
export function repeatsOldText(old: string, added: string): boolean {
  const said = squash(added);
  return lines(old)
    .filter((line) => line.trim() !== "" && !HEADING.test(line))
    .some((line) => {
      const bare = squash(line);
      return bare.length >= 12 && said.includes(bare);
    });
}

/*
 * QA's ruling (b), 12 Nov 2026: only an add that reads as an account (what happened) goes under Observed. An
 * expectation or instruction ("she must practice the sanitizing checklist every shift", "needs to clock in on time",
 * "she will set a reminder") keeps the writer's old append, and is never lower-cased into the Observed paragraph.
 */
const EXPECTATION_OR_INSTRUCTION =
  /\b(?:must|needs?\s+to|should|ought\s+to|has\s+to|have\s+to|(?:is|are)\s+(?:expected|required)\s+to|going\s+forward)\b|^\s*(?:\S+\s+){0,2}will\b/i;

/** The added text reads as an account of what happened, not an expectation or an instruction. */
export function readsAsAccount(added: string): boolean {
  return added.trim() !== "" && !EXPECTATION_OR_INSTRUCTION.test(added.trim());
}

const EXPECTATION = /^\s*Expectations?\s*:/i;
/** The app's reference line after the sections ("Policy reference: …") ends a section too. */
const SECTION_END = /^\s*Policy reference\s*:/i;

/**
 * QA's ruling (b), extended (12 Nov 2026, Gate-Sunny-2 on #662): an expectation or instruction added to a field written in
 * sections goes under "Expectation:" as its own line, never glued onto the last line. Its first letter is a capital
 * only when the field's other lines start with one; otherwise it keeps the manager's casing.
 *
 * Ported from the sibling app (QA, 12 Nov 2026, from Gate-Bubbles-2 on its #814): with no Expectation section the instruction still landed under
 * Observed. Now the field's first "Expectation:" is started — on its own line after the Observed block (before the next
 * section or the "Policy reference:" line), a blank line before it — and the instruction goes under it. Null only when
 * the field has neither an Expectation nor an Observed section (the writer appends it as before).
 */
export function addUnderExpectation(old: string, added: string): string | null {
  const all = lines(old);
  const at = all.findIndex((line) => EXPECTATION.test(line));
  if (at < 0) return startExpectation(all, added);
  let next = all.findIndex((line, index) => index > at && (HEADING.test(line) || SECTION_END.test(line)));
  if (next < 0) next = all.length;
  let end = next;
  while (end - 1 > at && all[end - 1]!.trim() === "") end -= 1;
  const body = all.filter((line) => line.trim() !== "" && !HEADING.test(line) && !SECTION_END.test(line));
  const capitalised = body.length > 0 && body.every((line) => /^\s*\p{Lu}/u.test(line));
  const text = added.trim();
  const said = capitalised ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
  return [...all.slice(0, end), said, ...all.slice(end)].join("\n");
}

/** Whether the text has an "Observed:" section (with or without others after it). */
export function hasObserved(text: string): boolean {
  return lines(text).some((line) => OBSERVED.test(line));
}

/** The instruction under a new "Expectation:" started after the Observed block; null with no Observed section. */
function startExpectation(all: string[], added: string): string | null {
  const at = all.findIndex((line) => OBSERVED.test(line));
  if (at < 0) return null;
  let next = all.findIndex((line, index) => index > at && (HEADING.test(line) || SECTION_END.test(line)));
  if (next < 0) next = all.length;
  let end = next;
  while (end - 1 > at && all[end - 1]!.trim() === "") end -= 1;
  const body = all.slice(at + 1, end).filter((line) => line.trim() !== "");
  const capitalised = body.length > 0 && body.every((line) => /^\s*\p{Lu}/u.test(line));
  const text = added.trim();
  const said = capitalised ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
  const after = all.slice(end);
  const rest = after.length > 0 && after[0]!.trim() !== "" ? ["", ...after] : after;
  return [...all.slice(0, end), "", "Expectation:", said, ...rest].join("\n");
}
