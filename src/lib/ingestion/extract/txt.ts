import {
  normalizeWhitespace,
  summarize,
  type ExtractedDocument,
  type ExtractedSegment,
} from "./types";

/**
 * Plain text and Markdown.
 *
 * Logical boundaries are preserved by splitting on headings when the file has
 * them — Markdown ATX headings (`## Attendance`), setext underlines, and
 * standalone SHOUTING lines, all of which real policy exports use. A file with
 * no headings becomes a single segment and the chunker handles the rest.
 */

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const SETEXT_UNDERLINE = /^(=|-){3,}\s*$/;

export function extractTextFile(buffer: Uint8Array): ExtractedDocument {
  const decoded = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
  return extractFromString(decoded);
}

export function extractFromString(raw: string): ExtractedDocument {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  const segments: ExtractedSegment[] = [];
  let currentSection: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = normalizeWhitespace(buffer.join("\n"));
    buffer = [];
    if (!text) return;
    segments.push({
      text,
      locator: currentSection ?? "Text",
      page: null,
      section: currentSection,
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const next = lines[index + 1];

    const atx = ATX_HEADING.exec(line.trim());
    const isSetext =
      line.trim().length > 0 &&
      typeof next === "string" &&
      SETEXT_UNDERLINE.test(next.trim());
    const isShout =
      /^[A-Z0-9][A-Z0-9 &'()/,.:-]{3,79}$/.test(line.trim()) &&
      /[A-Z]{3}/.test(line) &&
      (lines[index + 1] ?? "").trim() === "";

    if (atx || isSetext || isShout) {
      flush();
      currentSection = (atx ? atx[2]! : line).trim();
      if (isSetext) index += 1;
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (segments.length === 0) {
    const text = normalizeWhitespace(raw);
    if (text) {
      segments.push({ text, locator: "Text", page: null, section: null });
    }
  }

  return summarize(segments, null);
}
