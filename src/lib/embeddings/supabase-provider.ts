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
import { EmbeddingError, type EmbeddingProvider } from "./types";

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

  /** `fetchImpl` is injectable so tests exercise this class without a network. */
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  get configured(): boolean {
    return (
      Boolean(process.env[SUPABASE_URL_ENV]?.trim()) && supabaseSecretKeyConfigured()
    );
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_MAX_BATCH) {
      out.push(...(await this.embed(texts.slice(start, start + EMBEDDING_MAX_BATCH))));
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    if (!vector) {
      throw new EmbeddingError("The embedding service returned no vector for the question.");
    }
    return vector;
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
