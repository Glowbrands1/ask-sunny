import type { MatchedChunkRow } from "./mappers";

/**
 * ============================================================================
 * KEYWORD RETRIEVAL BESIDE THE VECTOR SEARCH
 * ============================================================================
 *
 * ASK SUNNY FEEDBACK, 6 OCTOBER 2026. "generate me a coaching worksheet for
 * team members about getting checking accounts put onto client profiles" was
 * answered with "the knowledge base I have doesn't contain any Sun Tan City
 * policy on checking accounts". It does: the TC Mastery activity books, the
 * promotion guide and the BHOW framework all say why a checking account is
 * preferred. The question read as a COACHING request, so every vector match
 * was a coaching framework, and the chunks that say "checking account" — the
 * words the manager actually typed — never reached the prompt.
 *
 * So retrieval has a second, lexical leg (`match_knowledge_chunks_keyword`),
 * and this module is the pure part of it: which words are sent, and how the
 * two rankings become one. Pure so both are testable without a database.
 *
 * ============================================================================
 * THREE RULES
 * ============================================================================
 *
 * 1. THE VECTOR LEG STILL DECIDES WHETHER THE QUESTION IS IN SCOPE. Keyword
 *    rows are admitted only when vector search found at least one chunk above
 *    its similarity floor. A question the corpus does not cover — "the boiling
 *    point of tungsten" — still reaches the model with NO company knowledge,
 *    and the "no company documents matched" instruction still fires. Hybrid
 *    retrieval changes WHICH evidence an on-topic question gets, never WHETHER
 *    an off-topic one gets any.
 *
 * 2. ONE WORD IS NOT EVIDENCE. A keyword row needs at least two matched units
 *    (a term or an adjacent pair). "Client" alone is in a thousand chunks.
 *
 * 3. THE VECTOR RANKING IS KEPT, AND KEYWORDS GET A BOUNDED SHARE. Vector rows
 *    stay in their order. At most `KEYWORD_SLOTS` keyword-only rows are
 *    placed into it, one after every second vector row, so within the twelve
 *    evidence slots at most four of the weakest vector rows move out. Plain
 *    reciprocal rank fusion alternated the two lists and could displace half
 *    of the vector evidence on every question. A row both legs found stays
 *    where the vector leg put it.
 */

/** Keyword-only rows one answer may receive. */
export const KEYWORD_SLOTS = 4;

/** Vector rows between two keyword rows. */
const VECTOR_RUN = 2;

/** Matched units a keyword-only row needs before it counts as evidence. */
export const MIN_KEYWORD_UNITS = 2;

export interface KeywordQuery {
  /** Single words, as typed (stemming is the database's). */
  readonly terms: string[];
  /** Adjacent pairs of kept words, so a phrase outranks scattered words. */
  readonly phrases: string[];
}

export interface KeywordChunkRow extends Omit<MatchedChunkRow, "similarity"> {
  keyword_score: number;
  matched_units: number;
}

/*
 * The words a REQUEST is made of, which say nothing about what is being asked
 * for. Postgres drops English stop words itself; these are the ones it keeps.
 */
const REQUEST_WORDS = new Set([
  "generate", "make", "create", "give", "show", "tell", "help", "need", "needs",
  "want", "wants", "please", "pls", "can", "could", "would", "should", "get",
  "getting", "got", "put", "putting", "onto", "into", "using", "use", "way",
  "ways", "thing", "things", "something", "anything", "know", "like", "just",
  "also", "really", "able", "let", "lets", "hey", "thanks", "thank", "much",
  "many", "what", "which", "where", "when", "why", "how", "who", "whom", "the",
  "and", "for", "about", "with", "from", "this", "that", "these", "those",
  "there", "here", "have", "has", "had", "does", "did", "doing", "are", "was",
  "were", "been", "being", "you", "your", "our", "their", "them", "they",
  "she", "her", "his", "him", "its", "not", "any", "all", "some", "out",
  "who's", "what's", "it's", "i'm", "don't", "doesn't", "can't",
]);

const MAX_TERMS = 24;
const MAX_PHRASES = 16;

/**
 * The words and adjacent pairs sent to the keyword leg.
 *
 * A pair is two KEPT words that were next to each other in the question —
 * "checking accounts", not "checking … profiles" — so the database can reward
 * a chunk that has the phrase over one that only has both words.
 */
export function keywordQuery(question: string): KeywordQuery {
  const tokens = question.toLowerCase().match(/[a-z0-9][a-z0-9'’]*/g) ?? [];
  const kept = tokens.map((token) => {
    const word = token.replace(/['’]s$/, "").replace(/['’]/g, "");
    return word.length >= 3 && !REQUEST_WORDS.has(word) && !/^\d+$/.test(word) ? word : null;
  });

  const terms: string[] = [];
  const phrases: string[] = [];
  kept.forEach((word, index) => {
    if (word === null) return;
    if (!terms.includes(word)) terms.push(word);
    const next = kept[index + 1];
    if (next) {
      const pair = `${word} ${next}`;
      if (!phrases.includes(pair)) phrases.push(pair);
    }
  });

  return { terms: terms.slice(0, MAX_TERMS), phrases: phrases.slice(0, MAX_PHRASES) };
}

/**
 * One ranking from two.
 *
 * Keyword-only rows carry `similarity: 0` — never measured, as a pinned row's
 * is — because no similarity was computed for them and inventing one would put
 * a number on a source card that no model produced.
 */
export function fuseRankings(
  vector: readonly MatchedChunkRow[],
  keyword: readonly KeywordChunkRow[],
  limit: number,
): MatchedChunkRow[] {
  // Rule 1: an off-topic question gets no keyword evidence either.
  if (vector.length === 0) return [];

  const inVector = new Set(vector.map((row) => row.chunk_id));
  const extra: MatchedChunkRow[] = keyword
    .filter((row) => row.matched_units >= MIN_KEYWORD_UNITS && !inVector.has(row.chunk_id))
    .slice(0, KEYWORD_SLOTS)
    .map((row) => ({
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      document_title: row.document_title,
      category: row.category,
      locator: row.locator,
      page: row.page,
      section: row.section,
      content: row.content,
      similarity: 0,
    }));

  const fused: MatchedChunkRow[] = [];
  let next = 0;
  vector.forEach((row, rank) => {
    fused.push(row);
    if ((rank + 1) % VECTOR_RUN === 0 && next < extra.length) fused.push(extra[next++]!);
  });
  fused.push(...extra.slice(next));
  return fused.slice(0, limit);
}
