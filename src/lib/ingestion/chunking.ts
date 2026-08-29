import { CHUNKING } from "@/lib/config/models";
import type { ExtractedSegment } from "./extract/types";

/**
 * RAG CHUNKING — deterministic, dependency-free, and pure.
 *
 * The same input always produces the same chunks, byte for byte. That matters
 * for two reasons: it makes the behaviour testable without a network, and it
 * lets re-ingestion skip work when a document version has not changed.
 *
 * Boundary policy, in priority order:
 *   1. Never merge across segments (page/section) unless the accumulated text
 *      is still below `minTokens` — a two-line page is not a useful retrieval
 *      unit, so it joins the next one and the locator becomes a range.
 *   2. Inside a segment, split on paragraph breaks.
 *   3. A paragraph over the ceiling splits on sentence boundaries.
 *   4. A single sentence over the ceiling splits on word boundaries. Only here
 *      is a structural boundary broken, and only because there is none left.
 *
 * Overlap is carried as whole trailing sentences of the previous chunk, so a
 * chunk never begins mid-sentence.
 */

export interface DocumentChunk {
  index: number;
  content: string;
  /** Citation label, e.g. "Page 14" or "Pages 3–4" or "Coaching Standards". */
  locator: string;
  page: number | null;
  section: string | null;
  charCount: number;
  tokenEstimate: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  maxTokens?: number;
  minTokens?: number;
  overlapTokens?: number;
  charsPerToken?: number;
}

/** Deterministic estimate. Never calls a tokenizer, never calls the network. */
export function estimateTokens(
  text: string,
  charsPerToken: number = CHUNKING.charsPerToken,
): number {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}

export function chunkSegments(
  segments: ExtractedSegment[],
  options: ChunkOptions = {},
): DocumentChunk[] {
  const cfg = {
    targetTokens: options.targetTokens ?? CHUNKING.targetTokens,
    maxTokens: options.maxTokens ?? CHUNKING.maxTokens,
    minTokens: options.minTokens ?? CHUNKING.minTokens,
    overlapTokens: options.overlapTokens ?? CHUNKING.overlapTokens,
    charsPerToken: options.charsPerToken ?? CHUNKING.charsPerToken,
  };

  const merged = mergeUndersizedSegments(segments, cfg.minTokens, cfg.charsPerToken);

  const chunks: DocumentChunk[] = [];
  let previousTail = "";

  for (const segment of merged) {
    const pieces = splitSegment(segment.text, cfg);

    for (const piece of pieces) {
      // Overlap only bridges pieces of the same segment: carrying the tail of
      // page 3 into page 4 would attribute page 3's words to page 4's locator.
      const content = previousTail ? `${previousTail}\n\n${piece}` : piece;
      chunks.push(makeChunk(chunks.length, content, segment, cfg.charsPerToken));
      previousTail = tailForOverlap(piece, cfg.overlapTokens, cfg.charsPerToken);
    }

    previousTail = "";
  }

  return chunks;
}

function makeChunk(
  index: number,
  content: string,
  segment: MergedSegment,
  charsPerToken: number,
): DocumentChunk {
  return {
    index,
    content,
    locator: segment.locator,
    page: segment.page,
    section: segment.section,
    charCount: content.length,
    tokenEstimate: estimateTokens(content, charsPerToken),
  };
}

/* ------------------------------------------------------------- merging --- */

interface MergedSegment {
  text: string;
  locator: string;
  page: number | null;
  section: string | null;
}

/**
 * Joins consecutive segments while the running text is under `minTokens`.
 * Page runs become a range locator ("Pages 3–4"); section runs keep the first
 * section's title, which is the heading the merged text actually sits under.
 */
export function mergeUndersizedSegments(
  segments: ExtractedSegment[],
  minTokens: number,
  charsPerToken: number,
): MergedSegment[] {
  const out: MergedSegment[] = [];
  let pending: { texts: string[]; first: ExtractedSegment; last: ExtractedSegment } | null =
    null;

  const flush = () => {
    if (!pending) return;
    out.push({
      text: pending.texts.join("\n\n"),
      locator: rangeLocator(pending.first, pending.last),
      page: pending.first.page,
      section: pending.first.section,
    });
    pending = null;
  };

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;

    if (!pending) {
      pending = { texts: [text], first: segment, last: segment };
    } else {
      pending.texts.push(text);
      pending.last = segment;
    }

    if (estimateTokens(pending.texts.join("\n\n"), charsPerToken) >= minTokens) {
      flush();
    }
  }

  flush();
  return out;
}

function rangeLocator(first: ExtractedSegment, last: ExtractedSegment): string {
  if (first === last) return first.locator;
  if (first.page !== null && last.page !== null && last.page > first.page) {
    return `Pages ${first.page}–${last.page}`;
  }
  return first.locator;
}

/* ------------------------------------------------------------ splitting --- */

interface ResolvedConfig {
  targetTokens: number;
  maxTokens: number;
  minTokens: number;
  overlapTokens: number;
  charsPerToken: number;
}

/** Packs a segment's paragraphs into target-sized pieces. */
function splitSegment(text: string, cfg: ResolvedConfig): string[] {
  const units = paragraphsOf(text).flatMap((paragraph) =>
    estimateTokens(paragraph, cfg.charsPerToken) > cfg.maxTokens
      ? splitOversizedParagraph(paragraph, cfg)
      : [paragraph],
  );

  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const unit of units) {
    const unitTokens = estimateTokens(unit, cfg.charsPerToken);
    if (current.length > 0 && currentTokens + unitTokens > cfg.targetTokens) {
      pieces.push(current.join("\n\n"));
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += unitTokens;
  }

  if (current.length > 0) pieces.push(current.join("\n\n"));
  return pieces.filter((piece) => piece.trim().length > 0);
}

function splitOversizedParagraph(paragraph: string, cfg: ResolvedConfig): string[] {
  const sentences = sentencesOf(paragraph).flatMap((sentence) =>
    estimateTokens(sentence, cfg.charsPerToken) > cfg.maxTokens
      ? splitByWords(sentence, cfg)
      : [sentence],
  );

  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const tokens = estimateTokens(sentence, cfg.charsPerToken);
    if (current.length > 0 && currentTokens + tokens > cfg.targetTokens) {
      pieces.push(current.join(" "));
      current = [];
      currentTokens = 0;
    }
    current.push(sentence);
    currentTokens += tokens;
  }

  if (current.length > 0) pieces.push(current.join(" "));
  return pieces;
}

/** Last resort: no sentence boundary exists, so break on whitespace. */
function splitByWords(sentence: string, cfg: ResolvedConfig): string[] {
  const maxChars = cfg.maxTokens * cfg.charsPerToken;
  const words = sentence.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Sentence segmentation good enough for policy prose: split after `.`, `!` or
 * `?` followed by whitespace, without breaking common abbreviations or
 * decimals.
 */
export function sentencesOf(text: string): string[] {
  const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Sr|Jr|St|vs|etc|e\.g|i\.e|No|Inc|Ltd|Co)\.$/i;

  const out: string[] = [];
  let current = "";

  const tokens = text.split(/(?<=[.!?])(\s+)/);
  for (let index = 0; index < tokens.length; index += 2) {
    const sentence = tokens[index] ?? "";
    const gap = tokens[index + 1] ?? "";
    current += sentence;

    // No decimal guard is needed: the split above requires whitespace after
    // the period, and "3.5" has none. Guarding on a trailing digit would
    // instead swallow every real sentence that ends in a number
    // ("Follow up within 14 days. ...").
    if (!sentence || ABBREVIATIONS.test(sentence)) {
      current += gap;
      continue;
    }

    if (current.trim()) out.push(current.trim());
    current = "";
  }

  if (current.trim()) out.push(current.trim());
  return out.length > 0 ? out : [text.trim()].filter(Boolean);
}

/** Whole trailing sentences of `piece`, up to the overlap budget. */
export function tailForOverlap(
  piece: string,
  overlapTokens: number,
  charsPerToken: number,
): string {
  if (overlapTokens <= 0) return "";
  const budget = overlapTokens * charsPerToken;
  const sentences = sentencesOf(piece);

  const kept: string[] = [];
  let length = 0;

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]!;
    // Always keep at least one sentence, but never the whole piece — a chunk
    // that is entirely overlap carries no new information.
    if (kept.length > 0 && length + sentence.length > budget) break;
    kept.unshift(sentence);
    length += sentence.length + 1;
    if (length >= budget) break;
  }

  if (kept.length >= sentences.length) return "";
  return kept.join(" ").trim();
}
