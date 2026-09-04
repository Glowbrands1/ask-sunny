import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthError as AuthErrorType } from "./types";

/**
 * THE AUTHORIZATION SEAM.
 *
 * The property under test is the one the milestone turns on: live mode refuses
 * protected functionality while no real identity provider exists, and a demo
 * identity can never satisfy that requirement — while demo mode itself keeps
 * working untouched.
 */

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
  delete process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS;
  setNodeEnv(ORIGINAL_NODE_ENV);
});

/**
 * NODE_ENV is typed as a readonly union in Next's ambient types, so it is set
 * through a cast. The tests need to simulate a production runtime, which is the
 * one environment where the bypass must be inert.
 */
function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setNodeEnv(ORIGINAL_NODE_ENV);
});

/**
 * Selects the runtime mode AND states whether Supabase is configured.
 *
 * The second half matters more than it looks. Provider selection now reads the
 * Supabase public variables, and this machine's environment may well hold real
 * ones — so a test that only set NEXT_PUBLIC_DEMO_MODE would select the demo
 * provider here and the REAL provider on a developer's laptop, and the suite
 * would pass or fail depending on whose shell it ran in. Every case therefore
 * declares the configuration it means to test.
 */
function setMode(mode: "demo" | "live", supabase: "configured" | "absent" = "absent") {
  process.env.NEXT_PUBLIC_DEMO_MODE = mode === "demo" ? "true" : "false";
  if (supabase === "configured") {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/chat", { method: "POST", headers });
}

/**
 * Loads the guard and the error class from the SAME module registry.
 *
 * `vi.resetModules()` between cases gives each test a fresh graph, so an
 * `AuthError` imported at the top of this file would be a different class
 * object than the one `server.ts` throws, and `instanceof` would always fail.
 */
async function loadAuth() {
  const [{ authorizeRequest }, { AuthError }] = await Promise.all([
    import("./server"),
    import("./types"),
  ]);
  return { authorizeRequest, AuthError };
}

describe("auth provider selection", () => {
  it("uses the demo role switcher in demo mode", async () => {
    setMode("demo");
    const { getAuthProvider, DemoAuthProvider } = await import("./index");
    const provider = getAuthProvider();

    expect(provider).toBeInstanceOf(DemoAuthProvider);
    expect(provider.kind).toBe("demo");
  });

  it("never marks the demo provider as production-grade", async () => {
    setMode("demo");
    const { getAuthProvider } = await import("./index");
    // The single property that stops the demo switcher from being mistaken for
    // authentication anywhere in the codebase.
    expect(getAuthProvider().isProductionGrade).toBe(false);
  });

  it("issues only unverified identities from the demo provider", async () => {
    setMode("demo");
    const { getAuthProvider } = await import("./index");
    const identity = await getAuthProvider().identify({ headers: new Headers() });

    expect(identity).not.toBeNull();
    expect(identity!.verified).toBe(false);
    expect(identity!.subject.startsWith("demo:")).toBe(true);
  });

  it("uses the unconfigured provider in live mode when Supabase is absent", async () => {
    setMode("live", "absent");
    const { getAuthProvider, UnconfiguredAuthProvider } = await import("./index");
    const provider = getAuthProvider();

    // LIVE MODE NEVER FALLS BACK to the role switcher. An unset variable makes
    // `isDemoMode()` true, so if selection read demo first, a live deployment
    // that lost NEXT_PUBLIC_DEMO_MODE would quietly serve the demo provider.
    expect(provider).toBeInstanceOf(UnconfiguredAuthProvider);
    expect(provider.isProductionGrade).toBe(false);
    expect(await provider.identify({ headers: new Headers() })).toBeNull();
  });

  it("uses Supabase Auth in live mode once the public values are present", async () => {
    setMode("live", "configured");
    const { getAuthProvider, SupabaseAuthProvider } = await import("./index");
    const provider = getAuthProvider();

    expect(provider).toBeInstanceOf(SupabaseAuthProvider);
    expect(provider.kind).toBe("supabase");
    // The one provider in the codebase for which this is true.
    expect(provider.isProductionGrade).toBe(true);
    expect(provider.missingConfiguration).toEqual([]);
  });

  it("refuses to call a scheme-less Supabase URL configured", async () => {
    /*
     * REGRESSION. A deployment environment held a URL with no `https://`, and
     * because selection only checked for PRESENCE the real provider was chosen
     * and then threw "Invalid supabaseUrl" from inside the Supabase client on
     * every protected request. A malformed URL is not configuration.
     */
    setMode("live", "configured");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "project.supabase.test";
    const { getAuthProvider, UnconfiguredAuthProvider } = await import("./index");

    expect(getAuthProvider()).toBeInstanceOf(UnconfiguredAuthProvider);
  });

  it("never lists the secret key as part of the auth provider's configuration", async () => {
    /*
     * The privileged key bypasses row level security and has no business
     * identifying a caller. `missingConfiguration` is surfaced to the
     * Integrations screen, so naming it here would advertise a dependency that
     * must not exist.
     */
    setMode("live", "absent");
    const { SupabaseAuthProvider } = await import("./index");
    const missing = new SupabaseAuthProvider().missingConfiguration;

    expect(missing).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(missing).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(missing.join(" ")).not.toContain("SECRET");
    expect(missing.join(" ")).not.toContain("SERVICE_ROLE");
  });

  it("describes the provider honestly for the admin surface", async () => {
    setMode("demo");
    const demo = await import("./index");
    expect(demo.authProviderStatus().productionGrade).toBe(false);
    expect(demo.authProviderStatus().detail).toContain("not authentication");

    vi.resetModules();
    setMode("live", "absent");
    const unconfigured = await import("./index");
    expect(unconfigured.authProviderStatus().productionGrade).toBe(false);
    expect(unconfigured.authProviderStatus().detail).toContain("refused");

    vi.resetModules();
    setMode("live", "configured");
    const real = await import("./index");
    expect(real.authProviderStatus().productionGrade).toBe(true);
    expect(real.authProviderStatus().detail).toContain("Supabase Auth");
    // Says WHERE the role comes from, because that is the fact an
    // administrator reading this screen actually needs.
    expect(real.authProviderStatus().detail).toContain("app_users");
  });
});

describe("authorizeRequest — live mode", () => {
  it("refuses protected functionality when no provider is configured", async () => {
    setMode("live", "absent");
    const { authorizeRequest, AuthError } = await loadAuth();

    const error = await authorizeRequest(request(), "manage_knowledge").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthErrorType).code).toBe("no_provider");
    // 501 Not Implemented, not 401: nothing is wrong with the request, the
    // capability does not exist yet.
    expect((error as AuthErrorType).status).toBe(501);
  });

  it("refuses every protected permission, not only the write ones", async () => {
    setMode("live", "absent");
    const { authorizeRequest, AuthError } = await loadAuth();

    for (const permission of ["ask_questions", "manage_knowledge", "view_reports"] as const) {
      await expect(authorizeRequest(request(), permission)).rejects.toBeInstanceOf(
        AuthError,
      );
    }
  });

  it("cannot be satisfied by a demo identity smuggled in via headers", async () => {
    setMode("live", "absent");
    const { authorizeRequest, AuthError } = await loadAuth();

    // The demo role header is meaningless in live mode: the unconfigured
    // provider is the one in play, and it identifies nobody.
    await expect(
      authorizeRequest(request({ "x-ask-sunny-demo-role": "owner" }), "manage_knowledge"),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects an identity that a provider returned but did not verify", async () => {
    setMode("live", "absent");
    vi.resetModules();

    // A provider that claims to be production-grade but hands back an
    // unverified identity must still be refused — `verified` is checked
    // independently of `isProductionGrade`.
    const { __resetAuthProvider } = await import("./index");
    __resetAuthProvider();

    const authModule = await import("./index");
    vi.spyOn(authModule, "getAuthProvider").mockReturnValue({
      kind: "entra_id",
      name: "fake",
      isProductionGrade: true,
      missingConfiguration: [],
      identify: async () => ({
        subject: "sub",
        email: "a@b.c",
        displayName: "A",
        role: "owner" as const,
        scope: { level: "global" as const, primaryAreaId: null, alsoCoversAreaIds: [] },
        verified: false,
      }),
    });

    const { authorizeRequest, AuthError } = await loadAuth();
    const error = await authorizeRequest(request(), "manage_knowledge").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthErrorType).code).toBe("unauthenticated");
  });
});

describe("authorizeRequest — demo mode", () => {
  it("authorizes a permission the demo role holds", async () => {
    setMode("demo");
    const { authorizeRequest } = await loadAuth();

    const result = await authorizeRequest(request(), "ask_questions");
    expect(result.identity.verified).toBe(false);
    expect(result.provider).toBe("demo");
  });

  it("still enforces the permission matrix by role", async () => {
    setMode("demo");
    const { authorizeRequest, AuthError } = await loadAuth();

    // A Salon Director does not hold manage_users.
    const error = await authorizeRequest(
      request({ "x-ask-sunny-demo-role": "salon_director" }),
      "manage_users",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthErrorType).code).toBe("forbidden");
    expect((error as AuthErrorType).status).toBe(403);
  });

  it("uses the server's own permission matrix, not the browser's", async () => {
    setMode("demo");
    const { authorizeRequest } = await loadAuth();

    // An owner holds manage_users in DEFAULT_PERMISSION_MATRIX. Nothing the
    // client could send changes what the server checks against.
    const result = await authorizeRequest(
      request({ "x-ask-sunny-demo-role": "owner" }),
      "manage_users",
    );
    expect(result.identity.role).toBe("owner");
  });
});

describe("the unauthenticated escape hatch", () => {
  it("is off unless set to exactly true", async () => {
    setMode("live", "absent");
    for (const value of [undefined, "", "1", "yes", "TRUE"]) {
      vi.resetModules();
      if (value === undefined) delete process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS;
      else process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = value;

      const { unauthenticatedAccessAllowed } = await import("./server");
      expect(unauthenticatedAccessAllowed()).toBe(false);
    }
  });

  it("permits the request when explicitly enabled, and warns loudly", async () => {
    setMode("live", "absent");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { authorizeRequest } = await loadAuth();
    const result = await authorizeRequest(request(), "manage_knowledge");

    expect(result.identity.verified).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("SECURITY");
    expect(warn.mock.calls[0]![0]).toContain("ALLOW_UNAUTHENTICATED_LIVE_ACCESS");
  });

  it("warns once per process rather than on every request", async () => {
    setMode("live", "absent");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { authorizeRequest } = await loadAuth();
    await authorizeRequest(request(), "manage_knowledge");
    await authorizeRequest(request(), "manage_knowledge");

    expect(warn).toHaveBeenCalledOnce();
  });

  it("does nothing in demo mode, which needs no escape hatch", async () => {
    setMode("demo");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { authorizeRequest } = await loadAuth();
    const result = await authorizeRequest(request(), "ask_questions");

    expect(result.provider).toBe("demo");
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * THE PRODUCTION LOCKOUT.
 *
 * The security property this suite exists for: in a production build, the
 * escape hatch is inert. Not warned about — inert. There is no value of
 * ALLOW_UNAUTHENTICATED_LIVE_ACCESS, and no combination of other configuration,
 * that lets a production deployment serve an unauthenticated protected request.
 *
 * `next build` and `next start` both set NODE_ENV=production, so every real
 * deployment of this app is covered by these cases.
 */
describe("production lockout — the bypass cannot operate in a production build", () => {
  it("REGRESSION: NODE_ENV=production + the flag set still refuses protected access", async () => {
    setNodeEnv("production");
    setMode("live", "absent");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";

    const { authorizeRequest, AuthError } = await loadAuth();
    const error = await authorizeRequest(request(), "manage_knowledge").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthErrorType).code).toBe("no_provider");
    expect((error as AuthErrorType).status).toBe(501);
  });

  it("refuses every protected permission, not only the write ones", async () => {
    setNodeEnv("production");
    setMode("live", "absent");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";

    const { authorizeRequest, AuthError } = await loadAuth();
    for (const permission of [
      "ask_questions",
      "manage_knowledge",
      "manage_users",
      "view_reports",
    ] as const) {
      await expect(
        authorizeRequest(request(), permission),
        permission,
      ).rejects.toBeInstanceOf(AuthError);
    }
  });

  it("reports the bypass as unavailable and inactive in production", async () => {
    setNodeEnv("production");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";

    const {
      isProductionRuntime,
      unauthenticatedAccessAllowed,
      unauthenticatedBypassAvailable,
      unauthenticatedBypassIgnoredInProduction,
    } = await import("./server");

    expect(isProductionRuntime()).toBe(true);
    // Available and allowed are both false regardless of the flag.
    expect(unauthenticatedBypassAvailable()).toBe(false);
    expect(unauthenticatedAccessAllowed()).toBe(false);
    // And the fact that someone set it anyway is surfaced.
    expect(unauthenticatedBypassIgnoredInProduction()).toBe(true);
  });

  it("stays inert for every truthy-looking value of the flag", async () => {
    for (const value of ["true", "TRUE", "1", "yes", "on", " true "]) {
      vi.resetModules();
      setNodeEnv("production");
      setMode("live", "absent");
      process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = value;

      const { unauthenticatedAccessAllowed } = await import("./server");
      expect(unauthenticatedAccessAllowed(), value).toBe(false);
    }
  });

  it("tells an operator the flag was ignored, rather than failing silently", async () => {
    setNodeEnv("production");
    setMode("live", "absent");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { authorizeRequest } = await loadAuth();
    await authorizeRequest(request(), "manage_knowledge").catch(() => {});

    expect(error).toHaveBeenCalledOnce();
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain("SECURITY");
    expect(line).toContain("production build");
    expect(line).toContain("Remove the variable");
  });

  it("never emits the permissive warning in production", async () => {
    setNodeEnv("production");
    setMode("live", "absent");
    process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { authorizeRequest } = await loadAuth();
    await authorizeRequest(request(), "manage_knowledge").catch(() => {});

    // The "serving unauthenticated requests" warning would be a lie here.
    expect(warn).not.toHaveBeenCalled();
  });

  it("still works in development and test, so the acceptance test is possible", async () => {
    for (const nodeEnv of ["development", "test"]) {
      vi.resetModules();
      setNodeEnv(nodeEnv);
      setMode("live", "absent");
      process.env.ALLOW_UNAUTHENTICATED_LIVE_ACCESS = "true";
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const { authorizeRequest } = await loadAuth();
      const result = await authorizeRequest(request(), "manage_knowledge");
      expect(result.identity.verified, nodeEnv).toBe(false);
    }
  });

  it("keeps demo mode working in a production build", async () => {
    // A production build of the demo is a legitimate deployment: the routes
    // refuse on mode, and the demo UI must be unaffected.
    setNodeEnv("production");
    setMode("demo");

    const { authorizeRequest } = await loadAuth();
    const result = await authorizeRequest(request(), "ask_questions");
    expect(result.provider).toBe("demo");
  });
});
