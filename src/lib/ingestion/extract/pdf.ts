import "server-only";

import { wovenLargerFilesEnabled, wovenPdfOcrEnabled } from "@/lib/config/chat-quality-flags";

import { IngestionError } from "../errors";
import { megabytes } from "../synced-file-limit";
import { OCR_MODEL, ocrPdfPages, type OcrBudget } from "./pdf-ocr";

/**
 * WOVEN_LARGER_FILES_ENABLED: the largest scan OCR can send. The transcription request carries the PDF as base64 (4/3
 * of its size) inside the API's 32 MB request limit, so a larger scan is refused before any request.
 */
export const OCR_MAX_BYTES = 23 * 1024 * 1024;
import { pdfSegments } from "./pdf-sections";
import { summarize, type ExtractedDocument } from "./types";

/**
 * PDF text extraction, split by page AND by the headings found on it.
 *
 * `unpdf` is a serverless-targeted build of pdf.js: no native bindings, no
 * worker file to ship, runs on the Node runtime Vercel gives a route handler.
 * `mergePages: false` is what yields per-page strings — the whole reason a
 * citation can honestly say "Page 14".
 *
 * The page is then split at its own headings, so the locator names the policy
 * as well as the page: "Page 16 — Dress Code for The Company". See
 * `pdf-sections` for how a heading is recognised and why every rule there
 * refuses rather than reaches. A page with no recognisable heading keeps the
 * plain "Page N" this module produced before.
 *
 * Scanned PDFs contain images rather than text and legitimately yield nothing.
 * That surfaces as a "no_text" error the manager can act on (run OCR, upload a
 * text version) rather than a document that silently indexes to zero chunks.
 */
export async function extractPdf(buffer: Uint8Array, options: { ocr?: OcrBudget } = {}): Promise<ExtractedDocument> {
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

  const extracted = summarize(pdfSegments(pages), totalPages);

  if (extracted.characterCount === 0) {
    /*
     * WOVEN_PDF_OCR_ENABLED: a Woven sync (the only caller that passes a budget)
     * has the scan's pages read, through the same segmenting as any PDF. Nothing
     * read means today's answer. Off, as before.
     */
    if (options.ocr && wovenPdfOcrEnabled()) {
      if (wovenLargerFilesEnabled() && buffer.byteLength > OCR_MAX_BYTES) {
        throw new IngestionError(
          "too_large",
          `This scanned PDF is ${megabytes(buffer.byteLength)} MB; a scan can be read automatically up to ${megabytes(OCR_MAX_BYTES)} MB.`,
          422,
        );
      }
      const read = summarize(pdfSegments(await ocrPdfPages(buffer, totalPages, options.ocr)), totalPages);
      if (read.characterCount > 0) return { ...read, ocr: { model: OCR_MODEL } };
    }
    throw new IngestionError(
      "no_text",
      "No text could be extracted from this PDF. If it is a scan, run OCR on it first or upload a text version.",
      422,
    );
  }

  return extracted;
}
