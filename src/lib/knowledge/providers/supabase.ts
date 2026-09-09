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
import {
  resolveRoleDocument,
  selectMandatoryChunks,
  toRoleGroundingRow,
  type KnowledgeDocumentRole,
} from "../document-roles";
import type { KnowledgeProvider, KnowledgeQuery } from "../types";

/** The document columns needed to resolve a role and shape a citation. */
interface RoleDocumentRow {
  id: string;
  title: string;
  category: string;
  original_filename: string;
  tags: string[] | null;
  version: number;
}

/** The chunk columns needed to pin a section and render it as grounding. */
interface RoleChunkRow {
  id: string;
  chunk_index: number;
  locator: string;
  page: number | null;
  section: string | null;
  content: string;
}

/** What a resolved role contributes to one turn. */
export interface RoleGrounding {
  readonly role: KnowledgeDocumentRole;
  readonly documentId: string;
  readonly documentTitle: string;
  /** `tag` once the durable marker is set; `fallback` until then. */
  readonly matchedBy: "tag" | "fallback";
  /** The pinned rows, in document order, shaped exactly like retrieved rows. */
  readonly rows: MatchedChunkRow[];
}

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

  /**
   * The mandatory chunks for a document ROLE, read straight from the tables.
   *
   * NOT A VECTOR QUERY. There is no query embedding here and no similarity
   * ordering, because the whole point of a role is that inclusion does not
   * depend on the question's wording. What makes the result deterministic is
   * `selectMandatoryChunks`: the role names the sections, the database returns
   * them in the document's own order, and the same question always produces the
   * same pinned set.
   *
   * THE SAME VISIBILITY RULES AS RETRIEVAL, deliberately mirrored from
   * `match_knowledge_chunks`: the document must be indexed, its status must be
   * `indexed`, and the chunk version must equal the document version. Skipping
   * that last one would let a superseded chunk from an earlier upload be pinned
   * as mandatory policy — the one place stale text would be guaranteed to
   * appear rather than merely likely to.
   *
   * Returns null when the corpus holds no document for this role, which is a
   * normal state: a fresh environment, a corpus that has not had the framework
   * uploaded, or a second brand. The caller must carry on and answer without it
   * rather than fail.
   */
  async fetchRoleGrounding(
    role: KnowledgeDocumentRole,
    scopeId: string,
  ): Promise<RoleGrounding | null> {
    const client = getSupabaseAdmin();

    const { data: documentData, error: documentError } = await client
      .from("knowledge_documents")
      .select("id, title, category, original_filename, tags, version")
      .eq("knowledge_scope_id", scopeId)
      .eq("indexed", true)
      .eq("status", "indexed");

    if (documentError) {
      throw new Error(`Could not resolve role documents: ${documentError.message}`);
    }

    const documents = (documentData ?? []) as RoleDocumentRow[];
    const resolved = resolveRoleDocument(documents, role);
    if (!resolved) return null;

    const document = resolved.document as RoleDocumentRow;

    const { data: chunkData, error: chunkError } = await client
      .from("knowledge_chunks")
      .select("id, chunk_index, locator, page, section, content")
      .eq("document_id", document.id)
      .eq("version", document.version)
      .order("chunk_index", { ascending: true });

    if (chunkError) {
      throw new Error(`Could not read role document chunks: ${chunkError.message}`);
    }

    const selected = selectMandatoryChunks(
      (chunkData ?? []) as RoleChunkRow[],
      role,
    );

    return {
      role,
      documentId: document.id,
      documentTitle: document.title,
      matchedBy: resolved.matchedBy,
      rows: selected.map((chunk) => toRoleGroundingRow(document, chunk)),
    };
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
