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
