import "server-only";

import { EMBEDDING_MAX_BATCH, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { EmbeddingError, type EmbeddingProvider } from "./types";

/**
 * Voyage AI embeddings over the REST API.
 *
 * Deliberately `fetch` rather than an SDK: the request is one POST with four
 * fields, and a dependency that has to be kept in step with the Next runtime
 * is not worth it for that. The key is read from process.env at call time and
 * never leaves this module — it is not returned, logged or embedded in an
 * error message.
 */

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

interface VoyageResponse {
  data?: { embedding: number[]; index: number }[];
  usage?: { total_tokens: number };
  detail?: string;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = "Voyage AI";
  readonly model = EMBEDDING_MODEL;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private readonly fetchImpl: typeof fetch;

  /** `fetchImpl` is injectable so tests exercise this class without a network. */
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  get configured(): boolean {
    return Boolean(process.env.VOYAGE_API_KEY?.trim());
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_MAX_BATCH) {
      const batch = texts.slice(start, start + EMBEDDING_MAX_BATCH);
      out.push(...(await this.embed(batch, "document")));
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], "query");
    if (!vector) {
      throw new EmbeddingError("The embedding service returned no vector for the question.");
    }
    return vector;
  }

  private async embed(
    input: string[],
    inputType: "document" | "query",
  ): Promise<number[][]> {
    const apiKey = process.env.VOYAGE_API_KEY?.trim();
    if (!apiKey) throw new MissingConfigurationError(["VOYAGE_API_KEY"]);

    let response: Response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input,
          input_type: inputType,
          output_dimension: this.dimensions,
          truncation: true,
        }),
      });
    } catch (error) {
      throw new EmbeddingError(
        "The embedding service could not be reached.",
        503,
        { cause: error },
      );
    }

    if (!response.ok) {
      // The response body can echo request content; only the status is
      // surfaced so document text never lands in a log line.
      throw new EmbeddingError(
        `The embedding service rejected the request (HTTP ${response.status}).`,
        response.status === 429 ? 429 : 502,
      );
    }

    const payload = (await response.json()) as VoyageResponse;
    const rows = payload.data;

    if (!Array.isArray(rows) || rows.length !== input.length) {
      throw new EmbeddingError(
        "The embedding service returned an unexpected number of vectors.",
      );
    }

    // Voyage returns an `index` per row; sort rather than trust arrival order.
    const ordered = [...rows].sort((a, b) => a.index - b.index);

    return ordered.map((row) => {
      if (!Array.isArray(row.embedding) || row.embedding.length !== this.dimensions) {
        throw new EmbeddingError(
          `The embedding service returned ${row.embedding?.length ?? 0}-dimension vectors, but the database expects ${this.dimensions}.`,
        );
      }
      return row.embedding;
    });
  }
}
