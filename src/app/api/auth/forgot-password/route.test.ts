import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * POST /api/auth/forgot-password — public, server-side, says nothing.
 * ============================================================================
 *
 * The public Forgot Password form posts here. These cases pin that:
 *
 *   - it needs no session and involves no administrator;
 *   - it calls `resetPasswordForEmail` on the IMPLICIT, publishable-key client,
 *     never the secret-key admin client;
 *   - the link returns to `<site>/reset-password`, chosen by the server;
 *   - every well-formed request gets the identical answer, so the endpoint
 *     cannot be used to learn which addresses have accounts;
 *   - the address, the provider's message and any link are never logged.
 */

const EMAIL = "manager@suntancity.com";

type Outcome = "ok" | "unknown_user" | "rate_limited" | "provider_error" | "throws";

async function loadRoute(options: { outcome?: Outcome; configured?: boolean } = {}) {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    options.configured === false ? "" : "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    options.configured === false ? "" : "sb_publishable_test";

  const seen = { calls: [] as { email: string; options: unknown }[], adminUsed: false };

  vi.doMock("@/lib/supabase/recovery-client", () => ({
    getSupabaseRecoveryClient: () => ({
      auth: {
        resetPasswordForEmail: async (email: string, opts: unknown) => {
          seen.calls.push({ email, options: opts });
          switch (options.outcome ?? "ok") {
            case "ok":
              return { data: {}, error: null };
            case "unknown_user":
              // Supabase answers 200 for an unknown address too; an error is modelled for safety.
              return { data: null, error: { code: "user_not_found", status: 404, message: `No user ${email}` } };
            case "rate_limited":
              return {
                data: null,
                error: {
                  code: "over_email_send_rate_limit",
                  status: 429,
                  message: `email rate limit exceeded for ${email}`,
                },
              };
            case "provider_error":
              return { data: null, error: { code: `bad code with ${email}`, status: 500, message: email } };
            case "throws":
              throw new Error(`network down while sending to ${email}`);
          }
        },
      },
    }),
  }));

  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => {
      seen.adminUsed = true;
      throw new Error("the admin client must not be used here");
    },
  }));

  const { POST } = await import("./route");
  const call = (body: unknown, origin = "https://ask-sunny.vercel.app") =>
    POST(
      new Request(`${origin}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { call, seen };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the request Supabase receives", () => {
  it("calls resetPasswordForEmail once, server-side, with the normalised address", async () => {
    const { call, seen } = await loadRoute();
    await call({ email: `  Manager@SunTanCity.com ` });

    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0].email).toBe(EMAIL);
  });

  it("asks for the link to return to /reset-password on this site", async () => {
    const { call, seen } = await loadRoute();
    await call({ email: EMAIL });

    expect(seen.calls[0].options).toEqual({
      redirectTo: "https://ask-sunny.vercel.app/reset-password",
    });
  });

  it("uses the configured site URL when there is one", async () => {
    const { call, seen } = await loadRoute();
    process.env.NEXT_PUBLIC_SITE_URL = "https://ask-sunny.vercel.app/";
    await call({ email: EMAIL }, "https://some-preview.vercel.app");
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(seen.calls[0].options).toEqual({
      redirectTo: "https://ask-sunny.vercel.app/reset-password",
    });
  });

  it("ignores any redirect the caller tries to supply", async () => {
    const { call, seen } = await loadRoute();
    await call({ email: EMAIL, redirectTo: "https://evil.example/steal" });

    expect(seen.calls[0].options).toEqual({
      redirectTo: "https://ask-sunny.vercel.app/reset-password",
    });
  });

  it("never touches the secret-key admin client", async () => {
    const { call, seen } = await loadRoute();
    await call({ email: EMAIL });
    expect(seen.adminUsed).toBe(false);
  });

  it("needs no session: nothing in the route authenticates or reads cookies", () => {
    const source = readFileSync("src/app/api/auth/forgot-password/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toMatch(/authorizeRequest|getSupabaseSessionClient|cookies\(|getAppUser/);
    expect(source).not.toMatch(/getSupabaseAdmin|supabase\/server"/);
    expect(source).toContain("getSupabaseRecoveryClient()");
  });
});

describe("the answer is identical whatever happened", () => {
  it.each(["ok", "unknown_user", "rate_limited", "provider_error", "throws"] as const)(
    "%s → 200 { ok: true }, not cacheable",
    async (outcome) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { call } = await loadRoute({ outcome });
      const response = await call({ email: EMAIL });

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: true });
    },
  );
});

describe("what is logged", () => {
  it.each(["ok", "unknown_user", "rate_limited", "provider_error", "throws"] as const)(
    "%s: never the address, the provider message, or the request body",
    async (outcome) => {
      const lines: string[] = [];
      for (const level of ["log", "info", "warn", "error", "debug"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        });
      }
      const { call } = await loadRoute({ outcome });
      await call({ email: EMAIL });

      const output = lines.join("\n").toLowerCase();
      expect(output).not.toContain(EMAIL.toLowerCase());
      expect(output).not.toContain("suntancity");
      expect(output).not.toContain("rate limit exceeded");
      expect(output).not.toContain("reset-password");
    },
  );

  it("logs only the machine error code when Supabase refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { call } = await loadRoute({ outcome: "rate_limited" });
    await call({ email: EMAIL });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[forgot-password] recovery request not accepted: over_email_send_rate_limit",
    );
  });

  it("logs 'unknown' rather than a code that is not a plain identifier", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { call } = await loadRoute({ outcome: "provider_error" });
    await call({ email: EMAIL });

    expect(String(warn.mock.calls[0][0])).toBe(
      "[forgot-password] recovery request not accepted: unknown",
    );
  });

  it("logs nothing at all on success", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const { call } = await loadRoute();
    await call({ email: EMAIL });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("the only other answers say nothing about any account", () => {
  it.each([{}, { email: "" }, { email: "not-an-address" }, { email: 42 }, "not json"])(
    "rejects malformed input %j with 400 and asks Supabase nothing",
    async (body) => {
      const { call, seen } = await loadRoute();
      const response = await call(body);

      expect(response.status).toBe(400);
      expect(seen.calls).toEqual([]);
    },
  );

  it("returns 503 when the deployment has no Supabase configuration", async () => {
    const { call, seen } = await loadRoute({ configured: false });
    const response = await call({ email: EMAIL });

    expect(response.status).toBe(503);
    expect(seen.calls).toEqual([]);
    const payload = await response.json();
    expect(payload.error).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(JSON.stringify(payload)).not.toContain(EMAIL);
  });
});
