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

/*
 * ADD_OUT_OF_OTHER_SECTIONS_ENABLED (QA's Bubbles round-16b live test, 10 Nov 2026): "can you add that she was reminded
 * of the policy" came back as the whole text with the new sentence glued onto the end of the Expectation paragraph
 * ("…unable to attend. <name> was reminded of the policy."). A whole-text write that is the old text with every section
 * in place, the same except for words added to the end of ONE section other than Observed: those words are an add,
 * and go under Observed. Anything else (a section reworded, two sections changed, Observed changed) is left as written.
 */
interface Section {
  readonly heading: string;
  readonly body: string;
}

function sectionsOf(text: string): Section[] | null {
  const out: { heading: string; body: string[] }[] = [];
  for (const line of lines(text)) {
    if (HEADING.test(line)) {
      const colon = line.indexOf(":");
      out.push({ heading: line.slice(0, colon + 1).trim().toLowerCase(), body: [line.slice(colon + 1)] });
    } else if (out.length > 0) out[out.length - 1]!.body.push(line);
    else if (line.trim() !== "") return null;
  }
  return out.length > 1 ? out.map((section) => ({ heading: section.heading, body: section.body.join("\n").trim() })) : null;
}

/** The words a whole-text write added to the end of one non-Observed section, or null. */
export function insertedInOtherSection(old: string, next: string): string | null {
  if (!hasSections(old)) return null;
  const was = sectionsOf(old);
  const now = sectionsOf(next);
  if (!was || !now || was.length !== now.length) return null;
  let extra: string | null = null;
  for (const [index, section] of was.entries()) {
    const other = now[index]!;
    if (other.heading !== section.heading) return null;
    const before = squash(section.body);
    const after = squash(other.body);
    if (before === after) continue;
    if (OBSERVED.test(`${section.heading}`) || extra !== null || !after.startsWith(`${before} `)) return null;
    const words = other.body.split(/\s+/).filter(Boolean);
    const kept = section.body.split(/\s+/).filter(Boolean).length;
    extra = words.slice(kept).join(" ").trim();
  }
  return extra && /[\p{L}]/u.test(extra) ? extra : null;
}
