import { LocalKnowledgeProvider } from "./providers/local";
import type { KnowledgeProvider } from "./types";

export * from "./types";
export { LocalKnowledgeProvider } from "./providers/local";
export { SharePointKnowledgeProvider } from "./providers/sharepoint";

/**
 * FUTURE INGESTION PIPELINE — architecture only, deliberately not built.
 *
 *   uploaded document
 *        │
 *        ├─▶ text extraction        (pdf-parse / mammoth / sheetjs / plain text)
 *        ├─▶ chunking               (~800 tokens, ~15% overlap, keep page/section
 *        │                           labels so citations stay precise)
 *        ├─▶ embeddings             (an embedding model, batched)
 *        ├─▶ vector storage         (pgvector on Supabase, or a managed vector DB)
 *        │
 *        └─▶ retrieval at question time
 *                 └─▶ top-k chunks + their document/locator metadata
 *                          └─▶ sent to Claude as grounding context
 *                                   └─▶ answer + SourceCitation[] rendered as
 *                                       source cards (already built)
 *
 * Nothing above exists in this phase. `LocalKnowledgeProvider` stands in with
 * keyword scoring over seeded chunks, and the citation plumbing it feeds is the
 * real plumbing — so replacing it does not touch the UI.
 */
let cached: LocalKnowledgeProvider | null = null;

export function getKnowledgeProvider(): LocalKnowledgeProvider {
  if (!cached) {
    cached = new LocalKnowledgeProvider();
  }
  return cached;
}

export type { KnowledgeProvider };
