import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __setRateLimiter, InMemoryRateLimiter } from "@/lib/api/rate-limit";
import {
  SUPABASE_SECRET_KEY_ENV,
  SUPABASE_URL_ENV,
} from "@/lib/config/server-env";
import { REVIEW_SYNC_SECRET_ENV } from "@/lib/reviews/sync-credential";
import { __setSupabaseAdmin } from "@/lib/supabase/server";

import { GET, POST } from "./route";

/**
 * THE GOOGLE REVIEW INGESTION ROUTE.
 *
 * Exercised as a real `Request`, because what is being tested is ORDERING —
 * and ordering is a property of the handler rather than of the modules it
 * calls. Specifically: an unauthenticated caller must reach neither the body
 * parser nor the database, whatever the route answers afterwards. A route that
 * refuses correctly but parses half a megabyte of JSON first is still a route
 * an unauthorised caller can make work.
 *
 * Every token and review below is invented.
 */

/* 24+ characters, which is the configured minimum. Invented. */
const TOKEN = "fixture-review-sync-token-not-a-real-secret";
const URL = "https://ask-sunny.example.supabase.co";
const SECRET_KEY = "sb_secret_fixture_value_not_a_real_key";

const REVIEW = {
  externalReviewId: "FIXTURE-ROUTE-000001",
  storeCode: "306",
  reviewerName: "Tamsin Vale",
  rating: 4,
  reviewText: "Fixture comment, long enough to read as a comment.",
  relativeDateText: "2 days ago",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://ask-sunny.example/api/reviews/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function authorised(body: unknown): Request {
  return post(body, { authorization: `Bearer ${TOKEN}` });
}

/**
 * Records whether the database was reached at all.
 *
 * `from(...)` serves the anchor read that precedes every write; `rpc` is the
 * write itself, and it is the one the ordering tests watch. An unauthorised
 * caller must reach NEITHER.
 */
function watchDatabase(anchors: Record<string, string | null> = { "306": "FIXTURE-ANCHOR-01" }) {
  const rows = Object.entries(anchors).map(([store_code, anchor]) => ({
    store_code,
    counted_through_external_review_id: anchor,
  }));

  const rpc = vi.fn(async () => ({
    data: {
      runId: "00000000-0000-4000-8000-000000000001",
      received: 1,
      created: 1,
      updated: 0,
      duplicates: 0,
      ignoredNonStc: 0,
      invalid: 0,
      countedIntoPeriod: 1,
      storedAsHistorical: 0,
      problems: [],
    },
    error: null,
  }));

  const from = vi.fn(() => ({
    select: () => ({ in: async () => ({ data: rows, error: null }) }),
  }));

  __setSupabaseAdmin({ rpc, from } as unknown as SupabaseClient);
  return rpc;
}

beforeEach(() => {
  /* A fresh limiter per test, so one test's refusals do not spend another's. */
  __setRateLimiter(new InMemoryRateLimiter());
  vi.stubEnv(REVIEW_SYNC_SECRET_ENV, TOKEN);
  vi.stubEnv(SUPABASE_URL_ENV, URL);
  vi.stubEnv(SUPABASE_SECRET_KEY_ENV, SECRET_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __setSupabaseAdmin(null);
  __setRateLimiter(new InMemoryRateLimiter());
});

describe("the credential gate", () => {
  it("refuses a request with no Authorization header, and reaches no database", async () => {
    const rpc = watchDatabase();

    const response = await POST(post({ reviews: [REVIEW], parserVersion: "t" }));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a wrong token identically to a missing one", async () => {
    const rpc = watchDatabase();

    const missing = await POST(post({ reviews: [REVIEW], parserVersion: "t" }));
    const wrong = await POST(
      post({ reviews: [REVIEW], parserVersion: "t" }, { authorization: "Bearer nope" }),
    );

    /*
     * INDISTINGUISHABLE ON PURPOSE. Telling a prober which half to fix is the
     * whole of what a specific message buys them.
     */
    expect(wrong.status).toBe(missing.status);
    expect(await wrong.json()).toEqual(await missing.json());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not accept the token in a query string", async () => {
    /*
     * A secret in a URL is written into every access log, proxy log and browser
     * history entry between the caller and here, and survives rotation in all
     * of them. There is no code path that reads one; this pins that.
     */
    const rpc = watchDatabase();
    const response = await POST(
      new Request(
        `https://ask-sunny.example/api/reviews/ingest?token=${encodeURIComponent(TOKEN)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviews: [REVIEW], parserVersion: "t" }),
        },
      ),
    );

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses everybody, with a 503, when no credential is configured", async () => {
    vi.stubEnv(REVIEW_SYNC_SECRET_ENV, "");
    const rpc = watchDatabase();

    const response = await POST(authorised({ reviews: [REVIEW], parserVersion: "t" }));
    const body = await response.json();

    /* 503 rather than 401: this is our gap, and a retry will fix it. */
    expect(response.status).toBe(503);
    expect(body.code).toBe("sync_token_missing");
    /* The variable is NAMED so it is fixable. No value appears. */
    expect(body.reason).toContain(REVIEW_SYNC_SECRET_ENV);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a token shorter than the configured minimum rather than accepting it", async () => {
    /* A deployment is better off refusing everybody than running on a guessable secret. */
    vi.stubEnv(REVIEW_SYNC_SECRET_ENV, "tooshort");

    const response = await POST(
      post({ reviews: [REVIEW], parserVersion: "t" }, { authorization: "Bearer tooshort" }),
    );

    expect(response.status).toBe(503);
  });

  it("rate limits a guessing caller and says when to come back", async () => {
    const rpc = watchDatabase();

    let last: Response | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      last = await POST(
        post(
          { reviews: [REVIEW], parserVersion: "t" },
          { authorization: "Bearer wrong", "x-forwarded-for": "203.0.113.9" },
        ),
      );
    }

    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the supabase gate", () => {
  it("refuses before authentication when nothing can be stored", async () => {
    vi.stubEnv(SUPABASE_URL_ENV, "");
    const rpc = watchDatabase();

    const response = await POST(authorised({ reviews: [REVIEW], parserVersion: "t" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("supabase_missing");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("an authorised sync", () => {
  it("files the batch and answers with the counts", async () => {
    const rpc = watchDatabase();

    const response = await POST(
      authorised({ reviews: [REVIEW], parserVersion: "2026.09.17-1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      credentialId: "brave-extension",
      received: 1,
      created: 1,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("requires the parser version rather than defaulting one", async () => {
    /*
     * A default would quietly attribute a broken parser's output to whatever
     * the server happened to believe, and the version is how somebody finds
     * which records to re-check.
     */
    const rpc = watchDatabase();

    const response = await POST(authorised({ reviews: [REVIEW] }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a review for a store that is not one of the fifteen", async () => {
    const rpc = watchDatabase();

    const response = await POST(
      authorised({
        reviews: [{ ...REVIEW, externalReviewId: "FIXTURE-BCS-000010", storeCode: "881" }],
        parserVersion: "2026.09.17-1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ignoredNonStc).toBe(1);
    expect(body.created).toBe(0);
    /* Nothing survived validation, so nothing reached the database. */
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts an empty batch, which is how the extension tests its token", async () => {
    const rpc = watchDatabase();

    const response = await POST(
      authorised({ reviews: [], parserVersion: "connection-test" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", received: 0, created: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the readiness response", () => {
  it("reports configuration by name and never by value", async () => {
    const response = await GET();
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(body.configured[REVIEW_SYNC_SECRET_ENV]).toBe(true);
    expect(body.configured.supabaseUrl).toBe(true);
    expect(body.configured.supabaseSecret).toBe(true);

    /* Not the token, not the key, not the Supabase URL's credentials. */
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(SECRET_KEY);
  });

  it("publishes the fifteen store codes, which are not a secret", async () => {
    const body = await (await GET()).json();
    expect(body.allowedStoreCodes).toHaveLength(15);
    expect(body.allowedStoreCodes).toContain("306");
    expect(body.allowedStoreCodes).not.toContain("881");
  });
});
