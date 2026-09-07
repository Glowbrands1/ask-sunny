import { inspectPdf, type PdfInspection } from "./pdf-inspect";
import {
  DOCX_CONTENT_TYPE,
  DOC_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  detectSourceFormat,
  type SourceDocumentInspection,
} from "./source-format";
import type { AcroFormSummary } from "./pdf-inspect";

/**
 * READING AN UPLOADED SOURCE DOCUMENT.
 *
 * The server half of `source-format.ts` — see that file for what the formats
 * are and how they are told apart. This half opens them, and it is separate
 * because opening a PDF costs a PDF parser and opening a Word document costs a
 * zip reader and an XML parser, neither of which belongs in the browser bundle
 * behind the upload button.
 *
 * Never throws for a bad file: an unreadable upload is a REJECTION with a
 * reason, because "the administrator uploaded something odd" is a normal event
 * that must be recorded, not an exception that loses the audit trail.
 */

const NO_FIELDS: AcroFormSummary = { hasFields: false, fieldNames: [], fieldCount: 0 };

function rejected(reason: string): SourceDocumentInspection {
  return {
    ok: false,
    format: null,
    contentType: "application/octet-stream",
    extension: "",
    pageCount: null,
    acroform: NO_FIELDS,
    renderer: "structured",
    rejection: reason,
    notes: [],
    word: null,
  };
}

function fromPdf(inspection: PdfInspection): SourceDocumentInspection {
  return {
    ok: inspection.ok,
    format: "pdf",
    contentType: PDF_CONTENT_TYPE,
    extension: ".pdf",
    pageCount: inspection.pageCount,
    acroform: inspection.acroform,
    renderer: inspection.renderer,
    rejection: inspection.rejection,
    notes: inspection.notes,
    word: null,
  };
}

/**
 * Reads an uploaded file and reports what can honestly be done with it.
 *
 * Never throws for a bad file: an unreadable upload is a REJECTION with a
 * reason, because "the administrator uploaded something odd" is a normal event
 * that must be recorded, not an exception that loses the audit trail.
 */
export async function inspectSourceDocument(
  bytes: Uint8Array,
): Promise<SourceDocumentInspection> {
  const format = detectSourceFormat(bytes);

  if (format === "pdf") return fromPdf(await inspectPdf(bytes));
  if (format === "docx") return inspectDocx(bytes);
  if (format === "doc") return inspectLegacyDoc();

  return rejected(
    "That file is not a PDF or a Word document. The upload was not stored and the previous version is still active.",
  );
}

async function inspectDocx(bytes: Uint8Array): Promise<SourceDocumentInspection> {
  let text: string;
  try {
    /*
     * Imported HERE rather than at the top of the file, matching
     * `lib/ingestion/extract/docx.ts`: mammoth pulls in a zip reader and an XML
     * parser, and a route that only ever receives PDFs should not pay for them.
     *
     * `Buffer.from(bytes)` COPIES. mammoth is given its own bytes so the
     * caller's array is still intact afterwards for the SHA-256 that names the
     * version and for the upload itself.
     */
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    text = result.value;
  } catch (error) {
    return {
      ...rejected(
        `That Word document could not be read: ${(error as Error).message}. It may be damaged, or password protected.`,
      ),
      format: "docx",
      contentType: DOCX_CONTENT_TYPE,
      extension: ".docx",
    };
  }

  const paragraphs = text.split("\n").filter((line) => line.trim() !== "").length;

  return {
    ok: true,
    format: "docx",
    contentType: DOCX_CONTENT_TYPE,
    extension: ".docx",
    // A Word document has no pages until something lays it out, and reporting a
    // guess as a page count would put a made-up number in the audit trail.
    pageCount: null,
    acroform: NO_FIELDS,
    renderer: "structured",
    rejection: null,
    notes: [
      `Word document read: ${paragraphs} paragraph${paragraphs === 1 ? "" : "s"}. It is stored as the official reference copy, byte for byte, in the format it was uploaded in. Generated downloads are produced by the structured renderer from the published template version.`,
    ],
    word: { paragraphs, characters: text.length, readable: true },
  };
}

/**
 * The Word 97-2003 binary format.
 *
 * Accepted and stored, and NOT parsed. Nothing in this app reads the old binary
 * format, so the note says so rather than implying an inspection happened. The
 * file is still versioned, still downloadable and still the official copy —
 * which is what an administrator uploading one actually needs.
 */
function inspectLegacyDoc(): SourceDocumentInspection {
  return {
    ok: true,
    format: "doc",
    contentType: DOC_CONTENT_TYPE,
    extension: ".doc",
    pageCount: null,
    acroform: NO_FIELDS,
    renderer: "structured",
    rejection: null,
    notes: [
      "Word 97-2003 document stored as the official reference copy, byte for byte. Its contents are not read — this app does not parse the old binary .doc format — so re-saving it as .docx would let the upload be checked as well as kept.",
    ],
    word: { paragraphs: 0, characters: 0, readable: false },
  };
}
