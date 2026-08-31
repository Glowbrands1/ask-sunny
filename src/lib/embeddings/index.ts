import "server-only";

import { SupabaseEmbeddingProvider } from "./supabase-provider";
import type { EmbeddingProvider } from "./types";

export * from "./types";
export {
  SupabaseEmbeddingProvider,
  EMBEDDING_FUNCTION_NAME,
} from "./supabase-provider";

/**
 * The single place an embedding backend is chosen.
 *
 * There is deliberately no mock fallback. Embeddings only exist on the live
 * path, and a stand-in that returned plausible-looking vectors would produce
 * plausible-looking retrieval over nothing. When Supabase is not configured the
 * caller gets MissingConfigurationError naming the variables it needs.
 *
 * Swapping backends is this one line plus a new class implementing
 * EmbeddingProvider — nothing outside `lib/embeddings` names the backend. A
 * replacement with a different vector width also needs a migration; the
 * dimension invariant test says so out loud.
 */
let cached: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  cached ??= new SupabaseEmbeddingProvider();
  return cached;
}

/** Test seam — resets the singleton between cases. */
export function __setEmbeddingProvider(provider: EmbeddingProvider | null): void {
  cached = provider;
}
