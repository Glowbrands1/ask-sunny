import type { MatchedChunkRow } from "./mappers";
import {
  hybridScore,
  policyManualBoost,
  sectionTitleMatches,
  type HybridCandidate,
} from "./hybrid-rank";

/**
 * Guaranteed candidates. No similarity floor.
 *
 * The existing hybrid selector drops a row under the vector floor unless a
 * keyword rank or an exact title saves it. That is how a named section with a
 * weak embedding disappears. Here every fused candidate can occupy a top-N
 * slot, a fuzzy or exact title is kept even past that N, and a glossary
 * heading already written into the query is a title match.
 */

export interface RecallCandidate extends HybridCandidate {
  readonly sectionSimilarity?: number | null;
}

const FUZZY_WORD = 0.5;

function trigrams(value: string): Set<string> {
  const padded = `  ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const grams = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** Dice coefficient over character trigrams. Used when the SQL score is absent. */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function contentWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5);
}

/**
 * A heading word is close to a query word. "parking lot" reaches
 * "Employee Parking" this way. "tardiness" does not reach "Attendance";
 * the glossary does that.
 */
export function sectionFuzzyMatches(query: string, section: string | null | undefined): boolean {
  if (!section) return false;
  const tokens = contentWords(section);
  if (tokens.length === 0) return false;
  return contentWords(query).some((word) =>
    tokens.some((token) => trigramSimilarity(word, token) >= FUZZY_WORD),
  );
}

export function sectionIsNamed(query: string, section: string | null | undefined, exact = false): boolean {
  return exact || sectionTitleMatches(query, section) || sectionFuzzyMatches(query, section);
}

/**
 * Top-N by fused rank, plus every named section. Named sections lead so a
 * title the manager used is inside the window the reranker and the answer see.
 */
export function selectRecallCandidates(
  candidates: readonly RecallCandidate[],
  query: string,
  options: { readonly limit: number },
): { rows: MatchedChunkRow[]; pinnedIds: string[] } {
  const limit = Math.max(1, options.limit);
  const scored = candidates.map((candidate) => {
    const named = sectionIsNamed(query, candidate.row.section, candidate.sectionExact);
    const sqlFuzzy =
      typeof candidate.sectionSimilarity === "number" && candidate.sectionSimilarity >= 0.3;
    return {
      row: candidate.row,
      named,
      keep: named || sqlFuzzy,
      score:
        hybridScore({
          vectorRank: candidate.vectorRank,
          keywordRank: candidate.keywordRank,
          sectionMatch: named || sqlFuzzy,
        }) +
        (candidate.sectionSimilarity ?? 0) +
        policyManualBoost(query, candidate.row),
    };
  });
  scored.sort((a, b) => b.score - a.score || b.row.similarity - a.row.similarity);

  const chosen: typeof scored = [];
  const seen = new Set<string>();
  for (const item of scored) {
    if (seen.has(item.row.chunk_id)) continue;
    if (item.keep || chosen.length < limit) {
      chosen.push(item);
      seen.add(item.row.chunk_id);
    }
  }
  chosen.sort((a, b) => Number(b.named) - Number(a.named) || b.score - a.score);
  return {
    rows: chosen.map((item) => item.row),
    pinnedIds: chosen.filter((item) => item.named).map((item) => item.row.chunk_id),
  };
}
