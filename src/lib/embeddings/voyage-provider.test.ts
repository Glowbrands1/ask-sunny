import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { EmbeddingError } from "./types";
import { VoyageEmbeddingProvider } from "./voyage-provider";

/** The network layer is mocked. Nothing here reaches Voyage. */
function vector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i + seed) / 10000);
}

function okResponse(count: number, offset = 0): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, (_, i) => ({
        index: i,
        embedding: vector(offset + i),
      })),
      usage: { total_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VOYAGE_API_KEY = "test-key-not-a-real-credential";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("VoyageEmbeddingProvider", () => {
  it("reports its model and dimension from central configuration", () => {
    const provider = new VoyageEmbeddingProvider();
    expect(provider.model).toBe(EMBEDDING_MODEL);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("reports configured state without throwing", () => {
    expect(new VoyageEmbeddingProvider().configured).toBe(true);
    delete process.env.VOYAGE_API_KEY;
    expect(new VoyageEmbeddingProvider().configured).toBe(false);
  });

  it("names VOYAGE_API_KEY when the credential is absent", async () => {
    delete process.env.VOYAGE_API_KEY;
    const provider = new VoyageEmbeddingProvider(vi.fn());

    const error = await provider.embedQuery("anything").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingConfigurationError);
    expect((error as MissingConfigurationError).missing).toEqual(["VOYAGE_API_KEY"]);
  });

  it("uses input_type document for documents and query for questions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(1));
    const provider = new VoyageEmbeddingProvider(fetchMock);

    await provider.embedDocuments(["a policy paragraph"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).input_type).toBe("document");

    fetchMock.mockResolvedValue(okResponse(1));
    await provider.embedQuery("what is the policy?");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).input_type).toBe("query");
  });

  it("sends the configured model and output dimension", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(1));
    await new VoyageEmbeddingProvider(fetchMock).embedDocuments(["x"]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe(EMBEDDING_MODEL);
    expect(body.output_dimension).toBe(EMBEDDING_DIMENSIONS);
  });

  it("batches large document sets rather than sending one giant request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: { body: string }) =>
        Promise.resolve(okResponse(JSON.parse(init.body).input.length)),
      );

    const vectors = await new VoyageEmbeddingProvider(fetchMock).embedDocuments(
      Array.from({ length: 300 }, (_, i) => `chunk ${i}`),
    );

    expect(vectors).toHaveLength(300);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1].body).input.length).toBeLessThanOrEqual(128);
    }
  });

  it("returns vectors in input order even when the service reorders them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: vector(100) },
            { index: 0, embedding: vector(0) },
          ],
        }),
        { status: 200 },
      ),
    );

    const [first] = await new VoyageEmbeddingProvider(fetchMock).embedDocuments(["a", "b"]);
    expect(first![0]).toBe(vector(0)[0]);
  });

  it("rejects a vector of the wrong width instead of writing it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }), {
        status: 200,
      }),
    );

    await expect(
      new VoyageEmbeddingProvider(fetchMock).embedDocuments(["x"]),
    ).rejects.toThrow(/2-dimension vectors, but the database expects/);
  });

  it("rejects a response with the wrong number of vectors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(1));
    await expect(
      new VoyageEmbeddingProvider(fetchMock).embedDocuments(["a", "b"]),
    ).rejects.toThrow(/unexpected number of vectors/);
  });

  it("degrades honestly on an HTTP error, without leaking the response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("secret document text echoed back", { status: 400 }));

    const error = await new VoyageEmbeddingProvider(fetchMock)
      .embedDocuments(["x"])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toContain("HTTP 400");
    expect((error as Error).message).not.toContain("secret document text");
  });

  it("surfaces a rate limit as a rate limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    const error = await new VoyageEmbeddingProvider(fetchMock)
      .embedQuery("x")
      .catch((e: unknown) => e);
    expect((error as EmbeddingError).status).toBe(429);
  });

  it("degrades honestly when the service cannot be reached", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const error = await new VoyageEmbeddingProvider(fetchMock)
      .embedQuery("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as EmbeddingError).status).toBe(503);
  });

  it("never sends the API key anywhere but the Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(1));
    await new VoyageEmbeddingProvider(fetchMock).embedDocuments(["x"]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("test-key-not-a-real-credential");
    expect(init.body).not.toContain("test-key-not-a-real-credential");
    expect(init.headers.authorization).toBe("Bearer test-key-not-a-real-credential");
  });

  it("does no work for an empty batch", async () => {
    const fetchMock = vi.fn();
    expect(await new VoyageEmbeddingProvider(fetchMock).embedDocuments([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
