import "server-only";

import { VoyageEmbeddingProvider } from "./voyage-provider";
import type { EmbeddingProvider } from "./types";

export * from "./types";
export { VoyageEmbeddingProvider } from "./voyage-provider";

/**
 * The single place an embedding backend is chosen.
 *
 * There is deliberately no mock fallback. Embeddings only exist on the live
 * path, and a stand-in that returned plausible-looking vectors would produce
 * plausible-looking retrieval over nothing. When no key is configured the
 * caller gets MissingConfigurationError naming VOYAGE_API_KEY.
 */
let cached: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  cached ??= new VoyageEmbeddingProvider();
  return cached;
}

/** Test seam — resets the singleton between cases. */
export function __setEmbeddingProvider(provider: EmbeddingProvider | null): void {
  cached = provider;
}
