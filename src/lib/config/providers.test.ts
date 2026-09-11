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

/* ------------------------------- the production demo-mode regression ----- */

/**
 * THE BUG THIS BLOCK EXISTS FOR, stated as the evidence that found it.
 *
 * https://ask-sunny.vercel.app served:
 *
 *   {"mode":"demo","configured":true,"missingEnvironmentVariables":[],
 *    "configurationProblems":[]}
 *
 * Every credential present and working, and seeded demo content on the page.
 * NEXT_PUBLIC_ variables are substituted into the bundle AT BUILD TIME, so the
 * deployment behaved by whatever string the dashboard held when that build ran.
 * Measured directly on this codebase: build with "True", serve with "False",
 * and both `process.env.NEXT_PUBLIC_DEMO_MODE` and `process.env[name]` return
 * "True". No read recovers the runtime value, so no parser change could have
 * fixed it — and the case-insensitive parse shipped just before this did not.
 *
 * The condition below is that deployment: a Production environment whose flag
 * says demo. It must come out live.
 */
describe("production deployments ignore a stale demo flag", () => {
  function onVercel(environment: string) {
    process.env.NEXT_PUBLIC_VERCEL_ENV = environment;
  }

  it("REPRODUCES PRODUCTION: a stale 'True' flag no longer forces demo", async () => {
    onVercel("production");
    process.env.NEXT_PUBLIC_DEMO_MODE = "True";

    const { isDemoMode, runtimeMode, modeSource } = await import("./runtime");
    expect(isDemoMode()).toBe(false);
    expect(runtimeMode()).toBe("live");
    expect(modeSource()).toBe("production-deployment");
  });

  it("is live in production whatever the flag says, or does not say", async () => {
    for (const value of ["True", "true", "TRUE", "", "0", "no", "garbage"]) {
      vi.resetModules();
      process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_DEMO_MODE = value;
      const { isDemoMode } = await import("./runtime");
      expect(isDemoMode(), `flag=${JSON.stringify(value)}`).toBe(false);
    }

    vi.resetModules();
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    const { isDemoMode } = await import("./runtime");
    expect(isDemoMode(), "flag unset").toBe(false);
  });

  /*
   * The half that keeps this from being "make everything live". Preview is
   * where demo mode is actually used, and it is untouched.
   */
  it("PRESERVES PREVIEW: demo still works on a preview deployment", async () => {
    onVercel("preview");
    delete process.env.NEXT_PUBLIC_DEMO_MODE;

    const { isDemoMode, modeSource } = await import("./runtime");
    expect(isDemoMode()).toBe(true);
    expect(modeSource()).toBe("default-demo");
  });

  it("PRESERVES PREVIEW: an explicit true is honoured there", async () => {
    onVercel("preview");
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";

    const { isDemoMode, modeSource } = await import("./runtime");
    expect(isDemoMode()).toBe(true);
    expect(modeSource()).toBe("explicit-demo");
  });

  it("PRESERVES PREVIEW: an explicit false still selects live there", async () => {
    onVercel("preview");
    process.env.NEXT_PUBLIC_DEMO_MODE = "False";

    const { isDemoMode, modeSource } = await import("./runtime");
    expect(isDemoMode()).toBe(false);
    expect(modeSource()).toBe("explicit-live");
  });

  it("leaves local and non-Vercel runtimes on the demo default", async () => {
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;

    const { isDemoMode, modeSource, deploymentEnvironment } = await import("./runtime");
    expect(deploymentEnvironment()).toBe("");
    expect(isDemoMode()).toBe(true);
    expect(modeSource()).toBe("default-demo");
  });

  it("keeps a deliberate, default-off way back to demo in production", async () => {
    onVercel("production");
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION = "true";

    const { isDemoMode, modeSource } = await import("./runtime");
    expect(isDemoMode()).toBe(true);
    expect(modeSource()).toBe("explicit-demo");

    delete process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION;
  });

  /*
   * The consequences the mode decision actually has. A production deployment
   * that resolved to demo did not merely LOOK wrong: it answered with the mock
   * and let any visitor in through the role switcher.
   */
  it("chooses the real Claude provider, never the mock, in production", async () => {
    onVercel("production");
    process.env.NEXT_PUBLIC_DEMO_MODE = "True";

    const { getAIProvider, ClaudeProvider, MockAIProvider } = await import("@/lib/ai");
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider).not.toBeInstanceOf(MockAIProvider);
    expect(provider.connected).toBe(true);
  });

  it("does not hand production the demo role switcher", async () => {
    onVercel("production");
    process.env.NEXT_PUBLIC_DEMO_MODE = "True";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_testvalue";

    const { getAuthProvider } = await import("@/lib/auth");
    const provider = getAuthProvider();
    expect(provider.kind).not.toBe("demo");
    expect(provider.isProductionGrade).toBe(true);
  });

  /*
   * Live mode never silently substitutes something weaker — the rule the whole
   * file is arranged around. Forcing production live must REFUSE when the
   * credentials are absent, not quietly fall back to the role switcher.
   */
  it("refuses rather than falling back when production lacks Supabase values", async () => {
    onVercel("production");
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const { getAuthProvider } = await import("@/lib/auth");
    const provider = getAuthProvider();

    /*
     * "none", not "demo": the refusing provider. `missingConfiguration` is
     * deliberately empty on it — no provider has been selected, so no variable
     * set is the right one to name yet — so the property that matters is that
     * it identifies NOBODY rather than handing out a demo role.
     */
    expect(provider.kind).toBe("none");
    expect(provider.isProductionGrade).toBe(false);
    await expect(provider.identify({ headers: new Headers() })).resolves.toBeNull();
  });
});
