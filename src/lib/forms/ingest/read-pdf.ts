import { line, type SourceLine } from "./outline";

/**
 * READING A PDF INTO LINES.
 *
 * BOTH KINDS OF PDF ARE READ, and the difference between them is a difference
 * of EVIDENCE rather than of path:
 *
 *   A FILLABLE PDF carries AcroForm fields. Those are the strongest structured
 *   signal a document can offer — a real declaration of "this is a checkbox,
 *   this is a text box, this one takes several lines" — and they are collected
 *   here as hints alongside the text.
 *
 *   A FLAT PDF carries none. Almost every business form is one: the supplied
 *   Coaching Form reports zero fields, which is what made "the upload succeeded
 *   and the form did not change" the reported bug. Zero fields is NOT a reason
 *   to refuse the document. Its text still says "☐ Store Tours", "Name: Click
 *   or tap here to enter text.", "Employee Signature", and those are what the
 *   outline rules read.
 *
 * WHAT A PDF CANNOT TELL US is which lines were bold, so no emphasis is
 * reported rather than guessed from font names. The outline's heading rule is
 * written to work without it.
 *
 * The ☐ GLYPHS ARE RESOLVED HERE, not downstream, so a PDF's ticks and a Word
 * file's checkbox controls arrive at the outline as the same thing.
 */

/** Empty, ticked, and the two boxed variants business forms use. */
const CHECKBOX_GLYPH = /[☐☑☒■□▪▫❑❏]/u;
const CHECKBOX_SPLIT = /[☐☑☒■□▪▫❑❏]/gu;

export interface AcroFormHint {
  name: string;
  type: string;
  multiline: boolean;
  options: string[];
}

export interface PdfReading {
  lines: SourceLine[];
  brand: string | null;
  pageCount: number;
  /** Empty for a flat PDF, which is the ordinary case and not an error. */
  acroform: AcroFormHint[];
  notes: string[];
}

/** Splits a text line on its tick glyphs into option labels. */
export function splitGlyphCheckboxes(text: string): string[] {
  if (!CHECKBOX_GLYPH.test(text)) return [];
  CHECKBOX_SPLIT.lastIndex = 0;
  return text
    .split(CHECKBOX_SPLIT)
    .slice(1)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter((piece) => piece.length > 0);
}

const normalise = (text: string) =>
  text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The blank marker the outline rules already recognise. Structure, not text. */
const BLANK = "_____";

/**
 * Turns extracted page text into the shared line model.
 *
 * ============================================================================
 * WHERE ACROFORM FIELDS EARN THEIR KEEP
 * ============================================================================
 *
 * A FLAT PDF prints its blanks — "Name: Click or tap here to enter text." — so
 * the text alone says where an answer goes. A FILLABLE PDF often prints nothing
 * at all where a widget sits, because the widget IS the blank: its text layer
 * reads "Name:" and stops. Read by text rules alone, such a document would come
 * out as headings and prose with no fields in it.
 *
 * So a declared field is used to put the blank back. Where a line carries a
 * label that matches an AcroForm field's name and shows no blank of its own,
 * the marker is appended and the ordinary field rule fires:
 *
 *   a text field      -> a blank after its label, on the same line
 *   a date field      -> the same, read as a date by the existing rule
 *   a MULTILINE field -> a blank on a LINE OF ITS OWN, which is what a writing
 *                        area is, and it lands under the heading above it
 *
 * `_____` IS NOT TEXT THAT REACHES THE FORM. It is one of the blank markers the
 * outline already matches, and `stripPlaceholders` removes it before any label
 * is made. Nothing a PDF declares becomes a word on the page: the labels still
 * come from the printed text, and a field name that matches nothing printed is
 * ignored rather than promoted into a question nobody asked.
 */
export function readPdfText(text: string, acroform: AcroFormHint[] = []): SourceLine[] {
  const single = new Map<string, AcroFormHint>();
  const multiline = new Map<string, AcroFormHint>();
  for (const hint of acroform) {
    if (hint.type === "button" || hint.options.length > 0) continue;
    (hint.multiline ? multiline : single).set(normalise(hint.name), hint);
  }

  const lines: SourceLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;

    const checkboxes = splitGlyphCheckboxes(trimmed);
    if (checkboxes.length > 0 || acroform.length === 0) {
      lines.push(line(trimmed, { checkboxes }));
      continue;
    }

    const label = normalise(trimmed.replace(/:\s*$/, ""));
    if (multiline.has(label)) {
      // The label prints as its own heading, and the answer area belongs under
      // it — which is exactly how a heading followed by a blank already reads.
      lines.push(line(trimmed));
      lines.push(line(BLANK));
      continue;
    }
    if (single.has(label) && !/_{3,}/.test(trimmed)) {
      lines.push(line(`${trimmed} ${BLANK}`));
      continue;
    }
    lines.push(line(trimmed, { checkboxes }));
  }
  return lines;
}

/**
 * Reads a PDF's text and, where it has them, its form fields.
 *
 * `Uint8Array.from` COPIES: pdf.js takes ownership of the array it is handed
 * and detaches its buffer, so the caller's bytes have to be kept out of its
 * reach — the same defence `pdf-inspect.ts` documents, for the same reason.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfReading> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(Uint8Array.from(bytes));

  const acroform: AcroFormHint[] = [];
  try {
    const fields = await pdf.getFieldObjects();
    for (const [name, entries] of Object.entries(fields ?? {})) {
      const first = (Array.isArray(entries) ? entries[0] : entries) as
        | Record<string, unknown>
        | undefined;
      if (!first) continue;
      acroform.push({
        name,
        type: String(first.type ?? "text"),
        multiline: first.multiline === true,
        options: Array.isArray(first.items)
          ? (first.items as { displayValue?: string }[])
              .map((item) => String(item.displayValue ?? ""))
              .filter(Boolean)
          : [],
      });
    }
  } catch {
    // A document with no AcroForm dictionary throws rather than returning
    // nothing. That is the COMMON case for a business form and is not an error.
  }

  const { text } = await extractText(pdf, { mergePages: true });
  const notes = [
    acroform.length > 0
      ? `${acroform.length} fillable field${acroform.length === 1 ? "" : "s"} read from the PDF and used as structure.`
      : "This PDF carries no fillable fields, so its structure was read from the page text.",
  ];

  return {
    lines: readPdfText(typeof text === "string" ? text : String(text), acroform),
    brand: null,
    pageCount: pdf.numPages,
    acroform,
    notes,
  };
}
