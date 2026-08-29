import type { KnowledgeDocument, SearchResult, SourceCitation } from "@/types";
import type { KnowledgeProvider, KnowledgeQuery } from "../types";

/**
 * SHAREPOINT KNOWLEDGE PROVIDER — STUB. NOT IMPLEMENTED.
 *
 * This file exists to prove the seam, not to pretend the integration works.
 * Every method throws. Nothing here calls Microsoft Graph, and no credentials
 * are read, stored, or referenced.
 *
 * WHEN THIS IS BUILT
 * ------------------
 * 1. Register an application in Microsoft Entra ID with `Sites.Selected` (or
 *    narrower) Graph permission, granted only on the approved document library.
 * 2. Store the tenant id, client id and secret as server-side environment
 *    variables. They are never exposed to the browser.
 * 3. `listDocuments()` calls Graph to enumerate the approved library, mapping
 *    each file to a KnowledgeDocument with `source: "sharepoint"`.
 * 4. A scheduled sync (or a Graph change-notification webhook) detects changed
 *    files and re-runs the ingestion pipeline for those documents only:
 *       download -> extract text -> chunk -> embed -> upsert to the vector store
 * 5. `search()` delegates to the same vector store the upload path writes to,
 *    so a SharePoint-sourced document and an uploaded one are indistinguishable
 *    at retrieval time.
 * 6. `toCitations()` needs no change — it is already the mapping from retrieval
 *    result to source card.
 *
 * Important scoping note carried over from discovery: the intended corpus is a
 * focused set (~56 documents), not an entire document library. Sync must be
 * pointed at an approved subset, not at everything.
 */
export class SharePointKnowledgeProvider implements KnowledgeProvider {
  readonly name = "Microsoft SharePoint (not connected)";

  private notImplemented(): never {
    throw new Error(
      "SharePointKnowledgeProvider is not implemented in this phase. " +
        "Connect SharePoint from the Integrations screen once Microsoft Graph access is available.",
    );
  }

  async search(_query: KnowledgeQuery): Promise<SearchResult[]> {
    void _query;
    return this.notImplemented();
  }

  toCitations(_results: SearchResult[]): SourceCitation[] {
    void _results;
    return this.notImplemented();
  }

  async listDocuments(): Promise<KnowledgeDocument[]> {
    return this.notImplemented();
  }
}
