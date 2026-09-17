import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * /auth/recovery — the PREVIOUS landing, kept for links already in flight.
 * ============================================================================
 *
 * Nothing points here any more. `resetPasswordForEmail` asks for
 * `/reset-password`, a CLIENT page, because only a client page can read the
 * `#access_token=` fragment an implicit recovery link carries — and this
 * project issues both link shapes.
 *
 * THE BUG THIS FILE NOW GUARDS. A fragment is never transmitted to a server, so
 * an implicit link arriving at a route handler looks exactly like an empty
 * request. This route used to answer that with `/login?notice=…`, and browsers
 * re-attach a fragment to a redirect target that has none — so the live
 * recovery session rode along to the SIGN-IN SCREEN and sat there unread. It
 * now forwards to the password page instead, which costs nothing when the link
 * really is spent and rescues the case where it is not.
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

  it("asks Supabase for the CLIENT password page, with no query string", () => {
    /*
     * Two properties, and both have already failed once in production.
     *
     * The path must be the client page: a route handler cannot read the
     * fragment an implicit link carries, which is how a live recovery session
     * ended up parked on the sign-in screen.
     *
     * And it must carry no `?`. If a query string ever reappears in what
     * recovery requests, the redirect-matching ambiguity the earlier fix
     * removed comes back with it.
     */
    const routes = readFileSync("src/lib/auth/routes.ts", "utf8");
    expect(routes).toMatch(/SET_PASSWORD_PATH = "\/reset-password"/);
    expect(routes).toMatch(/RECOVERY_PATH = SET_PASSWORD_PATH/);
    expect(routes).not.toMatch(/RECOVERY_PATH = "[^"]*\?/);
  });
});

describe("a request with no code — which is what an IMPLICIT link looks like", () => {
  it("goes to the password page, NEVER to sign-in", async () => {
    /*
     * ====================================================================
     * THE REGRESSION, STATED AS PLAINLY AS IT CAN BE.
     * ====================================================================
     *
     * `#access_token=…` is never transmitted to a server, so an implicit
     * recovery link reaching this handler is indistinguishable from an empty
     * request. Redirecting to `/login` did not merely show the wrong page: the
     * browser re-attaches a fragment to a redirect target that has none, so the
     * recovery session was carried onto the sign-in screen, where nothing reads
     * it. Forwarding to the password page carries it somewhere that does.
     */
    const { GET } = await loadRoute();
    const response = await GET(url());

    const location = response.headers.get("location")!;
    expect(location).toBe("https://preview.vercel.app/reset-password");
    expect(location).not.toContain("/login");
  });

  it("carries NO query string, so a fragment survives the redirect intact", async () => {
    /*
     * A `Location` with its own fragment would REPLACE the one the browser is
     * holding. A query string is safe for that, but this redirect has nothing
     * to say, and the parser treats a bare path as "look at the fragment".
     */
    const { GET } = await loadRoute();
    const location = (await GET(url())).headers.get("location")!;

    expect(new URL(location).search).toBe("");
    expect(new URL(location).hash).toBe("");
  });

  it("keeps the provider's refusal text out of the redirect", async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      url("?error=access_denied&error_description=Email+link+is+invalid+or+has+expired"),
    );

    const location = response.headers.get("location")!;
    // Attacker-influencable text that would land on a page, saying nothing
    // actionable beyond "the link did not work".
    expect(location).not.toContain("error_description");
    expect(location).not.toContain("Email+link+is+invalid");
    expect(location).toBe("https://preview.vercel.app/reset-password");
  });
});

describe("a link that no longer works", () => {
  it("sends a REJECTED exchange to the password page, marked spent", async () => {
    /*
     * There IS no fragment in this case — the code was read and Supabase
     * refused it — so the page is told outright rather than made to ask the
     * auth server a question whose answer is already known.
     */
    const { GET } = await loadRoute({ exchanges: false });
    const response = await GET(url(`?code=${CODE_VALUE}`));

    const location = response.headers.get("location")!;
    expect(location).toBe("https://preview.vercel.app/reset-password?link=expired");
  });

  it("puts neither the code nor the provider's message in that redirect", async () => {
    const { GET } = await loadRoute({ exchanges: false });
    const location = (await GET(url(`?code=${CODE_VALUE}`))).headers.get("location")!;

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

  it("that constant resolves to the CLIENT page, not to a route handler", async () => {
    /*
     * The assertion the bug asks for. A route handler cannot read
     * `#access_token=`, so pointing recovery at one loses every implicit link —
     * and this project issues both shapes.
     */
    const { recoveryUrlFor } = await import("@/lib/auth/routes");
    expect(recoveryUrlFor("https://ask-sunny.vercel.app")).toBe(
      "https://ask-sunny.vercel.app/reset-password",
    );
    expect(recoveryUrlFor("https://pr-42.vercel.app/")).toBe(
      "https://pr-42.vercel.app/reset-password",
    );
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
