/**
 * EMBEDDING ABSTRACTION
 * ---------------------------------------------------------------------------
 * Anthropic does not provide an embedding model, so retrieval needs a separate
 * one. Nothing outside `lib/embeddings` names which: the ingestion pipeline and
 * the retrieval path both talk to this interface, so replacing the backend is
 * one module and one config constant. It has already been replaced once — an
 * external vendor gave way to a model running inside Supabase's Edge Runtime —
 * without a line changing anywhere else.
 *
 * Document and query embeddings stay separate methods even though the current
 * model is symmetric. Many retrieval models embed the two asymmetrically, and
 * an interface that cannot express the difference would force the next backend
 * to either lose recall or leak its own concepts upward.
 */
export interface EmbeddingProvider {
  readonly name: string;
  /** The model id embeddings are produced with. Stored alongside each vector. */
  readonly model: string;
  /** Vector width. Must match the pgvector column the migrations declare. */
  readonly dimensions: number;
  /** False when no credential is configured. Never throws to report this. */
  readonly configured: boolean;

  /** Batched. Returns one vector per input, in input order. */
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export class EmbeddingError extends Error {
  readonly status: number;

  constructor(message: string, status = 502, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingError";
    this.status = status;
  }
}

/**
 * Supabase's status for an Edge Function worker that exhausted its resource
 * budget: WORKER_RESOURCE_LIMIT. Not in any HTTP registry — it is Supabase's
 * own, which is why it needs naming here rather than being matched as a number
 * at a call site.
 */
export const WORKER_RESOURCE_LIMIT_STATUS = 546;

/**
 * ============================================================================
 * THE ONE EMBEDDING FAILURE THAT SMALLER WORK CAN FIX
 * ============================================================================
 *
 * A worker that ran out of CPU did not reject the request — it ran out of room
 * to finish it. The same inputs, sent fewer at a time, succeed. That makes this
 * categorically different from every other embedding failure, all of which
 * repeat identically however the caller slices them:
 *
 *   404 — the function is not deployed. Smaller batches will 404 too.
 *   429 — rate limited. Smaller batches mean MORE requests, which is worse.
 *   401/403 — the credential is wrong. Retrying is pointless and noisy.
 *   dimension / model / count mismatch — the deployment disagrees with the
 *     app about what it produces. Splitting hides a drift that must be seen.
 *
 * So this is its own class rather than a status code inspected at the call
 * site: `instanceof` is what stops a future edit from accidentally retrying an
 * authentication failure sixteen times.
 */
export class EmbeddingResourceLimitError extends EmbeddingError {
  constructor(message: string, options?: { cause?: unknown }) {
    // 502, not 546: the app's own callers get an upstream-failure status, and
    // Supabase's private code does not leak into this app's HTTP surface.
    super(message, 502, options);
    this.name = "EmbeddingResourceLimitError";
  }
}
