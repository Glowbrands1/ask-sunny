import { RETRIEVAL } from "@/lib/config/models";

import { isPolicyManualChunk } from "./hybrid-rank";
import type { MatchedChunkRow } from "./mappers";

/**
 * The similarity floor does not choose an edition.
 *
 * `RETRIEVAL.minSimilarity` (0.78) was calibrated on three fictional sentences.
 * Once the knowledge base grew from about 1.3k chunks to about 13.4k, every
 * indexed copy of the JBA Policy Manual clears that floor, so the top of the
 * list is duplicate editions of the same section. `match_knowledge_chunks`
 * also clamps `match_count` to 50, so a later filter cannot see a chunk the
 * query never returned.
 *
 * This is the code-only narrower. It does not change 0.78, it does not write
 * a migration, and it does not delete chunks. Callers turn it on with
 * `CURRENT_MANUAL_SCOPE_ENABLED`. Off, they keep the rows they were given.
 *
 * A title year is the only edition signal on a match row (no filename). The
 * revision date ("Edited 10-2024", "Edited 5.2025") wins, then a year written
 * immediately before "JBA", then the only year in the title. Two copies of
 * that newest year both stay. Identical section text collapses to the nearer
 * row. A title with no year cannot be ranked and is dropped once any manual
 * row has a year. Rows that are not the policy manual are kept.
 *
 * `dedupeBySection` stays off unless the caller passes it
 * (`MANUAL_SECTION_DEDUPE_ENABLED`). On, one current-year chunk per section
 * heading remains, the nearest match. A chunk with no heading is still keyed
 * by its text. Document ids are not a keep-list.
 */

/** The clamp inside `match_knowledge_chunks`. Asking for more does not return more. */
export const MANUAL_SCOPE_FETCH = 50;

export function manualScopeFetchLimit(requested: number, enabled: boolean): number {
  if (!enabled) return requested;
  return Math.max(requested, MANUAL_SCOPE_FETCH);
}

/**
 * The edition year printed on a manual title, or null when the title has none.
 */
export function manualEditionYear(title: string): number | null {
  const edited = title.match(/\bedited\s+\d{1,2}\s*[.\-/]\s*(20\d{2})\b/i);
  if (edited) return Number(edited[1]);
  const beforeJba = [...title.matchAll(/\b(20\d{2})\s+jba\b/gi)];
  if (beforeJba.length > 0) return Number(beforeJba[beforeJba.length - 1]![1]);
  const years = [...title.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (years.length === 1) return years[0]!;
  return null;
}

function sectionKey(row: MatchedChunkRow, dedupeBySection: boolean): string {
  const section = (row.section ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const content = row.content.trim().toLowerCase().replace(/\s+/g, " ");
  if (dedupeBySection && section) return `section\0${section}`;
  return `${section}\0${content}`;
}

/**
 * Keep the current manual, collapse identical sections, and return at most
 * `limit` rows, nearest first.
 *
 * When `currentDocumentId` is among the manual rows, that document is the
 * current manual and other manual documents are dropped. Otherwise the newest
 * title year is the current edition.
 */
export function scopeToCurrentManual(
  rows: readonly MatchedChunkRow[],
  options: {
    readonly limit: number;
    readonly currentDocumentId?: string | null;
    /** One current-year chunk per section heading. Off, different text both stays. */
    readonly dedupeBySection?: boolean;
  },
): MatchedChunkRow[] {
  const manuals = rows.filter((row) => isPolicyManualChunk(row));
  const currentId = options.currentDocumentId?.trim() || null;
  const idPresent = currentId !== null && manuals.some((row) => row.document_id === currentId);
  const years = manuals.map((row) => manualEditionYear(row.document_title)).filter((year): year is number => year !== null);
  const maxYear = years.length > 0 ? Math.max(...years) : null;

  const keepManual = (row: MatchedChunkRow): boolean => {
    if (idPresent) return row.document_id === currentId;
    const year = manualEditionYear(row.document_title);
    if (maxYear === null) return true;
    return year === maxYear;
  };

  const narrowed = rows.filter((row) => !isPolicyManualChunk(row) || keepManual(row));
  const best = new Map<string, MatchedChunkRow>();
  for (const row of narrowed) {
    const key = isPolicyManualChunk(row) ? sectionKey(row, options.dedupeBySection === true) : `row\0${row.chunk_id}`;
    const existing = best.get(key);
    if (!existing || row.similarity > existing.similarity) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity || a.chunk_id.localeCompare(b.chunk_id)).slice(0, options.limit);
}

/** The floor this narrower refuses to retune. */
export const UNCHANGED_SIMILARITY_FLOOR = RETRIEVAL.minSimilarity;
