import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

/**
 * Order the guaranteed candidates.
 *
 * The repository had no reranker. This is the pick RETRIEVAL_RECALL_ENABLED
 * adds. A named section stays even when the model omits its id. A failed
 * model call keeps the fused order.
 */

export function applyRerank(
  rows: readonly MatchedChunkRow[],
  orderedIds: readonly string[] | null,
  pinnedIds: readonly string[],
): MatchedChunkRow[] {
  if (orderedIds === null) return [...rows];
  const byId = new Map(rows.map((row) => [row.chunk_id, row]));
  const pinned = new Set(pinnedIds);
  const seen = new Set<string>();
  const ordered: MatchedChunkRow[] = [];
  for (const id of pinnedIds) {
    const row = byId.get(id);
    if (!row || seen.has(id)) continue;
    ordered.push(row);
    seen.add(id);
  }
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    const row = byId.get(id);
    if (!row || pinned.has(id)) continue;
    ordered.push(row);
    seen.add(id);
  }
  return ordered;
}
