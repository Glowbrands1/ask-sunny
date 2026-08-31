import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MAX_BATCH, EMBEDDING_MODEL } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { EmbeddingError } from "./types";
import { EMBEDDING_FUNCTION_NAME, SupabaseEmbeddingProvider } from "./supabase-provider";

/**
 * The embedding provider is the seam between the app and the Edge Function.
 * Every case here runs against an injected `fetch`, so the suite never touches
 * the network and never needs a Supabase project.
 */

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SECRET_ENV = "SUPABASE_SECRET_KEY";
const LEGACY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

/** Assembled at runtime so a credential-shaped literal is never committed. */
const fakeSecret = ["sb", "secret", "TESTFIXTURE"].join("_");

const original = { ...process.env };

function vector(width: number = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: width }, (_, i) => i / width);
}

function ok(embeddings: number[][], model: string = EMBEDDING_MODEL): Response {
  return new Response(
    JSON.stringify({ model, dimensions: EMBEDDING_DIMENSIONS, embeddings }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  process.env[URL_ENV] = "https://example-project.supabase.co";
  process.env[SECRET_ENV] = fakeSecret;
  delete process.env[LEGACY_ENV];
});

afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});

describe("SupabaseEmbeddingProvider", () => {
  it("reports the configured model and width from the single source of truth", () => {
    const provider = new SupabaseEmbeddingProvider(vi.fn());
    expect(provider.model).toBe(EMBEDDING_MODEL);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(provider.name).toBe("Supabase Edge Functions");
  });

  it("is unconfigured when Supabase is, without throwing to say so", () => {
    delete process.env[SECRET_ENV];
    expect(new SupabaseEmbeddingProvider(vi.fn()).configured).toBe(false);

    process.env[SECRET_ENV] = fakeSecret;
    expect(new SupabaseEmbeddingProvider(vi.fn()).configured).toBe(true);
  });

  it("accepts the legacy service-role variable as the credential", () => {
    delete process.env[SECRET_ENV];
    process.env[LEGACY_ENV] = fakeSecret;
    expect(new SupabaseEmbeddingProvider(vi.fn()).configured).toBe(true);
  });

  it("throws MissingConfigurationError naming variables, never values", async () => {
    delete process.env[SECRET_ENV];
    const fetchImpl = vi.fn();
    const provider = new SupabaseEmbeddingProvider(fetchImpl);

    const error = await provider.embedQuery("anything").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MissingConfigurationError);
    expect((error as MissingConfigurationError).missing).toEqual([SECRET_ENV]);
    // Nothing was sent: an unconfigured provider must not make a request.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the deployed function on the configured project", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([vector()]));
    await new SupabaseEmbeddingProvider(fetchImpl).embedQuery("how much PTO?");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      `https://example-project.supabase.co/functions/v1/${EMBEDDING_FUNCTION_NAME}`,
    );
    expect((init as RequestInit).method).toBe("POST");
  });

  it("tolerates a project URL with a trailing slash", async () => {
    process.env[URL_ENV] = "https://example-project.supabase.co/";
    const fetchImpl = vi.fn().mockResolvedValue(ok([vector()]));
    await new SupabaseEmbeddingProvider(fetchImpl).embedQuery("q");

    expect(fetchImpl.mock.calls[0]![0]).toBe(
      `https://example-project.supabase.co/functions/v1/${EMBEDDING_FUNCTION_NAME}`,
    );
  });

  it("sends the credential in both headers Supabase's gateway expects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([vector()]));
    await new SupabaseEmbeddingProvider(fetchImpl).embedQuery("q");

    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.apikey).toBe(fakeSecret);
    expect(headers.authorization).toBe(`Bearer ${fakeSecret}`);
  });

  it("returns vectors in input order", async () => {
    const a = vector();
    const b = vector().map((n) => n + 1);
    const fetchImpl = vi.fn().mockResolvedValue(ok([a, b]));

    const out = await new SupabaseEmbeddingProvider(fetchImpl).embedDocuments(["a", "b"]);

    expect(out).toEqual([a, b]);
  });

  it("makes no request at all for an empty document list", async () => {
    const fetchImpl = vi.fn();
    await expect(
      new SupabaseEmbeddingProvider(fetchImpl).embedDocuments([]),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("splits a large document into batches the function will accept", async () => {
    const count = EMBEDDING_MAX_BATCH * 2 + 1;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const { inputs } = JSON.parse(String(init.body)) as { inputs: string[] };
      expect(inputs.length).toBeLessThanOrEqual(EMBEDDING_MAX_BATCH);
      return Promise.resolve(ok(inputs.map(() => vector())));
    });

    const out = await new SupabaseEmbeddingProvider(fetchImpl).embedDocuments(
      Array.from({ length: count }, (_, i) => `chunk ${i}`),
    );

    expect(out).toHaveLength(count);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("embeds documents and questions through an identical request shape", async () => {
    /*
     * THE RETRIEVAL INVARIANT. A stored chunk and the question asked against it
     * must land in the same vector space. gte-small is symmetric and the
     * provider sends no document/query mode, so the two requests differ only in
     * their text. If a mode flag is ever introduced, this test fails and forces
     * the model to be recorded per row before it can ship.
     */
    // A fresh Response per call: a body can only be read once.
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(ok([vector()])));
    const provider = new SupabaseEmbeddingProvider(fetchImpl);

    await provider.embedDocuments(["the same text"]);
    await provider.embedQuery("the same text");

    const [docUrl, docInit] = fetchImpl.mock.calls[0]!;
    const [queryUrl, queryInit] = fetchImpl.mock.calls[1]!;

    expect(queryUrl).toBe(docUrl);
    expect((queryInit as RequestInit).body).toBe((docInit as RequestInit).body);
    expect((queryInit as RequestInit).headers).toEqual((docInit as RequestInit).headers);
  });

  it("rejects a vector of the wrong width rather than storing it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([vector(EMBEDDING_DIMENSIONS - 1)]));

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedQuery("q")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toContain(String(EMBEDDING_DIMENSIONS));
  });

  it("refuses a response from a different model than the app is configured for", async () => {
    // A function redeployed with another model would return valid vectors of a
    // plausible width. Retrieval would keep working and keep being wrong.
    const fetchImpl = vi.fn().mockResolvedValue(ok([vector()], "some-other-model"));

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedQuery("q")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toContain("some-other-model");
    expect((error as Error).message).toContain(EMBEDDING_MODEL);
  });

  it("rejects a response with the wrong number of vectors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([vector()]));

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedDocuments(["a", "b"])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingError);
  });

  it("says the function is not deployed when the project returns 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("Not Found", { status: 404 }));

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedQuery("q")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toContain(EMBEDDING_FUNCTION_NAME);
  });

  it("surfaces rate limiting as a retryable 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 429 }));

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedQuery("q")
      .catch((e: unknown) => e);

    expect((error as EmbeddingError).status).toBe(429);
  });

  it("reports an unreachable service as 503 without inventing a vector", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedQuery("q")
      .catch((e: unknown) => e);

    expect((error as EmbeddingError).status).toBe(503);
  });

  it("never puts the credential or the document text in an error message", async () => {
    const secretText = "Confidential commission structure for Q4.";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: `rejected: ${secretText}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await new SupabaseEmbeddingProvider(fetchImpl)
      .embedDocuments([secretText])
      .catch((e: unknown) => e);

    const message = (error as Error).message;
    expect(message).not.toContain(secretText);
    expect(message).not.toContain(fakeSecret);
  });
});
