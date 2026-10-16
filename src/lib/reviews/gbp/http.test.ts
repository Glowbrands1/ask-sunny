import { describe, expect, it, vi } from "vitest";

import { backoffMs, GbpApiError, MAX_ATTEMPTS, requestWithRetry, type HttpDeps } from "./http";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function deps(responses: (Response | Error)[]): HttpDeps & { calls: () => number; sleeps: number[] } {
  const sleeps: number[] = [];
  let i = 0;
  return {
    fetch: vi.fn(async () => {
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return next.clone();
    }) as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    calls: () => i,
    sleeps,
  };
}

describe("requestWithRetry", () => {
  it("returns the first successful response without sleeping", async () => {
    const d = deps([json(200, { ok: true })]);
    const response = await requestWithRetry("https://x", {}, d);
    expect(response.status).toBe(200);
    expect(d.sleeps).toEqual([]);
  });

  it("retries 503 then succeeds, backing off exponentially", async () => {
    const d = deps([json(503, {}), json(503, {}), json(200, {})]);
    await requestWithRetry("https://x", {}, d);
    expect(d.calls()).toBe(3);
    expect(d.sleeps).toEqual([500, 1000]);
  });

  it("honours Retry-After on a 429", async () => {
    const d = deps([json(429, {}, { "retry-after": "7" }), json(200, {})]);
    await requestWithRetry("https://x", {}, d);
    expect(d.sleeps).toEqual([7000]);
  });

  it("retries a network failure", async () => {
    const d = deps([new Error("socket hang up"), json(200, {})]);
    await requestWithRetry("https://x", {}, d);
    expect(d.calls()).toBe(2);
  });

  it("gives up after MAX_ATTEMPTS and reports quota exhaustion as retryable", async () => {
    const d = deps([json(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } })]);
    await expect(requestWithRetry("https://x", {}, d)).rejects.toMatchObject({
      code: "quota_exhausted",
      retryable: true,
    });
    expect(d.calls()).toBe(MAX_ATTEMPTS);
  });

  it.each([
    [400, "bad_request"],
    [401, "auth_failed"],
    [403, "forbidden"],
    [404, "not_found"],
  ])("does not retry a %i", async (status, code) => {
    const d = deps([json(status, { error: { message: "no", status: "X" } })]);
    await expect(requestWithRetry("https://x", {}, d)).rejects.toMatchObject({ code });
    expect(d.calls()).toBe(1);
  });

  it("charges every real attempt to the budget callback", async () => {
    const d = deps([json(500, {}), json(200, {})]);
    const charge = vi.fn();
    await requestWithRetry("https://x", {}, d, charge);
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it("never puts the Google error message body into the thrown error", async () => {
    const d = deps([json(403, { error: { message: "token ya29.SECRET leaked", status: "PERMISSION_DENIED" } })]);
    const error = (await requestWithRetry("https://x", {}, d).catch((e: unknown) => e)) as GbpApiError;
    expect(String(error.message)).not.toContain("ya29");
    expect(error.googleStatus).toBe("PERMISSION_DENIED");
  });
});

describe("backoffMs", () => {
  it("caps the delay", () => {
    expect(backoffMs(20, null, () => 0)).toBeLessThanOrEqual(30_000);
    expect(backoffMs(1, "9999", () => 0)).toBe(30_000);
  });
});
