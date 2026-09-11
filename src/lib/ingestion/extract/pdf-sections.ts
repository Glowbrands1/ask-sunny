import { normalizeWhitespace, type ExtractedSegment } from "./types";

/**
 * ============================================================================
 * WHICH POLICY, NOT JUST WHICH PAGE
 * ============================================================================
 *
 * A PDF page is a printing accident. "Page 18" tells a manager where to look
 * and nothing about what they are looking at, and on a disciplinary record the
 * citation is the part that has to survive being read back months later by
 * somebody who was not in the room.
 *
 * DOCX and TXT extraction already carry a section: mammoth keeps `<h1>`-`<h6>`,
 * and Markdown keeps its own headings. A PDF has no such structure — pdf.js
 * returns one flat string per page — so the headings are recovered from the
 * shape of the lines, and a page is split at each one. The manual's own
 * "Dress Code for The Company" then travels with the text under it, all the way
 * to "Page 16 — Dress Code for The Company" on the form.
 *
 * ============================================================================
 * A WRONG TOPIC IS WORSE THAN NO TOPIC
 * ============================================================================
 *
 * A citation naming the wrong policy is a citation that fails exactly when
 * somebody checks it. So every rule below REJECTS, and a line is a heading only
 * when it survives all of them:
 *
 *   - Short. Body text in a policy manual wraps near the page width; a heading
 *     does not. This single rule removes most of a page.
 *   - No terminal punctuation. A line ending in `.` `,` `;` is a sentence or the
 *     tail of one. A trailing COLON is allowed and then dropped, because
 *     "Sun Tan City:" is how this manual writes a heading.
 *   - Not a bullet, not a dot-leader table-of-contents row, not a signature
 *     rule, not the "16 | P a g e" footer every page carries.
 *   - Title Case. Most significant words start capitalised — the property that
 *     separates "Late Opening" from a wrapped clause that happens to be short.
 *
 * When nothing on a page qualifies, the page keeps the last heading seen, which
 * is the section it is genuinely still inside. When no heading has been seen at
 * all the locator stays "Page N", exactly as before.
 */

/** Longer than this is body text that happens to sit on its own line. */
const MAX_HEADING_CHARS = 72;
/** Headings in a policy manual are a phrase, not a clause. */
const MAX_HEADING_WORDS = 10;
/** At least this share of significant words must start capitalised. */
const MIN_TITLE_CASE_RATIO = 0.6;

/**
 * "16 | P a g e" — Word's letter-spaced page footer, which pdf.js hands back as
 * the first line of every page.
 *
 * It is DROPPED rather than merely refused as a heading. Left in, it is a
 * segment of its own carrying the previous page's section, and the chunker then
 * merges that undersized stub with the text after it and keeps the stub's
 * locator — so the first real section of a page was labelled with the last
 * section of the page before. Removing the footer removes the stub.
 */
const PAGE_FURNITURE = /^\d+\s*\|\s*p\s*a\s*g\s*e\s*$/i;
/** "o", "▪" and friends: a list item, however short it is. */
const BULLET = /^[o•▪◦·*\-–—]\s/;
/** "Dress Code for The Company ......... 15" — a table-of-contents row. */
const DOT_LEADER = /\.{4,}/;
/** "Employee Signature: ______" — a form rule, not a heading. */
const FILL_RULE = /_{3,}/;
/** A sentence, or the tail of one. A colon is deliberately NOT in this set. */
const SENTENCE_END = /[.,;!?]$/;
/**
 * A contact row from a reference list — "Curt Bowen Owner curt@example.com" —
 * which is short, capitalised, and not a heading.
 */
const CONTACT = /\S+@\S+|https?:\/\//i;

/**
 * Words that carry no capitalisation signal. "Texting as General Work
 * communications" is a heading in this manual despite two lower-case words, so
 * the ratio is measured over the words that would be capitalised in a title.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
  "of", "on", "or", "per", "the", "to", "up", "via", "with",
]);

/**
 * The heading a line states, or null.
 *
 * Pure and exported for its own tests: this is the judgement the whole locator
 * rests on, and it is verified against real manual pages rather than inferred.
 */
export function headingOf(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line) return null;
  if (line.length > MAX_HEADING_CHARS) return null;
  if (PAGE_FURNITURE.test(line)) return null;
  if (BULLET.test(line)) return null;
  if (DOT_LEADER.test(line)) return null;
  if (FILL_RULE.test(line)) return null;
  if (SENTENCE_END.test(line)) return null;
  if (CONTACT.test(line)) return null;

  /*
   * A CLOSING BRACKET WITH NO OPENING ONE IS A WRAPPED LINE. The manual's
   * "(See\nSeminar/Webinar Attendance section)" wraps so that its second line
   * reads as a tidy Title Case phrase and would otherwise be taken for a
   * heading — naming a section that does not start there.
   */
  const closers = (line.match(/[)\]]/g) ?? []).length;
  const openers = (line.match(/[([]/g) ?? []).length;
  if (closers > openers) return null;

  // A heading opens with a capital. This also drops every wrapped continuation
  // line, which begins wherever the previous line ran out of room.
  if (!/^[A-Z]/.test(line)) return null;

  const words = line.split(/\s+/);
  if (words.length > MAX_HEADING_WORDS) return null;
  // A lone digit-run is a page number, a year, or a stray figure.
  if (!/[A-Za-z]/.test(line)) return null;

  const significant = words.filter((word) => {
    const bare = word.replace(/[^A-Za-z]/g, "");
    return bare.length > 0 && !SMALL_WORDS.has(bare.toLowerCase());
  });
  if (significant.length === 0) return null;

  const capitalised = significant.filter((word) => /^[^A-Za-z]*[A-Z]/.test(word));
  if (capitalised.length / significant.length < MIN_TITLE_CASE_RATIO) return null;

  // "All Locations Dress Code:" is the heading; the colon is punctuation.
  return line.replace(/\s*:$/, "").trim() || null;
}

/**
 * Whether a line is the page footer and nothing else.
 *
 * Exported because a reader of already-indexed chunks needs the same answer:
 * chunks stored before this module existed still carry the footer, and it is
 * where one sheet ends and the next begins.
 */
export function isPageFooter(line: string): boolean {
  return PAGE_FURNITURE.test(line.trim());
}

/** The citation label. "Page 18 — Sun Tan City", or "Page 18" with no heading. */
export function pageLocator(page: number, section: string | null): string {
  return section ? `Page ${page} — ${section}` : `Page ${page}`;
}

/**
 * One page of extracted text as one segment per heading.
 *
 * `carriedSection` is the heading still in force from the previous page, so
 * policy that runs over a page break stays attributed to the section it is
 * actually part of. Returns the heading left in force for the next page.
 */
export function splitPageIntoSections(
  pageText: string,
  page: number,
  carriedSection: string | null,
): { segments: ExtractedSegment[]; section: string | null } {
  const segments: ExtractedSegment[] = [];
  let section = carriedSection;
  let buffer: string[] = [];

  const flush = (forSection: string | null) => {
    const text = normalizeWhitespace(buffer.join("\n"));
    buffer = [];
    if (!text) return;
    segments.push({
      text,
      locator: pageLocator(page, forSection),
      page,
      section: forSection,
    });
  };

  for (const line of pageText.replace(/\r\n?/g, "\n").split("\n")) {
    if (PAGE_FURNITURE.test(line.trim())) continue;

    const heading = headingOf(line);
    if (heading) {
      // Text gathered so far belongs to the heading that was in force while it
      // was read, not to the one just found.
      flush(section);
      section = heading;
      /*
       * THE HEADING STAYS IN THE TEXT. It is the most retrievable line of its
       * own section — a manager asking about the dress code is asking in the
       * words of the heading — and dropping it would remove that from the
       * embedded content to gain nothing.
       */
      buffer.push(line.trim());
      continue;
    }
    buffer.push(line);
  }

  flush(section);
  return { segments, section };
}

/** Every page of a PDF as heading-aware segments, in reading order. */
export function pdfSegments(pages: readonly string[]): ExtractedSegment[] {
  const segments: ExtractedSegment[] = [];
  let section: string | null = null;

  pages.forEach((pageText, index) => {
    const split = splitPageIntoSections(pageText ?? "", index + 1, section);
    segments.push(...split.segments);
    section = split.section;
  });

  return segments;
}
