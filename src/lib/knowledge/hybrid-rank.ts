import { glossaryIntent } from "@/lib/ai/glossary";
import { classifyQuestionText } from "@/lib/analytics/taxonomy";
import { OFFICIAL_POLICY_MANUAL } from "@/lib/forms/official-policy-manual";

import type { MatchedChunkRow } from "./mappers";

/**
 * Reciprocal rank fusion of a vector list and a keyword list, plus an exact
 * section-title boost. Pure: the SQL returns the ranks, this decides the order.
 *
 * A section the question names outranks a merely similar chunk. That is the
 * late-opening versus attendance miss, and the cell-phone versus standards miss.
 */

export const RRF_K = 60;

const GENERIC_SECTION_WORDS = new Set([
  "policy",
  "policies",
  "section",
  "the",
  "and",
  "for",
  "manual",
]);

export function sectionTokens(section: string): string[] {
  return section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_SECTION_WORDS.has(word));
}

/**
 * "opened" and "opening" are the same heading word. Only the two endings
 * managers use when they describe a section they did not quote.
 */
function stem(word: string): string {
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  return word;
}

/**
 * The question names this section.
 *
 * A one-word title matches only that word. A longer title matches when at
 * least half of its content words, and at least two of them, appear. "cell
 * phone" matches "Cell Phone/Smart Watch Policy"; "attendance" does not match
 * "Seminar/Webinar Attendance". "opened the salon late" matches "Late Opening".
 */
export function sectionTitleMatches(query: string, section: string | null | undefined): boolean {
  if (!section || section.trim().length < 4) return false;
  const tokens = sectionTokens(section);
  if (tokens.length === 0) return false;
  const words = new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3)
      .map(stem),
  );
  const hits = tokens.filter((token) => words.has(stem(token)));
  if (tokens.length === 1) return hits.length === 1;
  return hits.length >= 2 && hits.length / tokens.length >= 0.5;
}

export function hybridScore(input: {
  vectorRank: number | null;
  keywordRank: number | null;
  sectionMatch: boolean;
}): number {
  let score = 0;
  if (input.vectorRank && input.vectorRank > 0) score += 1 / (RRF_K + input.vectorRank);
  if (input.keywordRank && input.keywordRank > 0) score += 1 / (RRF_K + input.keywordRank);
  if (input.sectionMatch) score += 1;
  return score;
}

/**
 * The category the JBA Policy Manual is filed under. Other compliance
 * documents share it; a framework filed elsewhere does not.
 */
const POLICY_MANUAL_CATEGORY = "policies_compliance";

/**
 * Two first-place reciprocal-rank terms. Enough for a policy-manual keyword
 * hit to outrank a framework chunk that won the vector list, and smaller than
 * a section-title match.
 */
const POLICY_MANUAL_BOOST = 2 / (RRF_K + 1);

/**
 * A policy question, from signals the app already has: the house glossary
 * marked a policy term, or the activity taxonomy read the question as policy.
 * No word-to-section map is added here.
 */
export function isPolicyTypeQuestion(query: string): boolean {
  if (glossaryIntent(query) === "policy") return true;
  return classifyQuestionText(query) === "policy_question";
}

/** The manual's own title prefix, or the category that manual is filed under. */
export function isPolicyManualChunk(row: Pick<MatchedChunkRow, "document_title" | "category">): boolean {
  const title = row.document_title.trim().toLowerCase();
  if (OFFICIAL_POLICY_MANUAL.fallbackTitles.some((prefix) => title.startsWith(prefix.toLowerCase()))) {
    return true;
  }
  return row.category === POLICY_MANUAL_CATEGORY;
}

export function policyManualBoost(
  query: string,
  row: Pick<MatchedChunkRow, "document_title" | "category">,
): number {
  if (!isPolicyTypeQuestion(query) || !isPolicyManualChunk(row)) return 0;
  return POLICY_MANUAL_BOOST;
}

export interface HybridCandidate {
  readonly row: MatchedChunkRow;
  readonly vectorRank: number | null;
  readonly keywordRank: number | null;
  /** The SQL found the section title as a substring of the query. */
  readonly sectionExact: boolean;
}

/**
 * Keep a vector hit at or above the floor, a named section, or a strong
 * keyword hit. Weak keyword noise stays out, so an off-topic question still
 * comes back empty.
 */
export function selectHybridMatches(
  candidates: readonly HybridCandidate[],
  query: string,
  options: { readonly vectorFloor: number; readonly limit: number },
): MatchedChunkRow[] {
  const ranked = candidates
    .map((candidate) => {
      const sectionMatch =
        candidate.sectionExact || sectionTitleMatches(query, candidate.row.section);
      const aboveFloor = candidate.row.similarity >= options.vectorFloor && candidate.vectorRank !== null;
      const strongKeyword = candidate.keywordRank !== null && candidate.keywordRank <= 3;
      return {
        row: candidate.row,
        include: aboveFloor || sectionMatch || strongKeyword,
        score:
          hybridScore({
            vectorRank: candidate.vectorRank,
            keywordRank: candidate.keywordRank,
            sectionMatch,
          }) + policyManualBoost(query, candidate.row),
      };
    })
    .filter((item) => item.include)
    .sort((a, b) => b.score - a.score || b.row.similarity - a.row.similarity);

  return ranked.slice(0, Math.max(1, options.limit)).map((item) => item.row);
}
