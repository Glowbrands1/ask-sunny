import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "./errors";

const waits = vi.hoisted(() => [] as number[]);
vi.mock("./retry-wait", () => ({
  waitBeforeRetry: async (ms: number) => {
    waits.push(ms);
  },
}));

const {
  UPSTREAM_ATTEMPT_TIMEOUT_MS,
  UPSTREAM_MIN_ATTEMPT_MS,
  UPSTREAM_RETRY_AFTER_CAP_MS,
  UPSTREAM_RETRY_BUDGET_MS,
  UpstreamAttemptTimeout,
  describeUpstreamError,
  newUpstreamRetryRecord,
  withUpstreamRetry,
} = await import("./upstream-retry");

/** The SDK's error-type parameter, for an error streamed after the 200. */
type StreamedType = ConstructorParameters<typeof APIError>[4];

function http(status: number, type: string, headers: Record<string, string> = {}): Error {
  return APIError.generate(status, { type: "error", error: { type, message: "x" } }, undefined, new Headers(headers));
}

beforeEach(() => {
  waits.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeUpstreamError", () => {
  it.each([
    [429, "rate_limit_error", "rate_limit"],
    [529, "overloaded_error", "overloaded"],
    [500, "api_error", "5xx"],
    [502, "api_error", "5xx"],
    [503, "api_error", "5xx"],
    [504, "api_error", "5xx"],
  ])("retries HTTP %i", (status, type, subtype) => {
    expect(describeUpstreamError(http(status, type))).toMatchObject({ code: String(status), retryable: true, subtype });
  });

  it.each([
    [400, "invalid_request_error"],
    [401, "authentication_error"],
    [403, "permission_error"],
    [404, "not_found_error"],
    [413, "request_too_large"],
    [422, "invalid_request_error"],
  ])("never retries HTTP %i", (status, type) => {
    expect(describeUpstreamError(http(status, type)).retryable).toBe(false);
  });

  it("retries an overloaded_error or api_error streamed after the 200, and reads its type", () => {
    for (const type of ["overloaded_error", "api_error", "rate_limit_error"]) {
      const streamed = new APIError(undefined, { type: "error", error: { type } }, undefined, new Headers(), type as StreamedType);
      expect(describeUpstreamError(streamed)).toMatchObject({ code: type, retryable: true });
    }
    const invalid = new APIError(undefined, { type: "error", error: { type: "invalid_request_error" } }, undefined, new Headers(), "invalid_request_error" as StreamedType);
    expect(describeUpstreamError(invalid).retryable).toBe(false);
  });

  it("retries a dropped connection and a socket reset", () => {
    expect(describeUpstreamError(new APIConnectionError({ message: "Connection error." }))).toMatchObject({
      code: "connection",
      retryable: true,
    });
    expect(describeUpstreamError(new APIConnectionTimeoutError()).retryable).toBe(true);
    const reset = Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }) });
    expect(describeUpstreamError(reset)).toMatchObject({ code: "ECONNRESET", retryable: true });
  });

  it("never retries a caller's abort, a refusal, an empty answer or an unknown error", () => {
    expect(describeUpstreamError(new APIUserAbortError()).retryable).toBe(false);
    expect(describeUpstreamError(new AiError("refused", "no", 422)).retryable).toBe(false);
    expect(describeUpstreamError(new AiError("model_failed", "Sunny returned an empty answer.", 502)).retryable).toBe(false);
    expect(describeUpstreamError(new Error("boom")).retryable).toBe(false);
  });

  it("reads retry-after-ms and retry-after", () => {
    expect(describeUpstreamError(http(429, "rate_limit_error", { "retry-after-ms": "1500" })).retryAfterMs).toBe(1500);
    expect(describeUpstreamError(http(429, "rate_limit_error", { "retry-after": "7" })).retryAfterMs).toBe(7000);
  });
});

describe("withUpstreamRetry", () => {
  it("honours a longer retry-after up to the cap", async () => {
    const record = newUpstreamRetryRecord();
    const failures = [http(429, "rate_limit_error", { "retry-after": "4" }), http(429, "rate_limit_error", { "retry-after": "60" })];
    const value = await withUpstreamRetry(record, Date.now(), async () => {
      const next = failures.shift();
      if (next) throw next;
      return "ok";
    });
    expect(value).toBe("ok");
    expect(record.attempts).toBe(3);
    expect(waits).toEqual([4_000, UPSTREAM_RETRY_AFTER_CAP_MS]);
  });

  it("starts no retry past the turn's budget", async () => {
    const record = newUpstreamRetryRecord();
    const error = http(529, "overloaded_error");
    await expect(
      withUpstreamRetry(record, Date.now() - UPSTREAM_RETRY_BUDGET_MS, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(record).toMatchObject({ attempts: 1, retried: false });
    expect(waits).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("[chat] model call failed after 1 attempt: upstream 529 (out of time)");
  });

  it("throws the last error unchanged after two retries", async () => {
    const record = newUpstreamRetryRecord();
    const last = http(503, "api_error");
    const failures = [http(429, "rate_limit_error"), http(529, "overloaded_error"), last];
    await expect(
      withUpstreamRetry(record, Date.now(), async () => {
        throw failures.shift();
      }),
    ).rejects.toBe(last);
    expect(record).toMatchObject({ attempts: 3, retried: true, last: { code: "503", subtype: "5xx" } });
    expect(waits).toEqual([1_000, 3_000]);
  });

  it("gives each call its own two retries and counts every attempt on the record", async () => {
    const record = newUpstreamRetryRecord();
    const failures = [http(529, "overloaded_error"), http(529, "overloaded_error")];
    const attempt = async () => {
      const next = failures.shift();
      if (next) throw next;
      return "ok";
    };
    expect(await withUpstreamRetry(record, Date.now(), attempt)).toBe("ok");
    failures.push(http(503, "api_error"), http(503, "api_error"));
    expect(await withUpstreamRetry(record, Date.now(), attempt)).toBe("ok");
    expect(record).toMatchObject({ attempts: 6, retried: true });
    expect(waits).toEqual([1_000, 3_000, 1_000, 3_000]);
  });
});

describe("each attempt's deadline", () => {
  it("is min(45 s, what is left of the budget), passed to the attempt with an abort signal", async () => {
    const record = newUpstreamRetryRecord();
    const seen: { timeout: number; aborted: boolean }[] = [];
    const startedAt = Date.now() - (UPSTREAM_RETRY_BUDGET_MS - 20_000);
    await withUpstreamRetry(record, startedAt, async (limits) => {
      seen.push({ timeout: limits.timeout, aborted: limits.signal.aborted });
      return "ok";
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.timeout).toBeLessThanOrEqual(20_000);
    expect(seen[0]!.timeout).toBeGreaterThan(19_000);
    expect(seen[0]!.aborted).toBe(false);

    await withUpstreamRetry(newUpstreamRetryRecord(), Date.now(), async (limits) => {
      seen.push({ timeout: limits.timeout, aborted: false });
      return "ok";
    });
    expect(seen[1]!.timeout).toBe(UPSTREAM_ATTEMPT_TIMEOUT_MS);
  });

  it("abandons a hanging attempt at its deadline, aborts it, and reads that as a retryable timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const record = newUpstreamRetryRecord();
      const signals: AbortSignal[] = [];
      const pending = withUpstreamRetry(record, Date.now(), (limits) => {
        signals.push(limits.signal);
        return new Promise<string>(() => {});
      });
      const settled = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(UPSTREAM_RETRY_BUDGET_MS);
      const error = await settled;
      expect(error).toBeInstanceOf(UpstreamAttemptTimeout);
      expect(describeUpstreamError(error)).toMatchObject({ code: "timeout", retryable: true, subtype: "timeout" });
      expect(record).toMatchObject({ attempts: 3, retried: true });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no retry that would get less than the minimum before the budget ends", async () => {
    const record = newUpstreamRetryRecord();
    const startedAt = Date.now() - (UPSTREAM_RETRY_BUDGET_MS - UPSTREAM_MIN_ATTEMPT_MS - 500);
    const error = http(529, "overloaded_error");
    await expect(
      withUpstreamRetry(record, startedAt, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(record.attempts).toBe(1);
    expect(waits).toEqual([]);
  });
});
