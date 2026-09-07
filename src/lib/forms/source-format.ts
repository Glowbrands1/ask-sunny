/**
 * WHICH FORMATS THE APP TAKES, AND HOW IT TELLS THEM APART.
 *
 * "Replace with a new file" used to mean "replace with a new PDF", and the
 * business does not only issue PDFs — the Coaching Form and all four hiring
 * forms arrived as Word files. Refusing them meant an administrator holding the
 * authoritative copy of a form could not attach it, which is the wrong way
 * round: the official copy should be storable in whatever format the business
 * issued it in.
 *
 * So an upload is now sorted by WHAT IT IS rather than by what it was called,
 * and each format is inspected on its own terms:
 *
 *   PDF    inspected as before — page count, and whether it carries AcroForm
 *          fields. Unchanged, down to the rejection wording.
 *   DOCX   opened and read. A file that will not open is rejected with the
 *          reason; one that opens is stored as the reference copy.
 *   DOC    the Word 97-2003 binary. Accepted and stored byte for byte, and
 *          honestly reported as unreadable for structure: nothing here parses
 *          the old format, and pretending to would be worse than saying so.
 *
 * THE FORMAT IS DETECTED FROM THE BYTES, NEVER FROM THE FILE NAME. A name is
 * something a browser sends; `.pdf` on a Word file would otherwise reach the
 * PDF reader, fail there, and be reported as a corrupt PDF. The extension is
 * used for exactly one thing — telling an OLE2 container that IS a Word
 * document from one that is a spreadsheet — and even then only as a second
 * opinion after the stream names have been checked.
 *
 * NOTHING HERE MAKES A FILE FILLABLE. A Word document reports no fillable
 * fields, on purpose and unconditionally: `hasFields` is what decides whether
 * the app will offer to map fields and write values into a file, and there is
 * no code that can write into a .docx. Generated downloads keep coming from the
 * structured renderer, which prints the published template version. An upload
 * is the OFFICIAL REFERENCE COPY, and saying so is the whole point of
 * inspecting it.
 *
 * "Without breaking the format" is the storage rule as well as the reading one:
 * the bytes are stored exactly as they arrived, under the extension they
 * arrived with and served back with the content type that matches. Nothing is
 * converted on the way in, so nothing can be lost on the way in.
 *
 * THIS FILE IS A LEAF, and it has to stay one. The upload button is a client
 * component and needs `ACCEPTED_UPLOAD_TYPES` and `FORMAT_LABEL`; the reading
 * side needs a PDF parser and a Word parser. Keeping the constants and the
 * byte-sniffing here means the browser bundle does not acquire either of them
 * for the sake of an `accept` attribute. `inspectSourceDocument`, which does
 * need both, lives in `source-document.ts` and imports this.
 *
 * `AcroFormSummary` is reached through an inline `import(...)` TYPE — erased at
 * compile time, so it names the shape without carrying anything from
 * `pdf-inspect` into a bundle.
 */

export type SourceFormat = "pdf" | "docx" | "doc";

export interface SourceDocumentInspection {
  ok: boolean;
  /** Null only when the bytes match no format this app accepts. */
  format: SourceFormat | null;
  /** What the bytes are served back as. */
  contentType: string;
  /** The extension the stored file keeps, with its dot. */
  extension: string;
  /** PDFs only. A Word document has no page count until it is laid out. */
  pageCount: number | null;
  acroform: import("./pdf-inspect").AcroFormSummary;
  /** How a generated download will be produced if this becomes active. */
  renderer: "structured" | "acroform";
  /** Set when the file cannot be accepted at all. */
  rejection: string | null;
  notes: string[];
  /** Word only: what reading the file found in it. */
  word: { paragraphs: number; characters: number; readable: boolean } | null;
}

export const PDF_CONTENT_TYPE = "application/pdf";
export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC_CONTENT_TYPE = "application/msword";

export const CONTENT_TYPE: Record<SourceFormat, string> = {
  pdf: PDF_CONTENT_TYPE,
  docx: DOCX_CONTENT_TYPE,
  doc: DOC_CONTENT_TYPE,
};

export const EXTENSION: Record<SourceFormat, string> = {
  pdf: ".pdf",
  docx: ".docx",
  doc: ".doc",
};

export const FORMAT_LABEL: Record<SourceFormat, string> = {
  pdf: "PDF",
  docx: "Word (.docx)",
  doc: "Word 97-2003 (.doc)",
};

/** What the file picker offers, and what the route will accept. */
export const ACCEPTED_UPLOAD_TYPES = [
  ".pdf",
  ".docx",
  ".doc",
  PDF_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
  DOC_CONTENT_TYPE,
].join(",");

/* ------------------------------------------------------------- sniffing --- */

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** `%PDF-` */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** `PK\x03\x04` — the local file header every non-empty zip opens with. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** The OLE2 compound-file header, shared by .doc, .xls and .ppt. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Whether an OLE2 container holds a Word document.
 *
 * OLE2 is a little file system, and its directory records stream names as
 * UTF-16LE. A Word document has a `WordDocument` stream; a workbook has `Book`
 * or `Workbook` instead. Looking for that name is enough to tell them apart
 * without parsing the container, and it is far more honest than trusting the
 * extension — which is the only other thing available, and is attacker-chosen.
 */
function holdsWordDocumentStream(bytes: Uint8Array): boolean {
  const name = "WordDocument";
  const utf16: number[] = [];
  for (const character of name) {
    utf16.push(character.charCodeAt(0), 0x00);
  }
  const limit = bytes.byteLength - utf16.length;
  for (let start = 0; start <= limit; start += 1) {
    let matched = true;
    for (let offset = 0; offset < utf16.length; offset += 1) {
      if (bytes[start + offset] !== utf16[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Whether a zip is a Word document.
 *
 * Checked against the RAW BYTES rather than by opening the archive, because
 * this runs before anything has decided the file is safe to open. Every .docx
 * stores `word/document.xml`, and a zip entry's name is written into the
 * archive uncompressed — so the name is there to be found whether or not the
 * entry itself is deflated. A .xlsx has `xl/workbook.xml` instead and does not
 * match.
 */
function holdsWordDocumentXml(bytes: Uint8Array): boolean {
  const needle = "word/document.xml";
  const haystack = new TextDecoder("latin1").decode(bytes);
  return haystack.includes(needle);
}

export function detectSourceFormat(bytes: Uint8Array): SourceFormat | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return "pdf";
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    return holdsWordDocumentXml(bytes) ? "docx" : null;
  }
  if (startsWith(bytes, OLE2_SIGNATURE)) {
    return holdsWordDocumentStream(bytes) ? "doc" : null;
  }
  return null;
}

