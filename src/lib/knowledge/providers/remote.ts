import type { KnowledgeDocument, SearchResult, SourceCitation } from "@/types";
import type { KnowledgeProvider, KnowledgeQuery } from "../types";

/**
 * The KnowledgeProvider the BROWSER uses in live mode.
 *
 * It holds no Supabase client, no key and no model name — it is a thin client
 * for the server-side routes, which is what keeps infrastructure out of the UI
 * bundle. Same interface as LocalKnowledgeProvider, so the Knowledge Base
 * screen and the citation plumbing are unchanged.
 */
export class RemoteKnowledgeProvider implements KnowledgeProvider {
  readonly name = "Ask Sunny knowledge service";

  private lastCitations: SourceCitation[] = [];

  async search(query: KnowledgeQuery): Promise<SearchResult[]> {
    const response = await fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
    });

    const payload = (await response.json()) as {
      results?: SearchResult[];
      citations?: SourceCitation[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Knowledge search is unavailable.");
    }

    this.lastCitations = payload.citations ?? [];
    return payload.results ?? [];
  }

  /**
   * Citations are built server-side from the retrieved rows and returned
   * alongside the results, so the browser never reconstructs one.
   */
  toCitations(results: SearchResult[]): SourceCitation[] {
    const wanted = new Set(results.map((result) => result.documentId));
    return this.lastCitations.filter((citation) => wanted.has(citation.documentId));
  }

  async listDocuments(): Promise<KnowledgeDocument[]> {
    const response = await fetch("/api/knowledge/documents");
    const payload = (await response.json()) as {
      documents?: KnowledgeDocument[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "The knowledge library is unavailable.");
    }
    return payload.documents ?? [];
  }
}
