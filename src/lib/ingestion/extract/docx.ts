import "server-only";

import { IngestionError } from "../errors";
import {
  normalizeWhitespace,
  summarize,
  type ExtractedDocument,
  type ExtractedSegment,
} from "./types";

/**
 * DOCX extraction that keeps headings as section locators.
 *
 * `mammoth` converts a .docx to a small, predictable subset of HTML — headings,
 * paragraphs, lists, tables. We convert to HTML rather than raw text precisely
 * so `<h1>`–`<h6>` survive, then split the document at each heading. A source
 * card can then say "Coaching Standards" instead of "Word document".
 */

const BLOCK_END = /<\/(p|li|tr|h[1-6]|div|blockquote)>/gi;
const HEADING = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i;
const TAG = /<[^>]+>/g;

export async function extractDocx(buffer: Uint8Array): Promise<ExtractedDocument> {
  const mammoth = (await import("mammoth")).default;

  let html: string;
  try {
    const result = await mammoth.convertToHtml({
      buffer: Buffer.from(buffer),
    });
    html = result.value;
  } catch (error) {
    throw new IngestionError(
      "extraction_failed",
      "This Word document could not be read. It may be an older .doc file or damaged — re-save it as .docx and try again.",
      422,
      { cause: error },
    );
  }

  const segments = splitHtmlByHeading(html);
  const extracted = summarize(segments, null);

  if (extracted.characterCount === 0) {
    throw new IngestionError(
      "no_text",
      "No text could be extracted from this Word document.",
      422,
    );
  }

  return extracted;
}

/** Exported for tests: pure HTML -> segments, no file system, no mammoth. */
export function splitHtmlByHeading(html: string): ExtractedSegment[] {
  // Insert paragraph breaks at block boundaries before tags are stripped, so
  // paragraph structure survives for the chunker.
  const withBreaks = html.replace(BLOCK_END, "$&\n\n");

  const blocks = withBreaks
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: ExtractedSegment[] = [];
  let currentSection: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = normalizeWhitespace(buffer.join("\n\n"));
    buffer = [];
    if (!text) return;
    segments.push({
      text,
      locator: currentSection ?? "Document body",
      page: null,
      section: currentSection,
    });
  };

  for (const block of blocks) {
    const heading = HEADING.exec(block);
    if (heading) {
      flush();
      const title = stripTags(heading[2]!);
      currentSection = title || currentSection;
      continue;
    }
    const text = stripTags(block);
    if (text) buffer.push(text);
  }

  flush();
  return segments;
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(TAG, " ")).replace(/[^\S\n]+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
