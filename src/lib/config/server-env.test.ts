import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

/** Everything live mode genuinely requires. */
const REQUIRED = [
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
];

/** Also cleared between cases, but not required by any code path yet. */
const OPTIONAL = ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

const ALL = [...REQUIRED, ...OPTIONAL];

beforeEach(() => {
  vi.resetModules();
  for (const name of ALL) delete process.env[name];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function configureAll() {
  for (const name of REQUIRED) process.env[name] = "placeholder-not-a-real-value";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "placeholder-not-a-real-value";
}

describe("liveReadiness", () => {
  it("reports every missing variable by NAME when nothing is configured", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.missing.sort()).toEqual([...REQUIRED].sort());
  });

  it("does not require the browser publishable key, which nothing reads yet", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    for (const name of REQUIRED) process.env[name] = "placeholder";
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    // Reported so the dashboard can show it, but never a blocker today.
    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
    expect(readiness.supabaseBrowserKey.ready).toBe(false);
    expect(readiness.supabaseBrowserKey.requiredNow).toBe(false);
  });

  it("reports ready once every variable is present", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    configureAll();
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
  });

  it("accepts the legacy service_role name when the current one is unset", async () => {
    for (const name of REQUIRED) process.env[name] = "placeholder";
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-placeholder";

    const { liveReadiness, supabaseSecretKey } = await import("./server-env");
    expect(liveReadiness().supabase.ready).toBe(true);
    expect(liveReadiness().supabaseSecretKeySource).toBe("legacy");
    expect(supabaseSecretKey()).toBe("legacy-placeholder");
  });

  it("prefers the current secret-key name over the legacy one", async () => {
    process.env.SUPABASE_SECRET_KEY = "current-placeholder";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-placeholder";

    const { supabaseSecretKey, supabaseSecretKeySource } = await import("./server-env");
    expect(supabaseSecretKey()).toBe("current-placeholder");
    expect(supabaseSecretKeySource()).toBe("current");
  });

  it("names the current variable when no privileged key is set at all", async () => {
    const { supabaseSecretKey, MissingConfigurationError } = await import("./server-env");
    const error = (() => {
      try {
        supabaseSecretKey();
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(MissingConfigurationError);
    // Points at the name a new project should configure, not the legacy one.
    expect((error as Error).message).toContain("SUPABASE_SECRET_KEY");
    expect((error as Error).message).not.toContain("SERVICE_ROLE");
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
    expect(readiness.embeddingModel).toBe("gte-small");
    expect(readiness.embeddingDimensions).toBe(384);
  });

  it("flags a mismatch between the embedding width and the migrated column", async () => {
    configureAll();
    const { liveReadiness } = await import("./server-env");
    // The shipped migrations end at vector(384) and the model emits 384.
    // If this ever fails, a migration is missing — which is the point.
    expect(liveReadiness().embeddingDimensionMismatch).toBe(false);
  });

  it("separates the services so the UI can say which one is unconfigured", async () => {
    process.env.ANTHROPIC_API_KEY = "x";
    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.anthropic.ready).toBe(true);
    expect(readiness.supabase.ready).toBe(false);
    // Embeddings run inside Supabase and have no credential of their own, so
    // they are unready for exactly the same reason and name the same variables.
    expect(readiness.embeddings.ready).toBe(false);
    expect(readiness.embeddings.missing).toEqual(readiness.supabase.missing);
  });

  it("names a shared Supabase variable once, not once per dependent service", async () => {
    // REGRESSION. Embeddings and the database both need SUPABASE_SECRET_KEY.
    // Concatenating their `missing` arrays would tell the operator to set the
    // same variable twice.
    process.env.ANTHROPIC_API_KEY = "x";
    const { liveReadiness } = await import("./server-env");
    const { missing } = liveReadiness();

    expect(missing).toEqual([...new Set(missing)]);
    expect(missing.filter((name) => name === "SUPABASE_SECRET_KEY")).toHaveLength(1);
  });
});

describe("key-shape safety net", () => {
  it("classifies the new publishable and secret key prefixes", async () => {
    const { looksPrivileged, looksPublishable } = await import("./server-env");

    expect(looksPrivileged("sb_secret_abc")).toBe(true);
    expect(looksPrivileged("sb_publishable_abc")).toBe(false);
    expect(looksPublishable("sb_publishable_abc")).toBe(true);
    expect(looksPublishable("sb_secret_abc")).toBe(false);
  });

  it("classifies the legacy JWT keys by their role claim", async () => {
    const { looksPrivileged, looksPublishable } = await import("./server-env");

    const jwt = (role: string) =>
      [
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
        Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url"),
        "signature",
      ].join(".");

    expect(looksPrivileged(jwt("service_role"))).toBe(true);
    expect(looksPublishable(jwt("anon"))).toBe(true);
    expect(looksPrivileged(jwt("anon"))).toBe(false);
  });

  it("does not misclassify an opaque or malformed value", async () => {
    const { looksPrivileged, looksPublishable } = await import("./server-env");

    for (const value of ["", "placeholder", "not.a.jwt", "a.b"]) {
      expect(looksPrivileged(value)).toBe(false);
      expect(looksPublishable(value)).toBe(false);
    }
  });

  it("refuses a privileged key placed in the browser-exposed variable", async () => {
    for (const name of REQUIRED) process.env[name] = "placeholder";
    // The catastrophic mistake: a secret key under a NEXT_PUBLIC_ name would be
    // compiled into the bundle and handed to every visitor.
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_leaked";

    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.problems).toHaveLength(1);
    expect(readiness.problems[0]).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(readiness.problems[0]).toContain("bypasses row level security");
    // Names the variable; never echoes the value.
    expect(readiness.problems[0]).not.toContain("sb_secret_leaked");
  });

  it("refuses a publishable key placed in the privileged variable", async () => {
    for (const name of REQUIRED) process.env[name] = "placeholder";
    process.env.SUPABASE_SECRET_KEY = "sb_publishable_wrongslot";

    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.problems[0]).toContain("SUPABASE_SECRET_KEY");
    expect(readiness.problems[0]).toContain("row level security");
    expect(readiness.problems[0]).not.toContain("sb_publishable_wrongslot");
  });

  it("keeps `missing` empty when every variable is set but one is wrong", async () => {
    // Regression: gating on `ready` alone produced "Missing: ." for a value
    // that was present but in the wrong slot. `missing` and `problems` are
    // distinct signals and the caller must be able to tell them apart.
    for (const name of REQUIRED) process.env[name] = "placeholder";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_leaked";

    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([]);
    expect(readiness.problems.length).toBeGreaterThan(0);
  });

  it("reports no problems when both keys are in their correct slots", async () => {
    for (const name of REQUIRED) process.env[name] = "placeholder";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_correct";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_correct";

    const { liveReadiness } = await import("./server-env");
    const readiness = liveReadiness();

    expect(readiness.problems).toEqual([]);
    expect(readiness.ready).toBe(true);
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
