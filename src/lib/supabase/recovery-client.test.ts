import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The client behind the public Forgot Password endpoint.
 *
 * Its whole job is the flow type: with `flowType: "implicit"`,
 * `resetPasswordForEmail` sends no PKCE code challenge, so Supabase returns the
 * recovery session as a `#access_token=` fragment `/reset-password` reads in
 * any browser. And it must use the PUBLISHABLE key — the endpoint is public.
 */

afterEach(() => {
  vi.doUnmock("@supabase/supabase-js");
});

async function build() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_must_not_be_used";

  const createClient = vi.fn(() => ({ auth: {} }));
  vi.doMock("@supabase/supabase-js", () => ({ createClient }));
  const { getSupabaseRecoveryClient } = await import("./recovery-client");
  getSupabaseRecoveryClient();
  return createClient;
}

describe("getSupabaseRecoveryClient", () => {
  it("uses the publishable key, never the secret key", async () => {
    const createClient = await build();
    const [url, key] = createClient.mock.calls[0] as unknown as [string, string];

    expect(url).toBe("https://project.supabase.test");
    expect(key).toBe("sb_publishable_test");
    expect(JSON.stringify(createClient.mock.calls)).not.toContain("sb_secret");
  });

  it("sets flowType 'implicit' explicitly, with no persisted session", async () => {
    const createClient = await build();
    const [, , options] = createClient.mock.calls[0] as unknown as [
      string,
      string,
      { auth: Record<string, unknown> },
    ];

    expect(options.auth).toEqual({
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
  });

  it("is server-only and never reads the secret key", () => {
    const source = readFileSync("src/lib/supabase/recovery-client.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).toMatch(/^import "server-only";/);
    expect(source).not.toMatch(/SECRET|secret|service_role|supabaseSecretKey/);
    expect(source).not.toMatch(/@supabase\/ssr/);
  });
});

describe("the installed SDK really does skip PKCE for an implicit client", () => {
  it("resetPasswordForEmail only builds a code challenge when flowType is 'pkce'", () => {
    /*
     * Read from the installed library so an SDK upgrade that changes this
     * behaviour fails here rather than silently in production.
     */
    const sdk = readFileSync(
      "node_modules/@supabase/auth-js/dist/main/GoTrueClient.js",
      "utf8",
    );
    const body = sdk.slice(sdk.indexOf("async resetPasswordForEmail("));
    const method = body.slice(0, body.indexOf("\n    }\n"));
    expect(method).toMatch(/if \(this\.flowType === 'pkce'\)/);
    expect(method).toMatch(/code_challenge: codeChallenge/);
  });
});
