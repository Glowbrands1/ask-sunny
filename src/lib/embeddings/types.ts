/**
 * EMBEDDING ABSTRACTION
 * ---------------------------------------------------------------------------
 * Anthropic does not provide an embedding model, so retrieval needs a second
 * vendor. Nothing outside `lib/embeddings` names that vendor: the ingestion
 * pipeline and the retrieval path both talk to this interface, so replacing
 * Voyage with another provider is one module and one config constant.
 *
 * Document and query embeddings are separate methods on purpose — Voyage (and
 * most current retrieval models) embed the two asymmetrically, and calling the
 * wrong one measurably degrades recall.
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
