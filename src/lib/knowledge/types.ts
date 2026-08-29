import type {
  KnowledgeCategory,
  KnowledgeDocument,
  SearchResult,
  SourceCitation,
} from "@/types";

export interface KnowledgeQuery {
  query: string;
  /** Restrict retrieval to one brand's corpus (see BrandConfig). */
  scopeId: string;
  categories?: KnowledgeCategory[];
  limit?: number;
}

/**
 * KNOWLEDGE ABSTRACTION
 * ---------------------------------------------------------------------------
 * The contract chat uses to ground an answer. Today `LocalKnowledgeProvider`
 * satisfies it with keyword scoring over seeded chunks. Later a retrieval
 * service satisfies it with a real vector search — same method signatures, same
 * return types, so nothing in `features/chat/` changes.
 */
export interface KnowledgeProvider {
  readonly name: string;
  /** Retrieve the chunks most relevant to a question. */
  search(query: KnowledgeQuery): Promise<SearchResult[]>;
  /** Turn retrieval results into the citations rendered as source cards. */
  toCitations(results: SearchResult[]): SourceCitation[];
  /** The full document list backing the Knowledge Base screen. */
  listDocuments(): Promise<KnowledgeDocument[]>;
}

export type { SearchResult, SourceCitation, KnowledgeDocument };
