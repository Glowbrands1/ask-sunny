import { excerptBrandFilterEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A SOURCE EXCERPT NEVER QUOTES THE SIBLING COMPANY (EXCERPT_BRAND_FILTER_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA, 25 Oct 2026, B22-4): the JBA Policy Manual
 * covers every brand, and its PTO page lists each brand's peak season
 * ("o Sun Tan City – February 1 and June 1", "o Buff City Soap – November 1
 * and December 31", …). A retrieved chunk's text is shown whole as its
 * source excerpt, so a Sun Tan City answer quoted the soap brand's bullet.
 * The full-manual path drops other brands' SECTIONS (`full-manual-context.ts`)
 * and cites a heading only; nothing read a retrieved excerpt.
 *
 * This module reads the text an excerpt is cut from and leaves out what
 * names a brand in `EXCERPT_HIDDEN_BRANDS`:
 *
 *   A LINE OR SENTENCE        that names the brand.
 *   A BULLET                  "o <Brand> – …", on its own line or printed
 *                             inline after a colon ("… below: o <Brand> – …"),
 *                             with the lines the page wrapped it onto, which
 *                             begin in lower case.
 *   A BRAND LABEL             "<Brand>:" on its own line, and the block it
 *                             opens, up to the next label or a blank line.
 *
 * WHAT IS KEPT IS VERBATIM: a piece is kept whole or left out whole, nothing
 * is reworded. Text that names no hidden brand comes back unchanged.
 */

/**
 * The sibling company's brand, as a source excerpt must never show it.
 * Regular expression SOURCES. Crunch is not listed: it is a JB & Associates
 * brand, and its sections are already left out of the full manual.
 */
export const EXCERPT_HIDDEN_BRANDS: readonly string[] = [String.raw`Buff\s+City(?:\s+Soap)?`, String.raw`BCS`];

/** Documents whose excerpts are read: the multi-brand JBA manual, by title. */
const MULTI_BRAND_MANUAL = /\bJBA\s+Policy\s+Manual\b/i;

const LABEL_LINE = /^[\p{Lu}][^:\n]{0,60}:\s*$/u;
/** A label line in text typed all lowercase, where case says nothing. */
const LABEL_LINE_CASELESS = /^[\p{L}][^:\n]{0,60}:\s*$/u;

function brandPattern(brands: readonly string[]): RegExp | null {
  if (brands.length === 0) return null;
  return new RegExp(`\\b(?:${brands.map((source) => `(?:${source})`).join("|")})\\b`, "i");
}

/**
 * The pieces of one line: an inline bullet ("… below: o Next") and a new
 * sentence ("… arrives. The …") each start a piece. Every piece carries the
 * whitespace before it, so joining them gives the line back.
 */
function piecesOf(line: string, caseless = false): string[] {
  return caseless
    ? line.split(/(?<=\S)(?=[ \t]+o[ \t]+\S)|(?<=[.!?])(?=[ \t]+["“(]?\p{L})/u)
    : line.split(/(?<=\S)(?=[ \t]+o[ \t]+\S)|(?<=[.!?])(?=[ \t]+["“(]?\p{Lu})/u);
}

/** `text` without the lines, bullets, sentences and labelled blocks that name one of `brands`. */
export function withoutBrandLines(text: string, brands: readonly string[]): string {
  const names = brandPattern(brands);
  if (!names || !names.test(text)) return text;
  /*
   * Text with no capital letter at all ("o <brand> – february 1 and …")
   * gives case nothing to say: a new sentence, a label and a wrapped line
   * cannot be told by their first letter. There, a sentence starts after
   * ".", "!" or "?" whatever its case, any "word:" line is a label, and a
   * dropped bullet's wrapped line is one that follows a piece left open (not
   * ended by ".", "!", "?", ":" or ";") and starts no bullet of its own
   * (Pau's register rule). Text with capitals is read as before, except that
   * a lowercase wrapped line keeps a bullet printed inline on it.
   */
  const caseless = !/\p{Lu}/u.test(text);
  const labelLine = caseless ? LABEL_LINE_CASELESS : LABEL_LINE;
  const label = new RegExp(`^(?:${brands.map((source) => `(?:${source})`).join("|")})\\b[^:\\n]{0,40}:\\s*$`, "i");

  const kept: string[] = [];
  let inLabelBlock = false;
  let inDroppedBullet = false;
  for (const sourceLine of text.split("\n")) {
    let rawLine = sourceLine;
    let line = rawLine.trim();
    if (inLabelBlock) {
      if (line === "" || (labelLine.test(line) && !label.test(line))) inLabelBlock = false;
      else continue;
    }
    // The wrapped rest of a dropped bullet: lower case, and not the next bullet.
    // All lowercase, it is any line after a bullet left open (no ".", "!", "?",
    // ":" or ";" at its end). A bullet printed inline on the wrapped line
    // ("june 1 o <brand> – …") is kept from that bullet on.
    const wrapped =
      inDroppedBullet && line !== "" && !/^o\s/.test(line) && (caseless || /^\p{Ll}/u.test(line));
    if (wrapped) {
      const inline = line.search(/(?<=\S)[ \t]+o[ \t]+\S/);
      if (inline < 0) {
        if (caseless) inDroppedBullet = !/[.!?:;]$/.test(line);
        continue;
      }
      rawLine = line.slice(inline).trimStart();
      line = rawLine;
    }
    inDroppedBullet = false;
    if (label.test(line)) {
      inLabelBlock = true;
      continue;
    }
    if (!names.test(line)) {
      kept.push(rawLine);
      continue;
    }
    const pieces = piecesOf(rawLine, caseless);
    const keptPieces = pieces.filter((piece) => !names.test(piece));
    const last = pieces[pieces.length - 1]!;
    if (names.test(last) && /^\s*o\s/.test(last)) inDroppedBullet = caseless ? !/[.!?:;]\s*$/.test(last) : true;
    const rest = keptPieces.join("");
    if (rest.trim()) kept.push(rest.replace(/^[ \t]+/, rawLine.match(/^[ \t]*/)![0]));
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The text a source excerpt is cut from, as this company shows it. Only a
 * multi-brand manual's text is read, and only with the flag on; anything
 * else comes back unchanged.
 */
export function excerptTextForDisplay(text: string, documentTitle: string): string {
  if (!excerptBrandFilterEnabled()) return text;
  if (!MULTI_BRAND_MANUAL.test(documentTitle)) return text;
  return withoutBrandLines(text, EXCERPT_HIDDEN_BRANDS);
}
