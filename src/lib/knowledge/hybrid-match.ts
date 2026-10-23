import "server-only";

import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { EMBEDDING_DIMENSIONS, RETRIEVAL } from "@/lib/config/models";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { MatchedChunkRow } from "./mappers";
import { selectHybridMatches, type HybridCandidate } from "./hybrid-rank";

/**
 * Keyword + vector retrieval through match_knowledge_chunks_hybrid.
 *
 * Called only when HYBRID_SEARCH_ENABLED is on. The existing
 * match_knowledge_chunks path is unchanged. Similarity on each row is the
 * cosine the database computed, including rows the keyword or section leg
 * rescued from below the vector floor.
 */

interface HybridRpcRow extends MatchedChunkRow {
  vector_rank: number | null;
  keyword_rank: number | null;
  section_exact: boolean | null;
}

function toCandidate(row: HybridRpcRow): HybridCandidate {
  return {
    row: {
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      document_title: row.document_title,
      category: row.category,
      locator: row.locator,
      page: row.page,
      section: row.section,
      content: row.content,
      similarity: Number(row.similarity),
    },
    vectorRank: row.vector_rank === null || row.vector_rank === undefined ? null : Number(row.vector_rank),
    keywordRank: row.keyword_rank === null || row.keyword_rank === undefined ? null : Number(row.keyword_rank),
    sectionExact: Boolean(row.section_exact),
  };
}

export async function matchHybridKnowledge(input: {
  readonly query: string;
  readonly scopeId: string;
  readonly limit?: number;
  readonly categories?: readonly string[] | null;
}): Promise<MatchedChunkRow[]> {
  const trimmed = input.query.trim();
  if (!trimmed) return [];

  const embeddings = getEmbeddingProvider();
  if (embeddings.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error("The configured embedding model does not match the database vector width.");
  }

  const queryEmbedding = await embeddings.embedQuery(trimmed);
  const keywordQuery = expandGlossaryQuery(trimmed);
  const limit = input.limit ?? RETRIEVAL.topK;
  const { data, error } = await getSupabaseAdmin().rpc("match_knowledge_chunks_hybrid", {
    query_embedding: queryEmbedding,
    query_text: keywordQuery,
    scope_id: input.scopeId,
    match_count: Math.min(50, Math.max(limit, 20)),
    min_similarity: RETRIEVAL.minSimilarity,
    filter_categories: input.categories?.length ? [...input.categories] : null,
  });

  if (error) {
    throw new Error(`Knowledge retrieval failed: ${error.message}`);
  }

  const rows = (data ?? []) as HybridRpcRow[];
  return selectHybridMatches(rows.map((row) => toCandidate(row)), keywordQuery, {
    vectorFloor: RETRIEVAL.minSimilarity,
    limit,
  });
}
