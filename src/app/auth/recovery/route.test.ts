import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * /auth/recovery — a landing path with NO QUERY STRING.
 * ============================================================================
 *
 * The bug: recovery asked for `/auth/callback?next=/reset-password`, and the
 * browser really did send that — `resetPasswordForEmail` transmits `redirectTo`
 * verbatim, because `appendPkceFlowIdToRedirects` is off by default. The link
 * that arrived pointed at the Site URL ROOT carrying `?code=` anyway, which is
 * what Supabase does when it declines a redirect target. Adding the exact
 * query-string URL to the allowlist did not change it.
 *
 * So the fix is not a better allowlist entry. Recovery asks for a path with no
 * query at all, which cannot be affected by query handling, by glob matching
 * across `?`, or by a parameter appended later. The destination afterwards is
 * compiled into the route, which also leaves no redirect parameter for an
 * emailed link to point somewhere else.
 */

const SOURCE = readFileSync("src/app/auth/recovery/route.ts", "utf8");
/** Comments stripped — this file documents the very strings it must not use. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The cookies Supabase would set on a successful exchange. */
const SESSION_COOKIES = [
  { name: "sb-project-auth-token", value: "session-value", options: { httpOnly: true, path: "/" } },
];

async function loadRoute(options: { exchanges?: boolean; configured?: boolean } = {}) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    options.configured === false ? "" : "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    options.configured === false ? "" : "sb_publishable_test";

  const seen: { codes: string[] } = { codes: [] };

  vi.doMock("next/headers", () => ({
    cookies: async () => ({ getAll: () => [], set: () => {} }),
  }));

  vi.doMock("@/lib/supabase/auth-clients", () => ({
    getSupabaseSessionClientFor: (jar: {
      setAll: (entries: typeof SESSION_COOKIES) => void;
    }) => ({
      auth: {
        exchangeCodeForSession: async (code: string) => {
          seen.codes.push(code);
          if (options.exchanges === false) {
            return { error: { message: `Invalid code: ${code} already used` } };
          }
          jar.setAll(SESSION_COOKIES);
          return { error: null };
        },
      },
    }),
  }));

  const { GET } = await import("./route");
  return { GET, seen };
}

function url(query = ""): Request {
  return new Request(`https://preview.vercel.app/auth/recovery${query}`);
}

const CODE_VALUE = "one-time-pkce-code-abc123";

describe("a valid recovery link", () => {
  it("exchanges the code", async () => {
    const { GET, seen } = await loadRoute();
    await GET(url(`?code=${CODE_VALUE}`));

    expect(seen.codes).toEqual([CODE_VALUE]);
  });

  it("sets the session cookies ON THE REDIRECT RESPONSE", async () => {
    /*
     * The response has to exist before the exchange. A handler that wrote to
     * the `cookies()` store and then returned a redirect would lose the writes
     * — the redirect is a different response object — and the person would
     * arrive at the password screen with no session.
     */
    const { GET } = await loadRoute();
    const response = await GET(url(`?code=${CODE_VALUE}`));

    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("session-value");
  });

  it("redirects to the FIXED password screen, on this origin", async () => {
    const { GET } = await loadRoute();
    const response = await GET(url(`?code=${CODE_VALUE}`));

    expect(response.headers.get("location")).toBe(
      "https://preview.vercel.app/reset-password",
    );
  });
});

describe("what it will not be told", () => {
  it("has NO redirect parameter at all", async () => {
    /*
     * The open-redirect question does not arise, because there is nothing to
     * point anywhere. An emailed link carrying `?next=https://evil.example`
     * changes nothing — and such a link would arrive from a real Supabase
     * sender on behalf of a real reset, which is worse than one delivered by a
     * link somebody had to click on a page.
     */
    const { GET } = await loadRoute();
    const response = await GET(
      url(`?code=${CODE_VALUE}&next=https://evil.example/steal&redirect_to=//evil.example`),
    );

    expect(response.headers.get("location")).toBe(
      "https://preview.vercel.app/reset-password",
    );
  });

  it("reads no input from the URL except the code", () => {
    // Asserted against the source, so a `next` cannot be added back quietly.
    expect(CODE).toMatch(/searchParams\.get\("code"\)/);
    expect(CODE).not.toMatch(/searchParams\.get\("(next|redirect|redirect_to|return)/);
    expect(CODE).not.toMatch(/safeNext|sanitizeNext/);
  });

  it("asks Supabase for a target with no query string", () => {
    /*
     * The whole point. If a `?` ever reappears in what recovery requests, the
     * failure this route was built for comes back.
     */
    const routes = readFileSync("src/lib/auth/routes.ts", "utf8");
    expect(routes).toMatch(/RECOVERY_PATH = "\/auth\/recovery"/);
    expect(routes).not.toMatch(/RECOVERY_PATH = "[^"]*\?/);
  });
});

describe("a link that no longer works", () => {
  it("sends a request with no code back to sign-in", async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      url("?error=access_denied&error_description=Email+link+is+invalid+or+has+expired"),
    );

    const location = response.headers.get("location")!;
    expect(location).toContain("/login");
    expect(decodeURIComponent(location)).toContain("no longer valid");
    // The provider's text is attacker-influencable and says nothing actionable.
    expect(location).not.toContain("error_description");
    expect(location).not.toContain("Email+link+is+invalid");
  });

  it("sends a REJECTED exchange back to sign-in, without the provider's message", async () => {
    const { GET } = await loadRoute({ exchanges: false });
    const response = await GET(url(`?code=${CODE_VALUE}`));

    const location = response.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).not.toContain(CODE_VALUE);
    expect(location).not.toContain("already used");
  });

  it("says so when the deployment has no Supabase configuration", async () => {
    const { GET, seen } = await loadRoute({ configured: false });
    const response = await GET(url(`?code=${CODE_VALUE}`));

    expect(decodeURIComponent(response.headers.get("location")!)).toContain(
      "not configured",
    );
    // And never reaches the exchange.
    expect(seen.codes).toEqual([]);
  });
});

describe("the code is a credential and is treated as one", () => {
  it("logs nothing", () => {
    expect(CODE).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("never interpolates anything into a notice", () => {
    // Every notice in the file is a literal sentence of ours.
    expect(CODE).not.toMatch(/notice=\$\{/);
    expect(CODE).not.toMatch(/error\.message|error_description/);
  });

  it("uses the publishable-key session client, never the privileged one", () => {
    const exchange = readFileSync("src/lib/auth/code-exchange.ts", "utf8");
    expect(exchange).toMatch(/getSupabaseSessionClientFor/);
    expect(exchange).not.toMatch(/getSupabaseAdmin|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
    expect(exchange).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("returns a boolean from the exchange, so no message can escape it", () => {
    const exchange = readFileSync("src/lib/auth/code-exchange.ts", "utf8");
    expect(exchange).toMatch(/Promise<boolean>/);
    expect(exchange).toMatch(/return !error/);
  });
});

describe("Forgot Password asks for the new path", () => {
  const form = readFileSync("src/features/auth/forgot-password-form.tsx", "utf8");
  const formCode = form
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("requests the recovery path, from the shared constant", () => {
    expect(formCode).toMatch(/recoveryUrlFor\(window\.location\.origin\)/);
  });

  it("no longer requests a callback URL with a query string", () => {
    expect(formCode).not.toMatch(/auth\/callback/);
    expect(formCode).not.toMatch(/next=/);
  });

  it("still uses the request's own origin, so a preview link comes back here", () => {
    // Every Vercel preview has its own hostname; a fixed origin would send
    // somebody to a different deployment than the one they asked from.
    expect(formCode).toMatch(/window\.location\.origin/);
  });
});
