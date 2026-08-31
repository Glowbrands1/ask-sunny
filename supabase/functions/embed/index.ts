import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Ask Sunny — embedding generation.
 *
 * Runs the `gte-small` sentence-transformer natively inside the Supabase Edge
 * Runtime (`Supabase.ai.Session`). There is no external embedding vendor and no
 * API key: the model ships with the runtime, so the only credential involved is
 * the Supabase key the caller already holds.
 *
 * ONE MODEL, ONE CODE PATH. Documents and questions are embedded by the same
 * `embed()` call below with identical options. There is deliberately no
 * document/query mode switch: `gte-small` is a symmetric model, and a mode flag
 * would create the possibility of chunks and queries landing in different
 * vector spaces — which does not fail loudly, it just quietly stops retrieving.
 *
 * PRIVACY. Input text is document content. It is never logged, never echoed
 * into an error message, and never persisted here. Failures report a category
 * and a count, never a body.
 */

/** The only model the Supabase Edge Runtime currently exposes. */
const MODEL = "gte-small";

/**
 * gte-small's output width. Asserted against every vector below rather than
 * assumed: the pgvector column is `vector(384)`, and a runtime upgrade that
 * changed this must fail here, loudly, rather than at insert time.
 */
const DIMENSIONS = 384;

/**
 * Inputs accepted per request. Bounded because each one is a separate model
 * inference and the function has a wall-clock budget. The ingestion pipeline
 * batches to the same number (EMBEDDING_MAX_BATCH in src/lib/config/models.ts),
 * and a test keeps the two in step.
 */
const MAX_INPUTS = 16;

/**
 * Per-input character ceiling. An abuse bound, not a quality one — gte-small
 * truncates at 512 tokens regardless, and the chunker is sized to stay under
 * that.
 */
const MAX_INPUT_CHARS = 8_000;

const session = new Supabase.ai.Session(MODEL);

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return fail(405, "This function accepts POST only.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "The request body must be JSON.");
  }

  const inputs = (body as { inputs?: unknown } | null)?.inputs;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return fail(400, "`inputs` must be a non-empty array of strings.");
  }
  if (inputs.length > MAX_INPUTS) {
    return fail(
      400,
      `The inputs array accepts at most ${MAX_INPUTS} strings per request; received ${inputs.length}.`,
    );
  }

  const texts: string[] = [];
  for (const value of inputs) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return fail(400, "Every entry in `inputs` must be a non-empty string.");
    }
    if (value.length > MAX_INPUT_CHARS) {
      // Length only. The text itself is never surfaced.
      return fail(413, `Each input must be at most ${MAX_INPUT_CHARS} characters.`);
    }
    texts.push(value);
  }

  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += 1) {
    let vector: unknown;
    try {
      vector = await session.run(texts[index], { mean_pool: true, normalize: true });
    } catch (error) {
      console.error(
        `embed: inference failed for input ${index} of ${texts.length}:`,
        error instanceof Error ? error.message : "unknown error",
      );
      return fail(502, "The embedding model failed to run.");
    }

    if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
      const width = Array.isArray(vector) ? vector.length : 0;
      return fail(
        500,
        `${MODEL} returned a ${width}-dimension vector; ${DIMENSIONS} was expected.`,
      );
    }

    embeddings.push(vector as number[]);
  }

  return new Response(
    JSON.stringify({ model: MODEL, dimensions: DIMENSIONS, embeddings }),
    { headers: { "Content-Type": "application/json" } },
  );
});
