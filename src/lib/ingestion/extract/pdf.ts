import "server-only";

import { IngestionError } from "../errors";
import {
  normalizeWhitespace,
  summarize,
  type ExtractedDocument,
  type ExtractedSegment,
} from "./types";

/**
 * PDF text extraction, one segment per page so page numbers stay real.
 *
 * `unpdf` is a serverless-targeted build of pdf.js: no native bindings, no
 * worker file to ship, runs on the Node runtime Vercel gives a route handler.
 * `mergePages: false` is what yields per-page strings — the whole reason a
 * citation can honestly say "Page 14".
 *
 * Scanned PDFs contain images rather than text and legitimately yield nothing.
 * That surfaces as a "no_text" error the manager can act on (run OCR, upload a
 * text version) rather than a document that silently indexes to zero chunks.
 */
export async function extractPdf(buffer: Uint8Array): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  let pages: string[];
  let totalPages: number;

  try {
    // pdf.js transfers and detaches the buffer it is given; hand it a copy so
    // the caller's bytes stay usable for the storage upload.
    const proxy = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(proxy, { mergePages: false });
    pages = Array.isArray(result.text) ? result.text : [result.text];
    totalPages = result.totalPages ?? pages.length;
  } catch (error) {
    throw new IngestionError(
      "extraction_failed",
      "This PDF could not be read. It may be encrypted, password protected or damaged.",
      422,
      { cause: error },
    );
  }

  const segments: ExtractedSegment[] = pages.map((page, index) => ({
    text: normalizeWhitespace(page ?? ""),
    locator: `Page ${index + 1}`,
    page: index + 1,
    section: null,
  }));

  const extracted = summarize(segments, totalPages);

  if (extracted.characterCount === 0) {
    throw new IngestionError(
      "no_text",
      "No text could be extracted from this PDF. If it is a scan, run OCR on it first or upload a text version.",
      422,
    );
  }

  return extracted;
}
