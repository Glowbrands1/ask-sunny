import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE AUTH CALLBACK. Two properties, and both are security properties.
 * ============================================================================
 *
 * NOT AN OPEN REDIRECT. `next` arrives in the URL of a link somebody was
 * emailed, and the response to it sets a session cookie. A callback that
 * honoured `?next=https://evil.example` would hand a freshly-authenticated
 * person to another host — with the link looking entirely legitimate, because
 * it really does come from Ask Sunny.
 *
 * THE CODE NEVER LEAKS. The `code` parameter is a single-use credential.
 * Logging it puts a credential in a log aggregator; reflecting it into an error
 * page puts one in a browser history and a referrer header.
 */

const SOURCE = readFileSync("src/app/auth/callback/route.ts", "utf8");

/** Loads the route with the Supabase exchange stubbed. */
async function loadRoute(exchange: { error: unknown } = { error: null }) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  vi.doMock("next/headers", () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ getAll: () => [], set: () => {} }),
  }));
  vi.doMock("@/lib/supabase/auth-clients", () => ({
    getSupabaseSessionClientFor: () => ({
      auth: { exchangeCodeForSession: async () => exchange },
    }),
  }));

  return import("./route");
}

function url(query: string): Request {
  return new Request(`https://ask-sunny.test/auth/callback${query}`);
}

describe("where the callback is willing to send somebody", () => {
  it("REFUSES an absolute URL to another host", async () => {
    const { GET } = await loadRoute();
    const response = await GET(url("?code=abc&next=https://evil.example/steal"));

    const location = response.headers.get("location")!;
    expect(new URL(location).host).toBe("ask-sunny.test");
    expect(location).not.toContain("evil.example");
  });

  it("REFUSES a protocol-relative //host, which looks like a path", async () => {
    /*
     * The one that gets missed. `//evil.example` starts with a slash, so a
     * `startsWith("/")` check alone accepts it — and the browser reads it as
     * an absolute URL on the current scheme.
     */
    const { GET } = await loadRoute();
    const response = await GET(url("?code=abc&next=//evil.example/steal"));

    expect(new URL(response.headers.get("location")!).host).toBe("ask-sunny.test");
  });

  it("refuses a scheme-bearing value that is not http", async () => {
    const { GET } = await loadRoute();
    for (const next of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.c"]) {
      const response = await GET(url(`?code=abc&next=${encodeURIComponent(next)}`));
      const location = response.headers.get("location")!;
      expect(location.startsWith("https://ask-sunny.test/"), next).toBe(true);
    }
  });

  it("honours an ordinary same-site path", async () => {
    const { GET } = await loadRoute();
    const response = await GET(url("?code=abc&next=/reset-password"));

    expect(response.headers.get("location")).toBe(
      "https://ask-sunny.test/reset-password",
    );
  });

  it("defaults to the root when no destination is given", async () => {
    const { GET } = await loadRoute();
    const response = await GET(url("?code=abc"));
    expect(response.headers.get("location")).toBe("https://ask-sunny.test/");
  });
});

describe("what the callback says when the link does not work", () => {
  it("sends a link with no code back to sign in, with its own sentence", async () => {
    const { GET } = await loadRoute();
    const response = await GET(url("?error=access_denied&error_description=Email+link+is+invalid"));

    const location = response.headers.get("location")!;
    expect(location).toContain("/login");
    /*
     * The provider's `error_description` is NOT passed through. It is
     * attacker-influencable text that would be rendered on a page, and it tells
     * a person nothing beyond "the link did not work".
     */
    expect(location).not.toContain("error_description");
    expect(location).not.toContain("Email+link+is+invalid");
    expect(decodeURIComponent(location)).toContain("no longer valid");
  });

  it("sends a REJECTED exchange back to sign in without the provider's message", async () => {
    const { GET } = await loadRoute({
      error: { message: "Token has expired or is invalid; code=abc" },
    });
    const response = await GET(url("?code=abc&next=/reset-password"));

    const location = response.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).not.toContain("abc");
    expect(location).not.toContain("expired or is invalid");
  });
});

describe("the code is a credential and is treated as one", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("logs nothing", () => {
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("never puts the code or the provider's error into a redirect", () => {
    // Every notice in the file is a literal sentence of ours.
    expect(code).not.toMatch(/notice=\$\{/);
    expect(code).not.toMatch(/error_description/);
    expect(code).not.toMatch(/error\.message/);
  });

  it("uses the publishable-key session client, never the privileged one", () => {
    /*
     * The exchange moved into `lib/auth/code-exchange.ts`, shared with
     * `/auth/recovery` so there is one implementation of "swap a code for a
     * session and set the cookies on this response". The property is unchanged
     * and is now asserted where the code lives, plus here: this route must not
     * reach for the privileged client of its own accord either.
     */
    const exchange = readFileSync("src/lib/auth/code-exchange.ts", "utf8");
    expect(exchange).toMatch(/getSupabaseSessionClientFor/);
    expect(exchange).not.toMatch(/getSupabaseAdmin|SUPABASE_SECRET_KEY|SERVICE_ROLE/);

    expect(code).toMatch(/exchangeCodeOntoResponse/);
    expect(code).not.toMatch(/getSupabaseAdmin|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  });
});
