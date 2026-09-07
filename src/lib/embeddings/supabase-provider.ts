import "server-only";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_BATCH,
  EMBEDDING_MODEL,
} from "@/lib/config/models";
import {
  MissingConfigurationError,
  SUPABASE_SECRET_KEY_ENV,
  SUPABASE_URL_ENV,
  supabaseSecretKey,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  EmbeddingError,
  EmbeddingResourceLimitError,
  WORKER_RESOURCE_LIMIT_STATUS,
  type EmbeddingProvider,
} from "./types";

/**
 * Embeddings from the project's own Supabase Edge Function.
 *
 * The model (`gte-small`) runs inside the Supabase Edge Runtime, so there is no
 * embedding vendor, no separate account and no extra API key: the credentials
 * are the Supabase ones the app already needs. The function's source is in
 * `supabase/functions/embed/index.ts`.
 *
 * Deliberately `fetch` rather than `supabase-js`'s `functions.invoke`: invoke
 * flattens non-2xx responses into a generic FunctionsHttpError and makes the
 * status awkward to recover, and this call needs the status to distinguish "not
 * configured" from "rate limited" from "the model failed". One POST does not
 * justify losing that.
 *
 * The secret key is read at call time, never stored on the instance, never
 * logged and never interpolated into an error message.
 */

/** Deployed function name. Must match `supabase functions deploy <name>`. */
export const EMBEDDING_FUNCTION_NAME = "embed";

interface EmbedFunctionResponse {
  model?: string;
  dimensions?: number;
  embeddings?: number[][];
  error?: string;
}

export class SupabaseEmbeddingProvider implements EmbeddingProvider {
  readonly name = "Supabase Edge Functions";
  readonly model = EMBEDDING_MODEL;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private readonly fetchImpl: typeof fetch;
  private readonly maxBatch: number;

  /**
   * `fetchImpl` is injectable so tests exercise this class without a network,
   * and `maxBatch` for the same reason: the subdivision below is a property of
   * the batch SIZE, and a suite that could only ever observe it at the one
   * configured number would stop describing the behaviour the moment that
   * number changed.
   */
  constructor(fetchImpl: typeof fetch = fetch, maxBatch: number = EMBEDDING_MAX_BATCH) {
    this.fetchImpl = fetchImpl;
    this.maxBatch = Math.max(1, Math.floor(maxBatch));
  }

  get configured(): boolean {
    return (
      Boolean(process.env[SUPABASE_URL_ENV]?.trim()) && supabaseSecretKeyConfigured()
    );
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += this.maxBatch) {
      out.push(...(await this.embedAdaptive(texts.slice(start, start + this.maxBatch))));
    }
    /*
     * ONE VECTOR PER INPUT, IN INPUT ORDER, OR NOTHING. Every path below either
     * returns a full batch or throws, and the subdivision concatenates head
     * before tail, so `out[i]` is the vector for `texts[i]` — which is the
     * assumption the pipeline makes when it zips these against its chunks.
     * A dropped or reordered chunk would attach one passage's meaning to
     * another passage's citation, and nothing downstream could detect it.
     */
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    let vector: number[] | undefined;
    try {
      [vector] = await this.embed([text]);
    } catch (error) {
      if (error instanceof EmbeddingResourceLimitError) {
        // Nothing to subdivide: one question is already the smallest request
        // there is. Said plainly rather than dressed up as a retryable state.
        throw new EmbeddingResourceLimitError(
          "The embedding service ran out of capacity while reading the question. Try asking again in a moment.",
          { cause: error },
        );
      }
      throw error;
    }

    if (!vector) {
      throw new EmbeddingError("The embedding service returned no vector for the question.");
    }
    return vector;
  }

  /**
   * ==========================================================================
   * A BATCH THE WORKER CANNOT FINISH IS SPLIT, NOT ABANDONED
   * ==========================================================================
   *
   * THE FAILURE THIS EXISTS FOR. A 58-page PDF produced batches of 16 chunks;
   * the first one exhausted the Edge Function worker's CPU budget mid-loop and
   * came back HTTP 546. `embedDocuments` threw, the pipeline marked the
   * document failed, and a manager was told "the embedding service rejected the
   * request" about work that was merely too large to do in one go.
   *
   * A resource limit is the one embedding failure that carries its own remedy:
   * the same inputs, fewer at a time, succeed. So the batch halves and both
   * halves are retried. A half that still cannot finish halves again.
   *
   * WHY THIS TERMINATES, which matters more than that it retries. Every
   * recursion strictly shortens the input list, and a list of one does not
   * recurse — it throws. So the depth is bounded by log2(batch) and the total
   * requests for a batch of n by 2n-1, with no counter to get wrong and no way
   * to loop. At the configured batch of 4 the pathological case is 7 requests.
   *
   * WHY IT ONLY EVER SPLITS ON 546. Every other failure is deterministic in the
   * inputs — a 404 is a 404 at any size, a 429 gets worse with more requests,
   * and a dimension mismatch means the deployment has drifted and must be seen
   * rather than worked around. `EmbeddingResourceLimitError` is a distinct class
   * precisely so this test cannot widen by accident.
   *
   * NOTHING IS DROPPED, EVER. There is no partial success: a half that fails
   * after its sibling succeeded still throws, so the document fails whole. A
   * chunk silently missing its vector would be a hole in the index that
   * retrieval cannot see and nobody would be told about.
   */
  private async embedAdaptive(inputs: string[]): Promise<number[][]> {
    try {
      return await this.embed(inputs);
    } catch (error) {
      if (!(error instanceof EmbeddingResourceLimitError)) throw error;

      if (inputs.length <= 1) {
        /*
         * FAIL HONESTLY. One passage, on its own, still could not be embedded.
         * There is nothing smaller to try, so this stops rather than retrying a
         * request that has already been shown not to fit — and says so, instead
         * of reporting a bare status code the reader cannot act on.
         */
        throw new EmbeddingResourceLimitError(
          "The document could not be indexed: the embedding worker reached its processing limit on a single passage, even after retrying in smaller batches. Nothing was indexed. A document this dense may need to be split into smaller files.",
          { cause: error },
        );
      }

      const mid = Math.ceil(inputs.length / 2);
      // Head before tail, awaited in order. Sequential rather than parallel:
      // the worker just told us it is out of capacity, and two concurrent
      // halves would ask it for more at exactly the wrong moment.
      const head = await this.embedAdaptive(inputs.slice(0, mid));
      const tail = await this.embedAdaptive(inputs.slice(mid));
      return [...head, ...tail];
    }
  }

  /**
   * THE SINGLE EMBEDDING CALL.
   *
   * Both `embedDocuments` and `embedQuery` route through here, with the same
   * request shape and no mode parameter, because gte-small is symmetric. That
   * is not a simplification — it is the guarantee that a stored chunk and the
   * question asked against it live in the same vector space. An asymmetric
   * model would need a mode flag here AND the flag recorded per row; until one
   * is introduced, having no flag is what makes the mismatch unrepresentable.
   */
  private async embed(inputs: string[]): Promise<number[][]> {
    const url = process.env[SUPABASE_URL_ENV]?.trim();
    const missing: string[] = [];
    if (!url) missing.push(SUPABASE_URL_ENV);
    if (!supabaseSecretKeyConfigured()) missing.push(SUPABASE_SECRET_KEY_ENV);
    if (missing.length > 0) throw new MissingConfigurationError(missing);

    const key = supabaseSecretKey();
    const endpoint = `${url!.replace(/\/+$/, "")}/functions/v1/${EMBEDDING_FUNCTION_NAME}`;

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Supabase's gateway wants the key in both places: `apikey` routes
          // the request, `Authorization` satisfies the function's JWT check.
          apikey: key,
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ inputs }),
      });
    } catch (error) {
      throw new EmbeddingError(
        "The embedding service could not be reached.",
        503,
        { cause: error },
      );
    }

    if (!response.ok) {
      /*
       * 546 IS NOT A REJECTION, WHICH IS WHY IT IS NOT REPORTED AS ONE. It is
       * Supabase's WORKER_RESOURCE_LIMIT: the worker ran out of budget part-way
       * through the batch. The request was well-formed and the credential was
       * fine, so `embedAdaptive` above halves the work and tries again.
       *
       * The count is named because it is the actionable fact and it is not
       * document content. The response body is still never read — it can echo
       * the inputs, which are the document itself.
       */
      if (response.status === WORKER_RESOURCE_LIMIT_STATUS) {
        throw new EmbeddingResourceLimitError(
          `The embedding worker reached its processing limit on a batch of ${inputs.length}.`,
        );
      }

      // The body can echo request content; only the status is surfaced so
      // document text never reaches a log line.
      throw new EmbeddingError(
        response.status === 404
          ? `The "${EMBEDDING_FUNCTION_NAME}" Edge Function is not deployed to this Supabase project.`
          : `The embedding service rejected the request (HTTP ${response.status}).`,
        response.status === 429 ? 429 : 502,
      );
    }

    let payload: EmbedFunctionResponse;
    try {
      payload = (await response.json()) as EmbedFunctionResponse;
    } catch (error) {
      throw new EmbeddingError(
        "The embedding service returned a response that was not JSON.",
        502,
        { cause: error },
      );
    }

    // A deployed function running a different model than the app believes is
    // configured is exactly the silent-drift failure this whole file guards
    // against: the vectors would be valid, the width would match, and
    // retrieval would return confident nonsense.
    if (payload.model && payload.model !== this.model) {
      throw new EmbeddingError(
        `The embedding service is running "${payload.model}", but this deployment is configured for "${this.model}". Redeploy the ${EMBEDDING_FUNCTION_NAME} function.`,
      );
    }

    const rows = payload.embeddings;
    if (!Array.isArray(rows) || rows.length !== inputs.length) {
      throw new EmbeddingError(
        "The embedding service returned an unexpected number of vectors.",
      );
    }

    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== this.dimensions) {
        throw new EmbeddingError(
          `The embedding service returned ${Array.isArray(row) ? row.length : 0}-dimension vectors, but the database expects ${this.dimensions}.`,
        );
      }
    }

    return rows;
  }
}
