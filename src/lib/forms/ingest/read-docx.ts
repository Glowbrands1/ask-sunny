import { line, type SourceLine } from "./outline";
import { readZipText } from "./zip";

/**
 * READING A WORD DOCUMENT INTO LINES.
 *
 * Two sources, because neither alone is the document:
 *
 *   MAMMOTH, for the body. It converts Word's XML into a small, predictable
 *   subset of HTML and — the part that matters here — turns Word's checkbox
 *   controls and its ☐ symbol runs into `<input type="checkbox">`. That is a
 *   real structural signal about which lines are options, and it is exactly
 *   what a "convert the page to an image and read it" approach throws away.
 *   The project already depends on mammoth and already reads .docx this way in
 *   `lib/ingestion/extract/docx.ts`.
 *
 *   THE PAGE HEADER, read straight out of the archive. Word keeps a header in
 *   `word/header1.xml`, and the Coaching Form keeps its TITLE and the Sun Tan
 *   City brand there. Mammoth reports the body only, so a reader that stopped
 *   at mammoth would produce a form with no name on it. Those lines come back
 *   marked `chrome`, so the outline can tell "the document is called this" from
 *   "the form asks this".
 *
 * BOLD IS KEPT because Word forms head their sections with it and a flat PDF
 * cannot. Where the signal exists, it is used.
 */

const BLOCK = /<(p|h[1-6]|li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const CHECKBOX = /<input[^>]*type=["']checkbox["'][^>]*\/?>/gi;
const TAG = /<[^>]+>/g;

/** Named entities mammoth emits. Numeric ones are handled alongside. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function plain(html: string): string {
  return decodeEntities(html.replace(TAG, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Splits one block's HTML into the option labels its checkboxes introduce.
 *
 * Each control opens an option and the text after it is that option's label, so
 * "☐ Store Tours ☐ Engaging Conversation" is two options rather than one line
 * of prose. Anything before the FIRST control is not an option — it is the
 * lead-in — and is returned separately.
 */
export function splitCheckboxes(html: string): { lead: string; options: string[] } {
  CHECKBOX.lastIndex = 0;
  const pieces = html.split(CHECKBOX);
  if (pieces.length < 2) return { lead: plain(html), options: [] };
  return {
    lead: plain(pieces[0] ?? ""),
    options: pieces.slice(1).map((piece) => plain(piece)).filter((piece) => piece.length > 0),
  };
}

/**
 * True when the WHOLE block was bold — how a Word form heads a section.
 *
 * Whole, not partly: "**Name**: Click or tap here" is bold too, and it is a
 * field rather than a heading. So the test is that nothing survives OUTSIDE the
 * bold runs — which means measuring what is left of the ORIGINAL html once the
 * bold runs are cut out of it.
 */
function wholeBlockIsBold(html: string): boolean {
  if (!/<(strong|b)\b/i.test(html)) return false;
  const outside = plain(html.replace(/<(strong|b)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
  return outside.length === 0;
}

export interface DocxReading {
  lines: SourceLine[];
  brand: string | null;
  /** Told to the review screen so a person knows what was read. */
  notes: string[];
}

/** Turns mammoth's HTML plus the page header into the shared line model. */
export function readDocxHtml(html: string, headerLines: string[] = []): DocxReading {
  const lines: SourceLine[] = [];
  const notes: string[] = [];

  for (const headerLine of headerLines) {
    lines.push(line(headerLine, { chrome: true, emphasised: true }));
  }

  BLOCK.lastIndex = 0;
  for (const match of html.matchAll(BLOCK)) {
    const tag = (match[1] ?? "").toLowerCase();
    const inner = match[2] ?? "";
    const { lead, options } = splitCheckboxes(inner);

    if (options.length > 0) {
      // A lead-in before the first tick is kept as its own line so a label like
      // "Final Recommendation:" in front of the options is not lost.
      if (lead) lines.push(line(lead, { emphasised: wholeBlockIsBold(inner) }));
      lines.push(line(options.join(" "), { checkboxes: options }));
      continue;
    }

    const text = plain(inner);
    if (!text) continue;
    lines.push(
      line(text, {
        emphasised: wholeBlockIsBold(inner),
        headingLevel: /^h([1-6])$/.test(tag) ? Number(tag.slice(1)) : null,
      }),
    );
  }

  if (headerLines.length > 0) {
    notes.push(
      `Title and brand read from the document's page header: ${headerLines.join(" · ")}.`,
    );
  }

  return { lines, brand: headerLines[1] ?? null, notes };
}

/** The visible text of a Word header part, in order. */
export function readHeaderLines(bytes: Uint8Array): string[] {
  const found: string[] = [];
  for (const part of ["word/header1.xml", "word/header2.xml", "word/header3.xml"]) {
    const xml = readZipText(bytes, part);
    if (!xml) continue;
    for (const paragraph of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const text = decodeEntities(
        [...paragraph[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
          .map((run) => run[1] ?? "")
          .join(""),
      )
        .replace(/\s+/g, " ")
        .trim();
      if (text) found.push(text);
    }
    if (found.length > 0) break;
  }
  return found;
}

/**
 * Reads a `.docx` into lines.
 *
 * `Buffer.from` COPIES, so mammoth gets its own bytes and the caller's array is
 * still intact afterwards for the digest that names the stored version.
 */
export async function readDocx(bytes: Uint8Array): Promise<DocxReading> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return readDocxHtml(result.value, readHeaderLines(bytes));
}
