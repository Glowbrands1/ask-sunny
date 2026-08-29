import {
  DEMO_KNOWLEDGE_CHUNKS,
  DEMO_KNOWLEDGE_DOCUMENTS,
} from "@/data/demo/knowledge";
import type { KnowledgeDocument, SearchResult, SourceCitation } from "@/types";
import type { KnowledgeProvider, KnowledgeQuery } from "../types";

/**
 * Mock retrieval over the seeded corpus.
 *
 * Scoring is deliberately simple keyword overlap — enough for realistic demo
 * answers, and obviously not a real retriever. It exists so the citation and
 * source-card plumbing is real and exercised.
 *
 * FUTURE — this is the class a real retriever replaces:
 *   1. Ingestion produces KnowledgeChunk records with embeddings.
 *   2. `search()` embeds the question and runs a vector similarity query.
 *   3. `toCitations()` is unchanged — it already maps results to source cards.
 * See `docs` in `src/lib/ai/index.ts` for how retrieval feeds Claude.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for",
  "with", "is", "are", "was", "were", "be", "been", "do", "does", "did", "how",
  "what", "when", "where", "who", "why", "should", "would", "could", "can",
  "my", "our", "your", "their", "this", "that", "these", "those", "i", "we",
  "you", "it", "at", "by", "from", "about", "as", "so", "me", "help", "please",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export class LocalKnowledgeProvider implements KnowledgeProvider {
  readonly name = "Seeded demo knowledge (mock retrieval)";

  private documents: KnowledgeDocument[];

  constructor(documents: KnowledgeDocument[] = DEMO_KNOWLEDGE_DOCUMENTS) {
    this.documents = documents;
  }

  /** Lets the UI hand in uploaded documents alongside the seeded corpus. */
  setDocuments(documents: KnowledgeDocument[]) {
    this.documents = documents;
  }

  async search(query: KnowledgeQuery): Promise<SearchResult[]> {
    const tokens = tokenize(query.query);
    if (tokens.length === 0) return [];

    const byId = new Map(this.documents.map((doc) => [doc.id, doc]));

    const scored = DEMO_KNOWLEDGE_CHUNKS.map((chunk) => {
      const document = byId.get(chunk.documentId);
      if (!document) return null;
      if (query.categories?.length && !query.categories.includes(document.category)) {
        return null;
      }

      const haystack = `${document.title} ${document.tags.join(" ")} ${chunk.content}`.toLowerCase();
      let score = 0;
      tokens.forEach((token) => {
        if (document.title.toLowerCase().includes(token)) score += 3;
        if (document.tags.some((tag) => tag.includes(token))) score += 2;
        if (haystack.includes(token)) score += 1;
      });
      if (score === 0) return null;

      return {
        chunkId: chunk.id,
        documentId: document.id,
        documentTitle: document.title,
        locator: chunk.locator,
        content: chunk.content,
        score: score / (tokens.length * 4),
      } satisfies SearchResult;
    }).filter((entry): entry is SearchResult => entry !== null);

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit ?? 4);
  }

  toCitations(results: SearchResult[]): SourceCitation[] {
    const byId = new Map(this.documents.map((doc) => [doc.id, doc]));
    return results.map((result) => {
      const document = byId.get(result.documentId);
      return {
        documentId: result.documentId,
        documentTitle: result.documentTitle,
        locator: result.locator,
        category: document?.category ?? "other",
        excerpt: result.content,
        relevance: Math.min(1, Math.max(0.35, result.score)),
      } satisfies SourceCitation;
    });
  }

  async listDocuments(): Promise<KnowledgeDocument[]> {
    return this.documents;
  }

  /** Direct chunk lookup used by the canned answers in the mock AI provider. */
  citationsForChunkIds(chunkIds: string[]): SourceCitation[] {
    const byId = new Map(this.documents.map((doc) => [doc.id, doc]));
    return chunkIds
      .map((chunkId) => DEMO_KNOWLEDGE_CHUNKS.find((chunk) => chunk.id === chunkId))
      .filter((chunk): chunk is (typeof DEMO_KNOWLEDGE_CHUNKS)[number] => Boolean(chunk))
      .map((chunk, index) => {
        const document = byId.get(chunk.documentId);
        return {
          documentId: chunk.documentId,
          documentTitle: document?.title ?? "Knowledge document",
          locator: chunk.locator,
          category: document?.category ?? "other",
          excerpt: chunk.content,
          relevance: Math.max(0.52, 0.94 - index * 0.11),
        } satisfies SourceCitation;
      });
  }
}
