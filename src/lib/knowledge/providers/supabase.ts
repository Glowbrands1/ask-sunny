import "server-only";

import { EMBEDDING_DIMENSIONS, RETRIEVAL } from "@/lib/config/models";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { KnowledgeDocument, SearchResult, SourceCitation } from "@/types";
import {
  rowToCitation,
  rowToDocument,
  rowToSearchResult,
  type KnowledgeDocumentRow,
  type MatchedChunkRow,
} from "../mappers";
import type { KnowledgeProvider, KnowledgeQuery } from "../types";

/**
 * The real retriever: pgvector similarity search over ingested chunks.
 *
 * Server-side only — it holds a service-role client. The browser reaches it
 * through /api/knowledge/*, never directly.
 *
 * `toCitations` is unchanged in spirit from LocalKnowledgeProvider: results in,
 * source cards out. The source-card UI does not know which retriever ran.
 */
export class SupabaseKnowledgeProvider implements KnowledgeProvider {
  readonly name = "Supabase pgvector retrieval";

  /** Last raw match rows, so a caller can build citations without re-querying. */
  private lastRows: MatchedChunkRow[] = [];

  async search(query: KnowledgeQuery): Promise<SearchResult[]> {
    const rows = await this.match(query);
    return rows.map(rowToSearchResult);
  }

  /**
   * Retrieval that keeps the full row, including category and similarity, so
   * citations are built from database values rather than reconstructed.
   */
  async match(query: KnowledgeQuery): Promise<MatchedChunkRow[]> {
    const trimmed = query.query.trim();
    if (!trimmed) return [];

    const embeddings = getEmbeddingProvider();
    if (embeddings.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        "The configured embedding model does not match the database vector width.",
      );
    }

    const queryEmbedding = await embeddings.embedQuery(trimmed);

    const { data, error } = await getSupabaseAdmin().rpc("match_knowledge_chunks", {
      query_embedding: queryEmbedding,
      scope_id: query.scopeId,
      match_count: query.limit ?? RETRIEVAL.topK,
      min_similarity: RETRIEVAL.minSimilarity,
      filter_categories: query.categories?.length ? query.categories : null,
    });

    if (error) {
      // The Supabase error can carry the query payload; only the message is
      // kept, and the question text is never re-logged here.
      throw new Error(`Knowledge retrieval failed: ${error.message}`);
    }

    this.lastRows = (data ?? []) as MatchedChunkRow[];
    return this.lastRows;
  }

  toCitations(results: SearchResult[]): SourceCitation[] {
    const byChunkId = new Map(this.lastRows.map((row) => [row.chunk_id, row]));
    return results
      .map((result) => byChunkId.get(result.chunkId))
      .filter((row): row is MatchedChunkRow => Boolean(row))
      .map(rowToCitation);
  }

  async listDocuments(scopeId?: string): Promise<KnowledgeDocument[]> {
    let builder = getSupabaseAdmin()
      .from("knowledge_documents")
      .select("*")
      .order("updated_at", { ascending: false });

    if (scopeId) builder = builder.eq("knowledge_scope_id", scopeId);

    const { data, error } = await builder;
    if (error) throw new Error(`Could not list knowledge documents: ${error.message}`);

    return ((data ?? []) as KnowledgeDocumentRow[]).map(rowToDocument);
  }
}
