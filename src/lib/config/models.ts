/**
 * MODEL + PIPELINE CONFIGURATION — the single source of truth.
 *
 * Model names, embedding dimensions and chunking parameters are declared here
 * and nowhere else. No component, route or provider hardcodes a model id.
 *
 * This module is safe to import from client code: it contains configuration,
 * never credentials. Secrets live in `server-env.ts`, which is server-only.
 */

/* ------------------------------------------------------------------ Claude */

/**
 * The answering model. Changing this line changes every Claude call in the app.
 * Overridable per-deployment with ANTHROPIC_MODEL (server-only) so a rollback
 * does not need a code change.
 */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/**
 * Reasoning effort for grounded answers. Ask Sunny is a question-answering
 * surface over retrieved text rather than an open-ended reasoning task, and
 * managers are waiting on the response, so the default trades the top of the
 * range for latency. Raise to "high" if answer quality proves insufficient.
 */
export const CLAUDE_EFFORT = (process.env.ANTHROPIC_EFFORT ||
  "medium") as "low" | "medium" | "high" | "xhigh" | "max";

/** Output ceiling per answer mode. Detailed answers need the most room. */
export const CLAUDE_MAX_TOKENS: Record<"quick" | "standard" | "detailed", number> = {
  quick: 1024,
  standard: 2048,
  detailed: 4096,
};

/* -------------------------------------------------------------- Embeddings */

/**
 * Embedding models this codebase knows how to use.
 *
 * `gte-small` runs natively inside the Supabase Edge Runtime — there is no
 * embedding vendor, no API key and no third-party network hop. The model is
 * invoked by the `embed` Edge Function in supabase/functions/embed/index.ts.
 *
 * `dimensions` is the model's fixed output width, not a width this app
 * requests: gte-small emits 384 floats and offers no truncation setting.
 *
 * The dimension is NOT guessed anywhere: the pgvector column width in
 * `supabase/migrations` must equal EMBEDDING_DIMENSIONS below, and a test
 * (`src/lib/config/embedding-dimensions.test.ts`) parses the SQL and enforces
 * it. Changing the model to one with a different width therefore REQUIRES a new
 * migration and a re-embed of every chunk — see `supabase/README.md`.
 *
 * `maxBatch` is how many inputs one Edge Function call accepts. Each input is a
 * separate model inference sharing one request's wall-clock budget, so it is
 * deliberately small; the same test asserts it matches MAX_INPUTS in the
 * function source.
 */
export const EMBEDDING_MODELS = {
  "gte-small": { dimensions: 384, maxBatch: 16 },
} as const;

export type EmbeddingModelName = keyof typeof EMBEDDING_MODELS;

/**
 * The retrieval model. Documents and queries both use this — the same model on
 * both sides is what makes a similarity score mean anything.
 */
export const EMBEDDING_MODEL: EmbeddingModelName = "gte-small";

export const EMBEDDING_DIMENSIONS = EMBEDDING_MODELS[EMBEDDING_MODEL].dimensions;
export const EMBEDDING_MAX_BATCH = EMBEDDING_MODELS[EMBEDDING_MODEL].maxBatch;

/**
 * The input ceiling gte-small enforces. Text beyond this is silently truncated
 * by the model, so the chunker below is sized to stay inside it.
 */
export const EMBEDDING_MAX_INPUT_TOKENS = 512;

/**
 * The dimension the shipped migrations declare for `knowledge_chunks.embedding`.
 *
 * Hand-maintained and therefore test-enforced: the suite reads the migrations
 * in order and fails if the width they end at disagrees with this number. A
 * drift here would produce vectors the index cannot search.
 */
export const MIGRATED_EMBEDDING_DIMENSIONS = 384;

/* ---------------------------------------------------------------- Chunking */

/**
 * Chunk sizes are bounded by the embedding model, not by taste.
 *
 * gte-small truncates its input at EMBEDDING_MAX_INPUT_TOKENS (512) and says
 * nothing when it does. A chunk larger than that would be stored with an
 * embedding computed from only its opening — the vector would look fine, the
 * row would insert fine, and retrieval would quietly miss anything the tail of
 * the chunk actually said. So the target sits well below the ceiling: the
 * chunker's characters-per-token estimate is an approximation, and the margin
 * absorbs text that tokenises more densely than English prose.
 */
export const CHUNKING = {
  /** Target chunk size. Comfortably inside gte-small's 512-token input limit. */
  targetTokens: 400,
  /** Hard ceiling before a chunk is force-split. Still under the model limit. */
  maxTokens: 450,
  /**
   * Chunks below this are merged with the following segment rather than stored
   * on their own — a two-line page makes a useless retrieval unit.
   */
  minTokens: 80,
  /** ~12% of the target, inside the requested 10-15% band. */
  overlapTokens: 48,
  /** Deterministic characters-per-token estimate used by the chunker. */
  charsPerToken: 4,
} as const;

/* ---------------------------------------------------------------- Retrieval */

export const RETRIEVAL = {
  /**
   * Chunks fetched from the vector index per question. Raised alongside the
   * smaller chunk size above so the grounding context still covers a
   * comparable amount of source text.
   */
  topK: 14,
  /** Chunks actually placed in the grounding context. */
  contextChunks: 12,
  /**
   * Cosine similarity below which a chunk is not considered supporting
   * evidence. When nothing clears this bar Sunny says the knowledge base does
   * not cover the question instead of answering from general knowledge.
   */
  minSimilarity: 0.35,
} as const;

/* ------------------------------------------------------------ File uploads */

export const UPLOAD_LIMITS = {
  /** Server-enforced. The client dialog shows the same number. */
  maxBytes: 50 * 1024 * 1024,
  minBytes: 1,
} as const;
