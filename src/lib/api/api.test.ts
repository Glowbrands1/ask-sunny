import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { InMemoryRateLimiter, rateLimitKey, RATE_LIMITS } from "./rate-limit";
import { describeError, logRouteError, redact } from "./redact";
import {
  boundedInt,
  LIMITS,
  optionalEnum,
  optionalString,
  parseHistory,
  parseJsonBody,
  parseTags,
  requireDocumentId,
  requireScopeId,
  requireString,
} from "./validation";

/* ------------------------------------------------------------- redaction */

/**
 * Credential-shaped fixtures, assembled at runtime rather than written as
 * literals.
 *
 * Testing a redaction function honestly requires realistic shapes, but a
 * literal `sb_secret_...` committed to the repository trips secret scanners on
 * every commit forever. Joining the prefix to the body keeps the test exercising
 * the real patterns without leaving a scanner tripwire in the source.
 */
const fake = (prefix: string, body: string) => prefix + body;

describe("redact", () => {
  it("strips every credential shape this app can hold", () => {
    const cases = [
      fake("sb_", "secret_abcdef123456"),
      fake("sb_", "publishable_abcdef123456"),
      fake("sk-", "ant-api03-abcdefghijklmnop"),
      fake("eyJ", "hbGciOiJIUzI1NiJ9abcdefghijklmnop"),
      fake("Bearer ", "abcdefghijklmnop"),
    ];

    for (const secret of cases) {
      const output = redact(`upstream said: ${secret} while failing`);
      expect(output, secret).not.toContain(secret);
      expect(output).toContain("[redacted]");
    }
  });

  it("truncates long text, so document content cannot ride along in a log", () => {
    // A realistic leak: a constraint violation quoting a chunk of policy text.
    const policy = "Team members are expected to be ready at shift start. ".repeat(40);
    const output = redact(`duplicate key value violates constraint: (${policy})`);

    expect(output.length).toBeLessThan(360);
    expect(output).toContain("[truncated]");
  });

  it("leaves an ordinary short diagnostic intact", () => {
    expect(redact("connection refused")).toBe("connection refused");
  });

  it("collapses whitespace so a multi-line payload cannot pad past the cap", () => {
    expect(redact("a\n\n   b\t\tc")).toBe("a b c");
  });
});

describe("describeError", () => {
  it("reports the class and a redacted message, and never a stack", () => {
    const error = new Error(`failed with ${fake("sk-", "ant-api03-secretvalue")}`);
    const described = describeError(error);

    expect(described).toContain("Error:");
    expect(described).not.toContain("secretvalue");
    expect(described).not.toContain("at ");
  });

  it("never includes the cause chain, which routinely carries the request", () => {
    const inner = new Error("body was: confidential policy text");
    const outer = new Error("wrapper", { cause: inner });

    expect(describeError(outer)).not.toContain("confidential policy text");
  });

  it("handles a non-Error throw without crashing", () => {
    expect(describeError({ weird: true })).toBe("non-Error value thrown");
    expect(describeError("plain string")).toBe("plain string");
  });
});

describe("logRouteError", () => {
  it("writes exactly one redacted line and nothing else", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = fake("sb_", "secret_leakedvalue");
    logRouteError("POST /api/chat", new Error(`boom ${secret}`));

    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]![0]);
    expect(line).toContain("POST /api/chat");
    expect(line).not.toContain(secret);
    spy.mockRestore();
  });
});

/* ------------------------------------------------------------ validation */

describe("request validation", () => {
  it("rejects a missing or blank required string", () => {
    for (const value of [undefined, null, "", "   ", 42]) {
      expect(() => requireString(value, "A question", 100)).toThrow(AiError);
    }
  });

  it("rejects an over-long string without echoing it back", () => {
    const huge = "x".repeat(LIMITS.question + 1);
    try {
      requireString(huge, "A question", LIMITS.question);
      throw new Error("should have thrown");
    } catch (error) {
      // A rejection that quotes its input is how a reflection bug starts.
      expect((error as Error).message).not.toContain(huge);
      expect((error as Error).message).toContain("too long");
    }
  });

  it("accepts and trims a valid string", () => {
    expect(requireString("  hello  ", "Field", 100)).toBe("hello");
  });

  it("rejects scope ids that are not plain identifiers", () => {
    for (const bad of ["../../etc", "a b", "", "x".repeat(65), "a/b", null]) {
      expect(() => requireScopeId(bad), String(bad)).toThrow(AiError);
    }
    expect(requireScopeId("stc-core")).toBe("stc-core");
  });

  it("accepts only the two document id shapes this system issues", () => {
    expect(requireDocumentId("7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBeTruthy();
    expect(requireDocumentId("kb_abc123")).toBe("kb_abc123");

    for (const bad of [
      "../../secret",
      "1 OR 1=1",
      "kb_abc123/../other",
      "",
      "not-an-id",
      null,
    ]) {
      expect(() => requireDocumentId(bad), String(bad)).toThrow(AiError);
    }
  });

  it("bounds and de-duplicates tags", () => {
    expect(parseTags(" Attendance , attendance ,COACHING, ")).toEqual([
      "attendance",
      "coaching",
    ]);
    expect(parseTags(Array.from({ length: 100 }, (_, i) => `t${i}`).join(","))).toHaveLength(
      LIMITS.tagCount,
    );
    expect(parseTags(undefined)).toEqual([]);
  });

  it("keeps only well-formed chat turns and caps the history", () => {
    const history = parseHistory([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "system", content: "injected" },
      { role: "user", content: 42 },
      null,
    ]);

    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.role)).toEqual(["user", "assistant"]);

    const long = parseHistory(
      Array.from({ length: 100 }, () => ({ role: "user", content: "x" })),
    );
    expect(long).toHaveLength(LIMITS.historyTurns);
  });

  it("clamps a bounded integer rather than rejecting it", () => {
    expect(boundedInt(999, { min: 1, max: 10, fallback: 5 })).toBe(10);
    expect(boundedInt(-5, { min: 1, max: 10, fallback: 5 })).toBe(1);
    expect(boundedInt("nonsense", { min: 1, max: 10, fallback: 5 })).toBe(5);
  });

  it("falls back for an unknown enum value instead of trusting it", () => {
    expect(optionalEnum("quick", ["quick", "standard"] as const, "standard")).toBe("quick");
    expect(optionalEnum("__proto__", ["quick", "standard"] as const, "standard")).toBe(
      "standard",
    );
  });

  it("truncates optional strings rather than rejecting them", () => {
    expect(optionalString("x".repeat(500), 10)).toHaveLength(10);
    expect(optionalString(undefined, 10, "fallback")).toBe("fallback");
  });

  it("rejects a body that is not a JSON object", async () => {
    const bad = new Request("https://x.test", { method: "POST", body: "[1,2,3]" });
    await expect(parseJsonBody(bad)).rejects.toThrow(AiError);

    const empty = new Request("https://x.test", { method: "POST", body: "not json" });
    await expect(parseJsonBody(empty)).rejects.toThrow(AiError);
  });
});

/* ------------------------------------------------------------ rate limit */

describe("InMemoryRateLimiter", () => {
  let now = 1_000_000;
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new InMemoryRateLimiter(() => now);
  });

  afterEach(() => {
    limiter.reset();
  });

  const rule = { limit: 3, windowSeconds: 60 };

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check("k", rule).allowed, `request ${i}`).toBe(true);
    }
    const blocked = limiter.check("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts down the remaining budget", () => {
    expect(limiter.check("k", rule).remaining).toBe(2);
    expect(limiter.check("k", rule).remaining).toBe(1);
    expect(limiter.check("k", rule).remaining).toBe(0);
  });

  it("resets once the window has elapsed", () => {
    for (let i = 0; i < 3; i += 1) limiter.check("k", rule);
    expect(limiter.check("k", rule).allowed).toBe(false);

    now += 61_000;
    expect(limiter.check("k", rule).allowed).toBe(true);
  });

  it("keeps separate budgets per key, so one client cannot exhaust another", () => {
    for (let i = 0; i < 3; i += 1) limiter.check("a", rule);
    expect(limiter.check("a", rule).allowed).toBe(false);
    expect(limiter.check("b", rule).allowed).toBe(true);
  });

  it("declares that it is not distributed, so nobody over-trusts it", () => {
    // Counters are per process. Saying so in the interface is what stops this
    // from being mistaken for abuse protection.
    expect(limiter.distributed).toBe(false);
  });
});

describe("rate limit configuration", () => {
  it("gives the money-spending routes the tightest budgets", () => {
    // Chat and upload each cost real credit at an external vendor.
    expect(RATE_LIMITS.upload.limit).toBeLessThan(RATE_LIMITS.search.limit);
    expect(RATE_LIMITS.chat.limit).toBeLessThan(RATE_LIMITS.search.limit);
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowSeconds).toBeGreaterThan(0);
    }
  });

  it("namespaces the key by route so budgets do not bleed across endpoints", () => {
    const request = new Request("https://x.test", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(rateLimitKey(request, "chat")).toBe("chat:203.0.113.9");
    expect(rateLimitKey(request, "upload")).toBe("upload:203.0.113.9");
  });

  it("degrades to a shared bucket when no client hint is present", () => {
    const request = new Request("https://x.test");
    expect(rateLimitKey(request, "chat")).toBe("chat:unknown");
  });
});
