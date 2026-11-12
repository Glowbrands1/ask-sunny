import { wovenTextNulStripEnabled } from "@/lib/config/chat-quality-flags";

import { summarize, type ExtractedDocument } from "./types";

/**
 * ============================================================================
 * NO NUL CHARACTERS IN EXTRACTED TEXT (WOVEN_TEXT_NUL_STRIP_ENABLED, default off)
 * ============================================================================
 *
 * QA, 10 Nov 2026: three Woven tanning-bed manuals have failed since 4 Nov 2026 with "Chunks could not be saved:
 * unsupported Unicode escape sequence". Their PDFs' text layer holds NUL characters (U+0000); Postgres stores neither
 * in a text column nor in jsonb, so the chunk insert is refused and the document stays "failed" on every retry.
 *
 * With the flag on, NUL is removed from every segment's text, locator and section before chunking. It carries no
 * meaning in a document, so nothing a manager could read is lost. A segment that was only NULs is dropped as empty, and
 * the character count is recomputed. Pure apart from the flag.
 */

const NUL = /\u0000/g;

const clean = (value: string): string => value.replace(NUL, "");

export function withoutNulCharacters(extracted: ExtractedDocument): ExtractedDocument {
  if (!wovenTextNulStripEnabled()) return extracted;
  const has = (value: string | null | undefined) => typeof value === "string" && value.includes("\u0000");
  if (!extracted.segments.some((segment) => has(segment.text) || has(segment.locator) || has(segment.section))) return extracted;
  const segments = extracted.segments.map((segment) => ({
    ...segment,
    text: clean(segment.text),
    locator: clean(segment.locator),
    section: segment.section === null ? null : clean(segment.section),
  }));
  const read = summarize(segments, extracted.pageCount);
  return extracted.ocr ? { ...read, ocr: extracted.ocr } : read;
}
