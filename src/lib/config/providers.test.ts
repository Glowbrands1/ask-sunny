import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROVIDER SELECTION AND THE NO-SILENT-FALLBACK CONTRACT.
 *
 * The single most important behaviour in this codebase: live mode must never
 * quietly become demo mode. A manager acting on a fabricated policy because a
 * service was unreachable is the failure everything else is arranged to
 * prevent, so it is tested directly.
 *
 * Modules are re-imported per case because the resolvers memoize.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function setMode(mode: "demo" | "live") {
  process.env.NEXT_PUBLIC_DEMO_MODE = mode === "demo" ? "true" : "false";
}

describe("runtime mode", () => {
  it("defaults to demo when the variable is unset", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    const { isDemoMode, runtimeMode } = await import("./runtime");
    expect(isDemoMode()).toBe(true);
    expect(runtimeMode()).toBe("demo");
  });

  it("only leaves demo mode on an explicit false", async () => {
    for (const value of ["true", "TRUE", "yes", "1", ""]) {
      vi.resetModules();
      process.env.NEXT_PUBLIC_DEMO_MODE = value;
      const { isDemoMode } = await import("./runtime");
      expect(isDemoMode()).toBe(true);
    }

    vi.resetModules();
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const { isDemoMode } = await import("./runtime");
    expect(isDemoMode()).toBe(false);
  });

  /*
   * CASE AND PADDING ARE TYPOGRAPHY, NOT INTENT.
   *
   * Found in Production: the variable held "False" with a capital F, so the
   * exact-match comparison read it as demo and a real deployment served seeded
   * content while every other signal said it was live. That is the more
   * dangerous direction of the two — a live deployment quietly showing mock
   * data — and nobody typing "False" into a variable named DEMO_MODE means
   * "give me the mock".
   */
  it("accepts any capitalisation of false as live mode", async () => {
    for (const value of ["false", "False", "FALSE", "FaLsE"]) {
      vi.resetModules();
      process.env.NEXT_PUBLIC_DEMO_MODE = value;
      const { isDemoMode, runtimeMode } = await import("./runtime");
      expect(isDemoMode(), value).toBe(false);
      expect(runtimeMode(), value).toBe("live");
    }
  });

  it("ignores whitespace around the value", async () => {
    for (const value of [" false", "false ", "  False  ", "\tFALSE\n"]) {
      vi.resetModules();
      process.env.NEXT_PUBLIC_DEMO_MODE = value;
      const { isDemoMode } = await import("./runtime");
      expect(isDemoMode(), JSON.stringify(value)).toBe(false);
    }
  });

  /*
   * The safety property the exact-match rule was protecting still holds: only
   * the WORD false leaves demo mode, so a genuinely misspelled variable fails
   * safe instead of pointing a prototype at live services.
   */
  it("still treats anything that is not the word false as demo", async () => {
    for (const value of ["0", "no", "off", "fals", "falsey", "false!", "f alse"]) {
      vi.resetModules();
      process.env.NEXT_PUBLIC_DEMO_MODE = value;
      const { isDemoMode } = await import("./runtime");
      expect(isDemoMode(), value).toBe(true);
    }
  });
});

describe("AI provider selection", () => {
  it("selects the mock provider in demo mode", async () => {
    setMode("demo");
    const { getAIProvider, MockAIProvider } = await import("@/lib/ai");
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(MockAIProvider);
    expect(provider.connected).toBe(false);
  });

  it("selects Claude in live mode", async () => {
    setMode("live");
    const { getAIProvider, ClaudeProvider } = await import("@/lib/ai");
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.connected).toBe(true);
  });

  it("reports the provider honestly in each mode", async () => {
    setMode("demo");
    const demo = await import("@/lib/ai");
    expect(demo.aiProviderStatus()).toMatchObject({
      name: "Demo responses",
      connected: false,
    });

    vi.resetModules();
    setMode("live");
    const live = await import("@/lib/ai");
    expect(live.aiProviderStatus()).toMatchObject({
      name: "Claude (Anthropic)",
      connected: true,
    });
  });

  it("does NOT fall back to the mock when the live service fails", async () => {
    setMode("live");
    // Every request to the server route fails outright.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { getAIProvider, AiError } = await import("@/lib/ai");

    await expect(
      getAIProvider().ask({
        question: "What is the attendance policy?",
        mode: "standard",
        history: [],
        // No `todayIso`: the server sets the date from its own clock, so a
        // client request cannot carry one. See `ClientAskContext`.
        context: { userName: "Dana", locationName: "MO Kansas City Wornall" },
      }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it("surfaces missing configuration by variable NAME rather than answering", async () => {
    setMode("live");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Missing environment variables: ANTHROPIC_API_KEY, SUPABASE_SECRET_KEY.",
            code: "not_configured",
            missing: ["ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY"],
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const { getAIProvider, AiError } = await import("@/lib/ai");

    const error = await getAIProvider()
      .ask({
        question: "What is the attendance policy?",
        mode: "standard",
        history: [],
        // No `todayIso`: the server sets the date from its own clock, so a
        // client request cannot carry one. See `ClientAskContext`.
        context: { userName: "Dana", locationName: "MO Kansas City Wornall" },
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiError);
    expect((error as InstanceType<typeof AiError>).code).toBe("not_configured");
    expect((error as InstanceType<typeof AiError>).missing).toEqual([
      "ANTHROPIC_API_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
    // The message names variables, never values.
    expect((error as Error).message).toContain("ANTHROPIC_API_KEY");
  });
});

describe("knowledge provider selection", () => {
  it("uses the seeded local retriever in demo mode", async () => {
    setMode("demo");
    const { getKnowledgeProvider, LocalKnowledgeProvider } = await import("@/lib/knowledge");
    expect(getKnowledgeProvider()).toBeInstanceOf(LocalKnowledgeProvider);
  });

  it("uses the remote retriever in live mode", async () => {
    setMode("live");
    const { getKnowledgeProvider, RemoteKnowledgeProvider } = await import("@/lib/knowledge");
    expect(getKnowledgeProvider()).toBeInstanceOf(RemoteKnowledgeProvider);
  });

  it("always hands the demo-only helpers the local provider", async () => {
    setMode("live");
    const { getLocalKnowledgeProvider, LocalKnowledgeProvider } = await import(
      "@/lib/knowledge"
    );
    expect(getLocalKnowledgeProvider()).toBeInstanceOf(LocalKnowledgeProvider);
  });

  it("does not report a live retriever in demo mode", async () => {
    setMode("demo");
    const { knowledgeProviderStatus } = await import("@/lib/knowledge");
    expect(knowledgeProviderStatus().live).toBe(false);
    expect(knowledgeProviderStatus().detail).toContain("No vector database is connected");
  });
});

describe("storage provider selection", () => {
  it("keeps IndexedDB for browser state in both modes", async () => {
    for (const mode of ["demo", "live"] as const) {
      vi.resetModules();
      setMode(mode);
      const { getStorageProvider, LocalPrototypeStorageProvider } = await import(
        "@/lib/storage"
      );
      expect(getStorageProvider()).toBeInstanceOf(LocalPrototypeStorageProvider);
    }
  });

  it("describes storage honestly per mode", async () => {
    setMode("demo");
    const demo = await import("@/lib/storage");
    expect(demo.storageProviderStatus().detail).toContain("this browser only");

    vi.resetModules();
    setMode("live");
    const live = await import("@/lib/storage");
    expect(live.storageProviderStatus().detail).toContain("private bucket");
  });
});
