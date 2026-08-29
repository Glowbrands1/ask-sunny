import { isDemoMode } from "@/lib/config/runtime";
import { LocalKnowledgeProvider } from "./providers/local";
import { RemoteKnowledgeProvider } from "./providers/remote";
import type { KnowledgeProvider } from "./types";

export * from "./types";
export * from "./mappers";
export { LocalKnowledgeProvider } from "./providers/local";
export { RemoteKnowledgeProvider } from "./providers/remote";
export { SharePointKnowledgeProvider } from "./providers/sharepoint";

/**
 * KNOWLEDGE PROVIDER SELECTION — centralized, mode-aware.
 *
 * demo -> LocalKnowledgeProvider: keyword scoring over the seeded corpus. No
 *         Supabase, no embeddings, no network. This is what keeps the demo
 *         working with zero services configured.
 *
 * live -> RemoteKnowledgeProvider: a thin client for /api/knowledge/*, which
 *         runs SupabaseKnowledgeProvider server-side (pgvector similarity).
 *
 * There is no third path and no fallback edge between them. If live mode is on
 * and the service is misconfigured, the request fails with the missing variable
 * names — it does not quietly become a demo answer.
 *
 * SupabaseKnowledgeProvider is intentionally NOT imported here: it is
 * server-only, and pulling it into this module would drag a service-role client
 * into the browser bundle graph. Server code imports it directly.
 */
let cached: KnowledgeProvider | null = null;
let localCached: LocalKnowledgeProvider | null = null;

export function getKnowledgeProvider(): KnowledgeProvider {
  cached ??= isDemoMode() ? getLocalKnowledgeProvider() : new RemoteKnowledgeProvider();
  return cached;
}

/**
 * The seeded-corpus provider specifically.
 *
 * Two callers need the concrete class rather than the interface: the app store
 * (`setDocuments`, to keep mock retrieval aware of uploads) and MockAIProvider
 * (`citationsForChunkIds`, for the canned answers). Both are demo-only
 * concerns, which is exactly why they ask for the demo provider by name.
 */
export function getLocalKnowledgeProvider(): LocalKnowledgeProvider {
  localCached ??= new LocalKnowledgeProvider();
  return localCached;
}

/** Honest label for the Integrations screen. Never claims a live connection. */
export function knowledgeProviderStatus() {
  const demo = isDemoMode();
  return {
    name: demo ? "Seeded demo knowledge" : "Supabase pgvector retrieval",
    live: !demo,
    detail: demo
      ? "Retrieval scores a seeded demo corpus by keyword overlap. No vector database is connected."
      : "Questions are embedded and matched against indexed company documents.",
  };
}

export type { KnowledgeProvider };
