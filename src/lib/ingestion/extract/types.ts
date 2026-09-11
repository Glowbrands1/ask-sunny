/**
 * A contiguous run of text with the locator that will appear on a source card.
 *
 * Segments are the boundary the chunker tries not to cross: one PDF page, one
 * DOCX section under a heading, one logical block of a text file. Keeping the
 * locator attached from extraction all the way to the citation is what makes
 * "Page 14" on a source card true rather than decorative.
 */
export interface ExtractedSegment {
  text: string;
  /** Human label rendered in the citation, e.g. "Page 14" or "Coaching Standards". */
  locator: string;
  /** 1-indexed page number when the format has pages. This is the PDF sheet. */
  page: number | null;
  /**
   * The page number the DOCUMENT prints on that sheet, when it prints one.
   *
   * Not the same as `page`, and the difference is why both exist: a PDF whose
   * cover is unnumbered prints "15" on its sixteenth sheet. A citation names
   * this one where it exists, because it is the number a reader can check
   * against a printed copy or the document's own contents page. Null for
   * formats with no pages and for PDFs that print no page number.
   */
  printedPage?: number | null;
  /** Heading/section title when the format has them. */
  section: string | null;
  /**
   * True when `section`'s heading is PRINTED in this segment, rather than
   * carried in from the sheet before.
   *
   * The difference is what lets a citation say where a section starts. Policy
   * that runs over a page break keeps its section — correctly — but the heading
   * is printed once, and "which page is this section on" must answer with that
   * page rather than with every page the section covers.
   */
  sectionBeginsHere?: boolean;
}

export interface ExtractedDocument {
  segments: ExtractedSegment[];
  /** Total characters of extracted text across all segments. */
  characterCount: number;
  /** Page count when known. */
  pageCount: number | null;
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // Collapse runs of 3+ newlines to a paragraph break.
    .replace(/\n{3,}/g, "\n\n")
    // Collapse horizontal whitespace, but never across lines.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function summarize(segments: ExtractedSegment[], pageCount: number | null): ExtractedDocument {
  const kept = segments.filter((segment) => segment.text.trim().length > 0);
  return {
    segments: kept,
    characterCount: kept.reduce((total, segment) => total + segment.text.length, 0),
    pageCount,
  };
}
