import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const ALL = [
  "ANTHROPIC_API_KEY",
  "VOYAGE_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

beforeEach(() => {
  vi.resetModules();
  for (const name of ALL) delete process.env[name];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function configureAll() {
  for (const name of ALL) process.env[name] = "placeholder-not-a-real-value";
}

describe("liveReadiness", () => {
  it("reports every missing variable by NAME when nothing is configured", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.missing.sort()).toEqual([...ALL].sort());
  });

  it("reports ready once every variable is present", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    configureAll();
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
  });

  it("treats a whitespace-only value as missing", async () => {
    configureAll();
    process.env.ANTHROPIC_API_KEY = "   ";
    const { anthropicReadiness } = await import("./server-env");
    expect(anthropicReadiness()).toEqual({
      ready: false,
      missing: ["ANTHROPIC_API_KEY"],
    });
  });

  it("never returns a variable's value, only its name", async () => {
    configureAll();
    // Deliberately not credential-shaped: the assertion is about the value
    // never being returned, and a realistic-looking fixture would trip secret
    // scanners on every commit for no benefit.
    process.env.ANTHROPIC_API_KEY = "REDACTED-FIXTURE-VALUE-DO-NOT-LEAK";
    const { liveReadiness } = await import("./server-env");

    expect(JSON.stringify(liveReadiness())).not.toContain("DO-NOT-LEAK");
  });

  it("reports the configured models as facts, which are not secrets", async () => {
    configureAll();
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.claudeModel).toBeTruthy();
    expect(readiness.embeddingModel).toBe("voyage-4-lite");
    expect(readiness.embeddingDimensions).toBe(1024);
  });

  it("flags a mismatch between the embedding width and the migrated column", async () => {
    configureAll();
    const { liveReadiness } = await import("./server-env");
    // The shipped migrations declare vector(1024) and the model emits 1024.
    // If this ever fails, a migration is missing — which is the point.
    expect(liveReadiness().embeddingDimensionMismatch).toBe(false);
  });

  it("separates the three services so the UI can say which one is unconfigured", async () => {
    process.env.ANTHROPIC_API_KEY = "x";
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.anthropic.ready).toBe(true);
    expect(readiness.voyage.ready).toBe(false);
    expect(readiness.supabase.ready).toBe(false);
  });
});

describe("requireEnv", () => {
  it("throws naming the variable, never echoing a value", async () => {
    const { requireEnv, MissingConfigurationError } = await import("./server-env");

    const error = (() => {
      try {
        requireEnv("ANTHROPIC_API_KEY");
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(MissingConfigurationError);
    expect((error as Error).message).toContain("ANTHROPIC_API_KEY");
  });

  it("returns a trimmed value when present", async () => {
    process.env.ANTHROPIC_API_KEY = "  value  ";
    const { requireEnv } = await import("./server-env");
    expect(requireEnv("ANTHROPIC_API_KEY")).toBe("value");
  });
});
