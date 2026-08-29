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
 * Voyage AI embedding models this codebase knows how to use, with the output
 * dimension each is configured to emit.
 *
 * The dimension is NOT guessed anywhere: the pgvector column width in
 * `supabase/migrations` is derived from EMBEDDING_DIMENSIONS below. Changing
 * the model to one with a different dimension therefore REQUIRES a new
 * migration — see `supabase/README.md`.
 */
export const EMBEDDING_MODELS = {
  "voyage-4-lite": { dimensions: 1024, maxBatch: 128 },
  "voyage-4": { dimensions: 1024, maxBatch: 128 },
  "voyage-3.5-lite": { dimensions: 1024, maxBatch: 128 },
} as const;

export type EmbeddingModelName = keyof typeof EMBEDDING_MODELS;

/** Economical retrieval model. Documents and queries both use this by default. */
export const EMBEDDING_MODEL: EmbeddingModelName = "voyage-4-lite";

export const EMBEDDING_DIMENSIONS = EMBEDDING_MODELS[EMBEDDING_MODEL].dimensions;
export const EMBEDDING_MAX_BATCH = EMBEDDING_MODELS[EMBEDDING_MODEL].maxBatch;

/** The dimension the shipped migrations declare for `knowledge_chunks.embedding`. */
export const MIGRATED_EMBEDDING_DIMENSIONS = 1024;

/* ---------------------------------------------------------------- Chunking */

export const CHUNKING = {
  /** Target chunk size. ~800 tokens is the sweet spot for policy prose. */
  targetTokens: 800,
  /** Hard ceiling before a chunk is force-split. */
  maxTokens: 1000,
  /**
   * Chunks below this are merged with the following segment rather than stored
   * on their own — a two-line page makes a useless retrieval unit.
   */
  minTokens: 120,
  /** ~12% of the target, inside the requested 10–15% band. */
  overlapTokens: 96,
  /** Deterministic characters-per-token estimate used by the chunker. */
  charsPerToken: 4,
} as const;

/* ---------------------------------------------------------------- Retrieval */

export const RETRIEVAL = {
  /** Chunks fetched from the vector index per question. */
  topK: 8,
  /** Chunks actually placed in the grounding context. */
  contextChunks: 6,
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
