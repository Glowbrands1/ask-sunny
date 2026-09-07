import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MAX_BATCH, EMBEDDING_MODEL } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import {
  EmbeddingError,
  EmbeddingResourceLimitError,
  WORKER_RESOURCE_LIMIT_STATUS,
} from "./types";
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

/* ------------------------------------------------- a worker with a budget -- */

/** Inputs named so each one's vector can be traced back to it. */
function chunks(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `chunk ${index}`);
}

/** A vector that carries its input's ordinal, so order is checkable. */
function vectorFor(text: string): number[] {
  const out = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  out[0] = Number(text.replace(/\D/g, ""));
  return out;
}

/** Supabase's own WORKER_RESOURCE_LIMIT response. */
function resourceLimit(): Response {
  return new Response(JSON.stringify({ error: "WORKER_RESOURCE_LIMIT" }), {
    status: WORKER_RESOURCE_LIMIT_STATUS,
    headers: { "content-type": "application/json" },
  });
}

/**
 * An Edge Function worker that can finish `capacity` inferences per request and
 * exhausts its CPU budget above that — which is exactly what the live logs
 * recorded: `CPU Time exceeded`, a shutdown, and HTTP 546 for a batch of 16.
 *
 * `sizes` records the batch size of every request in order, so the subdivision
 * is asserted by the shape of the traffic rather than by counting calls.
 */
function worker(capacity: number) {
  const sizes: number[] = [];
  const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const { inputs } = JSON.parse(String(init.body)) as { inputs: string[] };
    sizes.push(inputs.length);
    return Promise.resolve(
      inputs.length > capacity ? resourceLimit() : ok(inputs.map(vectorFor)),
    );
  });
  return { fetchImpl, sizes };
}

/** The ordinals the returned vectors carry, in the order they came back. */
function ordinals(vectors: number[][]): number[] {
  return vectors.map((entry) => entry[0]!);
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

/**
 * ============================================================================
 * HTTP 546 — WORKER_RESOURCE_LIMIT
 * ============================================================================
 *
 * THE LIVE FAILURE THESE PIN. A 58-page PDF was uploaded to the Ask Sunny Dev
 * project and never indexed. Its first batch of 16 chunks came back 546; the
 * function's own logs recorded `sb_error_code: WORKER_RESOURCE_LIMIT` alongside
 * `CPU Time exceeded` and a worker shutdown, at 2357 ms and 2451 ms of
 * execution. One request per attempt, then the pipeline gave up.
 *
 * 546 is the ONLY embedding failure the caller can fix by doing less at once,
 * and these assert both halves of that: that it subdivides, and that nothing
 * else does.
 */
describe("a batch too large for the worker is subdivided, not abandoned", () => {
  it("halves a batch of 16 into 8 and 8", async () => {
    // The live shape: 16 inputs, a worker that can finish 8.
    const { fetchImpl, sizes } = worker(8);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 16);

    const out = await provider.embedDocuments(chunks(16));

    expect(sizes).toEqual([16, 8, 8]);
    expect(out).toHaveLength(16);
  });

  it("subdivides again when a half still cannot finish", async () => {
    // A worker that can only manage 3 forces the split to recurse.
    const { fetchImpl, sizes } = worker(3);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 16);

    const out = await provider.embedDocuments(chunks(16));

    // 16 fails, 8 fails, 4 fails, 2+2 succeed — then the same for each sibling.
    expect(sizes).toEqual([16, 8, 4, 2, 2, 4, 2, 2, 8, 4, 2, 2, 4, 2, 2]);
    expect(out).toHaveLength(16);
  });

  it("splits an odd batch deterministically, larger half first", async () => {
    const { fetchImpl, sizes } = worker(2);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 3);

    await provider.embedDocuments(chunks(3));

    expect(sizes).toEqual([3, 2, 1]);
  });

  it("keeps every chunk and keeps them in order", async () => {
    /*
     * THE PROPERTY THAT MATTERS MOST. The pipeline zips these vectors against
     * its chunks by position, so a dropped or reordered vector would attach one
     * passage's meaning to another passage's citation — a wrong answer with a
     * confident source card, undetectable downstream.
     */
    const { fetchImpl } = worker(1);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 4);

    const out = await provider.embedDocuments(chunks(10));

    expect(out).toHaveLength(10);
    expect(ordinals(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("bounds the work: never more than 2n-1 requests for a batch of n", async () => {
    // Termination is structural — each recursion strictly shortens the list and
    // a list of one does not recurse — so there is no counter to get wrong.
    const { fetchImpl, sizes } = worker(1);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 8);

    await provider.embedDocuments(chunks(8));

    expect(sizes.length).toBeLessThanOrEqual(2 * 8 - 1);
    expect(sizes.every((size) => size >= 1 && size <= 8)).toBe(true);
  });

  it("costs nothing extra when the worker copes", async () => {
    // The ordinary path is untouched: one request per batch, no retries.
    const { fetchImpl, sizes } = worker(Number.MAX_SAFE_INTEGER);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 4);

    const out = await provider.embedDocuments(chunks(10));

    expect(sizes).toEqual([4, 4, 2]);
    expect(ordinals(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("a single input that still fails is reported, not retried", () => {
  it("stops at one request rather than looping", async () => {
    // A worker with no capacity at all: every request is 546.
    const { fetchImpl, sizes } = worker(0);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 4);

    const error = await provider.embedDocuments(chunks(1)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingResourceLimitError);
    // Exactly one. Nothing smaller exists to try.
    expect(sizes).toEqual([1]);
  });

  it("gives up the whole batch once one passage cannot be embedded", async () => {
    const { fetchImpl, sizes } = worker(0);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 4);

    const error = await provider.embedDocuments(chunks(4)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingResourceLimitError);
    // Halved down to one, then stopped — the sibling halves are never attempted,
    // because a partial document must not be indexed.
    expect(sizes).toEqual([4, 2, 1]);
  });

  it("says what happened and what to do, not a bare status code", async () => {
    const { fetchImpl } = worker(0);
    const provider = new SupabaseEmbeddingProvider(fetchImpl, 4);

    const error = (await provider
      .embedDocuments(chunks(2))
      .catch((e: unknown) => e)) as Error;

    // The message a manager reads. "HTTP 546" is not a fact they can act on.
    expect(error.message).toContain("processing limit");
    expect(error.message).toContain("Nothing was indexed");
    expect(error.message).not.toContain("546");
  });

  it("never puts a chunk's text in the resource-limit message", async () => {
    const secretText = "Confidential commission structure for Q4.";
    const fetchImpl = vi.fn().mockResolvedValue(resourceLimit());

    const error = (await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments([secretText])
      .catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain(secretText);
    expect(error.message).not.toContain(fakeSecret);
  });

  it("tells a question asker something different from a document uploader", async () => {
    // `embedQuery` has nothing to subdivide, and "nothing was indexed" would be
    // meaningless to somebody who asked a question.
    const fetchImpl = vi.fn().mockResolvedValue(resourceLimit());

    const error = (await new SupabaseEmbeddingProvider(fetchImpl)
      .embedQuery("how much PTO?")
      .catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(EmbeddingResourceLimitError);
    expect(error.message).toContain("question");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("no other failure is ever retried as a resource limit", () => {
  /**
   * Each of these repeats identically however the inputs are sliced, so
   * subdividing would multiply the requests and change nothing — and for a
   * dimension or model mismatch it would actively hide a deployment drift that
   * has to be seen. One request each, and the original error.
   */
  const CASES: { name: string; response: () => Response }[] = [
    { name: "429 rate limiting", response: () => new Response("", { status: 429 }) },
    { name: "404 not deployed", response: () => new Response("Not Found", { status: 404 }) },
    { name: "401 bad credential", response: () => new Response("", { status: 401 }) },
    { name: "500 model failure", response: () => new Response("", { status: 500 }) },
  ];

  for (const { name, response } of CASES) {
    it(`does not subdivide on ${name}`, async () => {
      const sizes: number[] = [];
      const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        sizes.push((JSON.parse(String(init.body)) as { inputs: string[] }).inputs.length);
        return Promise.resolve(response());
      });

      const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
        .embedDocuments(chunks(4))
        .catch((e: unknown) => e);

      expect(sizes).toEqual([4]);
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error).not.toBeInstanceOf(EmbeddingResourceLimitError);
    });
  }

  it("keeps 429 a rate limit rather than folding it into 546", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 429 }));

    const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments(chunks(4))
      .catch((e: unknown) => e);

    // More requests is the wrong answer to being rate limited.
    expect((error as EmbeddingError).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still names the function when it is not deployed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));

    const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments(chunks(4))
      .catch((e: unknown) => e);

    expect((error as Error).message).toContain(EMBEDDING_FUNCTION_NAME);
  });

  it("does not subdivide a short vector count into agreement", async () => {
    // Two inputs, one vector back. Splitting would send two one-input requests
    // that each "succeed" and paper over a function returning the wrong shape.
    const sizes: number[] = [];
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sizes.push((JSON.parse(String(init.body)) as { inputs: string[] }).inputs.length);
      return Promise.resolve(ok([vector()]));
    });

    const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments(chunks(2))
      .catch((e: unknown) => e);

    expect(sizes).toEqual([2]);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error).not.toBeInstanceOf(EmbeddingResourceLimitError);
  });

  it("does not subdivide a wrong-width vector into acceptance", async () => {
    const sizes: number[] = [];
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const { inputs } = JSON.parse(String(init.body)) as { inputs: string[] };
      sizes.push(inputs.length);
      return Promise.resolve(ok(inputs.map(() => vector(EMBEDDING_DIMENSIONS - 1))));
    });

    const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments(chunks(4))
      .catch((e: unknown) => e);

    expect(sizes).toEqual([4]);
    expect((error as Error).message).toContain(String(EMBEDDING_DIMENSIONS));
    expect(error).not.toBeInstanceOf(EmbeddingResourceLimitError);
  });

  it("does not subdivide a model mismatch into acceptance", async () => {
    const sizes: number[] = [];
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const { inputs } = JSON.parse(String(init.body)) as { inputs: string[] };
      sizes.push(inputs.length);
      return Promise.resolve(ok(inputs.map(vectorFor), "some-other-model"));
    });

    const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments(chunks(4))
      .catch((e: unknown) => e);

    expect(sizes).toEqual([4]);
    expect((error as Error).message).toContain("some-other-model");
  });

  it("does not subdivide an unreachable service", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const error = await new SupabaseEmbeddingProvider(fetchImpl, 4)
      .embedDocuments(chunks(4))
      .catch((e: unknown) => e);

    expect((error as EmbeddingError).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("the configured batch size fits the worker that failed", () => {
  it("sends fewer inputs per request than the batch that exhausted it", () => {
    /*
     * The live 546 was a batch of 16 on a worker that manages roughly 11-15
     * gte-small inferences per request. This is not a style preference: 16 sat
     * on top of that ceiling, so the failure was total rather than occasional.
     */
    expect(EMBEDDING_MAX_BATCH).toBeLessThan(16);
    expect(EMBEDDING_MAX_BATCH).toBeGreaterThan(0);
  });
});
