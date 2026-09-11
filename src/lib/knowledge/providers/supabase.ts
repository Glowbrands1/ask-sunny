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
  type KnowledgeDocumentRole,
} from "../document-roles";
import {
  resolvePolicyManual,
  type ManualChunk,
} from "@/lib/forms/official-policy-manual";
import {
  buildRoleGrounding,
  roleIdentityFailure,
  type RoleGroundingResult,
} from "../role-grounding";
import type { KnowledgeProvider, KnowledgeQuery } from "../types";

/** The manual's rows, or why none could be cited. */
export type OfficialPolicyManualResult =
  | {
      readonly ok: true;
      readonly documentId: string;
      readonly documentTitle: string;
      readonly matchedBy: "tag" | "fallback";
      readonly chunks: readonly ManualChunk[];
    }
  | { readonly ok: false; readonly reason: string };

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
   * The mandatory grounding for a document ROLE, read straight from the tables.
   *
   * NOT A VECTOR QUERY. There is no query embedding here and no similarity
   * ordering, because the whole point of a role is that inclusion does not
   * depend on the question's wording.
   *
   * THE SAME VISIBILITY RULES AS RETRIEVAL, deliberately mirrored from
   * `match_knowledge_chunks`: the document must be indexed, its status must be
   * `indexed`, and the chunk version must equal the document version. Skipping
   * that last one would let a superseded chunk from an earlier upload be pinned
   * as mandatory policy — the one place stale text would be guaranteed to
   * appear rather than merely likely to.
   *
   * NEVER RETURNS NULL AND NEVER THROWS PAST ITS CONTRACT. Every outcome is a
   * `RoleGroundingResult`, so a caller cannot accidentally treat "the framework
   * could not be read" as "no framework was wanted". Query errors are caught
   * HERE and translated into failure codes, because a Supabase error can echo
   * the request payload — which carries the manager's question and company
   * policy text — and none of that may travel further.
   */
  /**
   * ==========================================================================
   * THE OFFICIAL POLICY MANUAL, PINNED BY IDENTITY
   * ==========================================================================
   *
   * A Corrective Action Form cites one document, and the business named it:
   * "for corrective action please refer always to this". So it is resolved the
   * way the frameworks are — by tag, with the filename and title as a fallback
   * — and its chunks are fetched WHOLE rather than retrieved.
   *
   * NO SIMILARITY IS INVOLVED, deliberately. The blank citations that prompted
   * this came from a semantic search gated at the threshold the open-ended chat
   * path uses: a manager writing "she was wearing slippers today" does not
   * write in the manual's vocabulary, so the one document the form needs did
   * not clear a bar tuned for a different job. Identity does not have that
   * failure mode.
   *
   * WHAT IS RETURNED IS ROWS, not a citation. Which section the ticked offense
   * points at, and what the reference then reads, is decided by
   * `lib/forms/official-policy-manual.ts` — which is pure, so the decision is
   * testable against the manual's own text.
   */
  async fetchOfficialPolicyManual(
    scopeId: string,
  ): Promise<OfficialPolicyManualResult> {
    const client = getSupabaseAdmin();

    let documents: RoleDocumentRow[];
    try {
      const { data, error } = await client
        .from("knowledge_documents")
        .select("id, title, category, original_filename, tags, version")
        .eq("knowledge_scope_id", scopeId)
        .eq("indexed", true)
        .eq("status", "indexed");

      if (error) throw new Error(error.message);
      documents = (data ?? []) as RoleDocumentRow[];
    } catch {
      return { ok: false, reason: "The official policy manual could not be looked up." };
    }

    const resolution = resolvePolicyManual(documents);
    if (!resolution.ok) {
      return {
        ok: false,
        reason:
          resolution.problem === "ambiguous"
            ? "More than one document claims to be the official policy manual, so none was cited."
            : "The official policy manual is not in the knowledge base, so no policy was cited.",
      };
    }

    const document = resolution.document as RoleDocumentRow;

    let chunks: RoleChunkRow[];
    try {
      const { data, error } = await client
        .from("knowledge_chunks")
        .select("id, chunk_index, locator, page, section, content")
        .eq("document_id", document.id)
        .eq("version", document.version)
        .order("chunk_index", { ascending: true });

      if (error) throw new Error(error.message);
      chunks = (data ?? []) as RoleChunkRow[];
    } catch {
      return { ok: false, reason: `The sections of "${document.title}" could not be read.` };
    }

    return {
      ok: true,
      documentId: document.id,
      documentTitle: document.title,
      matchedBy: resolution.matchedBy,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.chunk_index,
        page: chunk.page,
        content: chunk.content,
        /*
         * The heading ingestion read off the sheet. Null on anything indexed
         * before PDF extraction learned to recognise one, which the section
         * lookup handles by reading the chunk's own lines instead.
         */
        section: chunk.section,
      })),
    };
  }

  async fetchRoleGrounding(
    role: KnowledgeDocumentRole,
    scopeId: string,
  ): Promise<RoleGroundingResult> {
    const client = getSupabaseAdmin();

    let documents: RoleDocumentRow[];
    try {
      const { data, error } = await client
        .from("knowledge_documents")
        .select("id, title, category, original_filename, tags, version")
        .eq("knowledge_scope_id", scopeId)
        .eq("indexed", true)
        .eq("status", "indexed");

      if (error) throw new Error(error.message);
      documents = (data ?? []) as RoleDocumentRow[];
    } catch {
      return {
        ok: false,
        failure: {
          code: "role_document_query_failed",
          detail: `The knowledge document lookup for the ${role.id} role did not complete.`,
        },
      };
    }

    const resolution = resolveRoleDocument(documents, role);
    if (!resolution.ok) {
      return {
        ok: false,
        failure: roleIdentityFailure(role, resolution.problem, resolution.candidates),
      };
    }

    const document = resolution.document as RoleDocumentRow;

    let chunks: RoleChunkRow[];
    try {
      const { data, error } = await client
        .from("knowledge_chunks")
        .select("id, chunk_index, locator, page, section, content")
        .eq("document_id", document.id)
        .eq("version", document.version)
        .order("chunk_index", { ascending: true });

      if (error) throw new Error(error.message);
      chunks = (data ?? []) as RoleChunkRow[];
    } catch {
      return {
        ok: false,
        failure: {
          code: "role_chunk_query_failed",
          detail: `The chunk lookup for "${document.title}" did not complete.`,
        },
      };
    }

    return buildRoleGrounding({
      role,
      document,
      matchedBy: resolution.matchedBy,
      chunks,
    });
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
